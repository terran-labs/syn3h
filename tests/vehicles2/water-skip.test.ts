/**
 * Skipping across water for every vehicle (src/vehicles/skip.ts). Invariants only: how many
 * skips, how high and how much speed they keep are tuning, reported by tools/handling-report.ts.
 * Every speed and angle here comes from the registry (water.skip.*) or a vehicle's derived
 * planing speed, so retuning moves the scenarios with it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { decodeState, encodeState } from '../../shared/protocol'
import { emptyInput } from '../../src/core/Input'
import {
  type SkipForce, SKIP_ANGLE_FADE, applySkip, planingSpeed, skipAngle, skipForce, skipMinSpeed, skipPlaningScale,
} from '../../src/vehicles/skip'
import { BUGGY_TOP_PER_SPEED } from '../../src/vehicles/lava'
import { buggySpeed } from '../../src/vehicles/buggyParams'
import { SKIP_KINDS, airborneEnergies, coastFor, planingEndsWithin, skipCount, skipLaunch } from './waterSkipScenarios'

beforeAll(initPhysics)
const IDS = ['water.skip.planingScale', 'water.skip.minSpeed', 'water.skip.angle', 'water.skip.keep', 'water.skip.friction', 'water.buggy.planing']
afterEach(() => { for (const id of IDS) params.set(id, params.get(id)!.def.default) })

/** A fast, shallow entry: three times the planing speed, a third of the angle window. */
const fast = (planing: number) => planing * 3
const shallow = () => skipAngle.value / 3
/** Steeper than the angle window and all of its fade. */
const steep = () => skipAngle.value + SKIP_ANGLE_FADE + 5

describe('the planing contact', () => {
  it('stays finite and never pulls a hull into the water, for any input', () => {
    const out: SkipForce = { x: 0, y: 0, z: 0, q: 0 }
    const values = [0, 1e-9, 0.3, 5, 80, 1e6, -1e6, -0.3, NaN, Infinity]
    for (const wet of [0, 0.5, 1, 5, NaN]) for (const slope of [0, 0.4, -3]) for (const vx of values) for (const vy of values) {
      const l = Math.hypot(slope, 1, slope)
      skipForce({ wet, full: 0.15, share: 0.25, nx: -slope / l, ny: 1 / l, nz: slope / l, vx, vy, vz: 0, planing: 10, g: 9.81 }, out)
      expect(Number.isFinite(out.x + out.y + out.z + out.q)).toBe(true)
      expect((-slope * out.x + out.y + slope * out.z) / l).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('gives nothing below the entry speed or past the angle window', () => {
    const out: SkipForce = { x: 0, y: 0, z: 0, q: 0 }
    const base = { wet: 1, full: 0.15, share: 1, nx: 0, ny: 1, nz: 0, vz: 0, planing: 1, g: 9.81 }
    // Slower than the entry speed (less its fade), however light the hull.
    skipForce({ ...base, vx: skipMinSpeed.value * 0.79, vy: -0.1 }, out)
    expect(out.q).toBe(0)
    // Steeper than the window and its fade, however fast.
    const a = (steep() * Math.PI) / 180
    skipForce({ ...base, vx: 100 * Math.cos(a), vy: -100 * Math.sin(a) }, out)
    expect(out.q).toBe(0)
  })

  it('a heavier or smaller hull needs more speed, and the registry scales every vehicle', () => {
    const g = 9.81
    expect(planingSpeed(60, 10, g)).toBeGreaterThan(planingSpeed(30, 10, g))
    expect(planingSpeed(30, 5, g)).toBeGreaterThan(planingSpeed(30, 10, g))
    const before = planingSpeed(30, 10, g)
    params.set(skipPlaningScale.def.id, skipPlaningScale.value * 2)
    expect(planingSpeed(30, 10, g)).toBeCloseTo(before * 2, 6)
  })

  it('a hull with no reserve buoyancy is not a planing hull: no lift, no force', () => {
    let forces = 0
    const body = {
      isKinematic: () => false, mass: () => 241, translation: () => ({ x: 0, y: -0.5, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      velocityAtPoint: () => ({ x: 0, y: -1, z: -40 }), addForce: () => { forces++ }, addTorque: () => { forces++ },
      angvel: () => ({ x: 0, y: 0, z: 0 }), principalInertia: () => ({ x: 500, y: 500, z: 500 }),
      numColliders: () => 1,
      collider: () => ({ isSensor: () => false, shapeType: () => 1, halfExtents: () => ({ x: 1.25, y: 0.75, z: 3 }), vertices: () => new Float32Array(), translationWrtParent: () => ({ x: 0, y: 1, z: 0 }), rotationWrtParent: () => ({ x: 0, y: 0, z: 0, w: 1 }), handle: 1 }),
    }
    const water = { liquidHeightAt: () => 0, liquidKindAt: () => 'water' }
    expect(applySkip(body, water, 9.81, 0)).toBe(0)
    expect(forces).toBe(0)
    // The same hull with reserve buoyancy does plane: the rule, not the numbers, holds it down.
    expect(applySkip(body, water, 9.81, 1)).toBeGreaterThan(0)
  })
})

describe('vehicles skipping on water', () => {
  it('a fast, shallow buggy leaves the water again; a slow or steep one never does', () => {
    const quick = skipLaunch('buggy', fast, shallow())
    const slow = skipLaunch('buggy', skipMinSpeed.value * 0.7, shallow())
    const dive = skipLaunch('buggy', fast, steep())
    try {
      coastFor(quick, 6); coastFor(slow, 6); coastFor(dive, 6)
      expect(skipCount(quick.trace)).toBeGreaterThanOrEqual(1)
      expect(skipCount(slow.trace)).toBe(0)
      expect(skipCount(dive.trace)).toBe(0)
      for (const r of [quick, slow, dive]) expect(r.trace.every((s) => s.finite)).toBe(true)
    } finally { quick.dispose(); slow.dispose(); dive.dispose() }
  })

  it('skipping ends: coasting or at full throttle, a buggy drops below its planing speed for good within a bound', () => {
    // The owner: buggies "skip at least a few times before they sink past their planing zone and
    // wallow through on the surface". Below its skim speed (water.buggy.skimAbove; four times the
    // planing speed is well below) drive on the water cannot hold a hull up past its planing
    // speed, so the bound is the skip friction's alone (planingEndsWithin, from the registry).
    for (const throttle of [0, 1]) {
      const r = skipLaunch('buggy', (p) => p * 4, shallow(), { throttle })
      try {
        const bound = planingEndsWithin(r.trace.length ? r.trace[0].speed : r.planing * 4, r.planing)
        coastFor(r, bound + 10)
        const t0 = r.trace[0].t
        const from = r.trace.findIndex((s, i) => r.trace.slice(i).every((x) => x.speed < r.planing))
        expect(from).toBeGreaterThanOrEqual(0)
        expect(r.trace[from].t - t0).toBeLessThanOrEqual(planingEndsWithin(r.planing * 4, r.planing))
        expect(r.trace.every((s) => s.finite)).toBe(true)
        // Under throttle it ends wallowing on the surface; let go, it settles under as it does today.
        const end = r.trace[r.trace.length - 1]
        if (throttle) { expect(end.gap).toBeGreaterThan(-1); expect(end.skipping).toBeLessThan(1) }
      } finally { r.dispose() }
    }
  })

  it('lifting off ends a skim: flat out from top speed, then the throttle let go, it drops below its planing speed within the bound', () => {
    // The owner: a buggy "skims only near top speed" and only while flat out; let go, it decays.
    const top = BUGGY_TOP_PER_SPEED * buggySpeed.value
    const r = skipLaunch('buggy', top, shallow(), { throttle: 1 })
    try {
      coastFor(r, 5)
      r.throttle = 0; r.v.input.y = 0
      const n0 = r.trace.length, from = r.trace[n0 - 1].speed
      const bound = planingEndsWithin(from, r.planing)
      coastFor(r, bound + 10)
      const after = r.trace.slice(n0), t0 = after[0].t
      const i = after.findIndex((s, k) => after.slice(k).every((x) => x.speed < r.planing))
      expect(i).toBeGreaterThanOrEqual(0)
      expect(after[i].t - t0).toBeLessThanOrEqual(bound)
      expect(r.trace.every((s) => s.finite)).toBe(true)
    } finally { r.dispose() }
  })

  it('the tank never leaves the water, at any speed or shallow angle in its range', () => {
    for (const speed of [5, 15, 25, 40]) for (const angle of [2, 8, 20]) {
      const r = skipLaunch('tank', speed, angle)
      try {
        coastFor(r, 4)
        expect(skipCount(r.trace)).toBe(0)
        expect(r.trace.every((s) => s.skipping === 0 && s.finite)).toBe(true)
      } finally { r.dispose() }
    }
  })

  it('the water never adds energy across a skip', () => {
    // Vehicles with no powered lift, coasting: between airborne stretches only the water acts.
    for (const kind of ['buggy', 'tank'] as const) {
      const r = skipLaunch(kind, kind === 'tank' ? 30 : fast, shallow())
      try {
        coastFor(r, 6)
        const e = airborneEnergies(r.trace)
        for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThanOrEqual(e[i - 1] * 1.001 + 1e-3)
      } finally { r.dispose() }
    }
  })

  it('every vehicle stays finite and ends at rest in its ordinary water state', () => {
    for (const kind of SKIP_KINDS) {
      const r = skipLaunch(kind, kind === 'tank' ? 30 : fast, shallow())
      try {
        coastFor(r, 25)
        expect(r.trace.every((s) => s.finite)).toBe(true)
        const end = r.trace[r.trace.length - 1]
        // No longer planing, and slower than any planing could begin.
        expect(end.skipping).toBe(0)
        expect(end.speed).toBeLessThan(skipMinSpeed.value)
      } finally { r.dispose() }
    }
  })

  it('resting in waves for a minute, no vehicle leaves the surface or gains speed', () => {
    for (const kind of SKIP_KINDS) {
      const r = skipLaunch(kind, 0, 0, { waves: 'sea', clearance: 0 })
      try {
        coastFor(r, 60)
        // Planing never begins: the waves' motion must not feed the lift.
        expect(r.trace.every((s) => s.skipping === 0 && s.finite)).toBe(true)
        // While on the water (within a metre of the surface): a tank that has sunk and slides on
        // the sloping bed far below is moved by gravity, not by the water's surface.
        expect(Math.max(0, ...r.trace.filter((s) => s.gap > -1).map((s) => s.speed))).toBeLessThan(skipMinSpeed.value * 0.8)
        if (kind === 'hovercraft' || kind === 'jet') {
          // Held up by their own lift (the cushion, the jet's hover), they need not touch the
          // water; it must not move them more than the waves themselves rise and fall.
          const settled = r.trace.filter((s) => s.t > 5).map((s) => s.y)
          expect(Math.max(...settled) - Math.min(...settled)).toBeLessThanOrEqual(params.get('water.waveHeight')!.value as number)
        } else {
          // Hulls that sit in the water never leave it.
          const touched = r.trace.findIndex((s) => s.gap <= 0)
          expect(touched).toBeGreaterThanOrEqual(0)
          expect(Math.max(...r.trace.slice(touched).map((s) => s.gap))).toBeLessThan(0.2)
        }
      } finally { r.dispose() }
    }
  }, 120_000)

  it('retuning is the registry alone: an entry speed above the launch stops the skip', () => {
    const before = skipLaunch('buggy', fast, shallow())
    let speed = 0
    try { coastFor(before, 6); speed = before.trace[0].speed; expect(skipCount(before.trace)).toBeGreaterThanOrEqual(1) } finally { before.dispose() }
    params.set(skipMinSpeed.def.id, speed * 1.5)
    const after = skipLaunch('buggy', speed, shallow())
    try { coastFor(after, 6); expect(skipCount(after.trace)).toBe(0) } finally { after.dispose() }
  })

  it('a skipping buggy survives a network round trip: a proxy fed its snapshots follows its skips', () => {
    // As the game does (src/net/RemotePlayer.ts): a nearby proxy is physical, and every snapshot,
    // 20 a second, sets its position, rotation and velocity from the wire; its own physics,
    // this skip included, runs between. The buggy's hull lag and wheel spin are not on the wire,
    // so a proxy left to run free drifts a little; fed snapshots, it must follow the skips.
    // Five times its planing speed: fast enough that the owner's buggy skips within the 3 s.
    const a = skipLaunch('buggy', (p) => p * 5, shallow(), { waves: 'sea' })
    const c = skipLaunch('buggy', 0, 0, { waves: 'sea' })
    try {
      const send = () => {
        const t = a.v.body.translation(), q = a.v.body.rotation(), v = a.v.body.linvel(), w = a.v.body.angvel()
        const wire = decodeState(encodeState({ id: 0, t: a.clock.t, p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z], input: emptyInput() }))!
        c.clock.t = wire.t
        c.v.body.setTranslation({ x: wire.p[0], y: wire.p[1], z: wire.p[2] }, true)
        c.v.body.setRotation({ x: wire.q[0], y: wire.q[1], z: wire.q[2], w: wire.q[3] }, true)
        c.v.body.setLinvel({ x: wire.v[0], y: wire.v[1], z: wire.v[2] }, true)
        c.v.body.setAngvel({ x: wire.w[0], y: wire.w[1], z: wire.w[2] }, true)
      }
      const gaps: number[] = []
      for (let i = 0; i < 180; i++) {
        if (i % 3 === 0) send()
        a.step(); c.step()
        gaps.push(Math.abs(a.trace[a.trace.length - 1].gap - c.trace[c.trace.length - 1].gap))
      }
      expect(skipCount(a.trace)).toBeGreaterThanOrEqual(1)
      expect(c.trace.every((s) => s.finite)).toBe(true)
      // Between snapshots the proxy stays on the owner's path: within 10 cm of its height over the water.
      expect(Math.max(...gaps)).toBeLessThan(0.1)
    } finally { a.dispose(); c.dispose() }
  })
})

