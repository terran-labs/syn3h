/**
 * Liquid invariants for the buggy: what must stay true however lava and water are tuned.
 * Feel (speeds, swings, rhythms) is measured in the handling report, never pinned here.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { applyHull, applyWings, createHullState } from '../../src/vehicles/liquidHull'
import { waterCoast } from '../../src/vehicles/lava'
import { fieldOffset, liquidWavesAt, type LiquidBody } from '../../src/world/water/liquidWaves'
import { setWeatherClock } from '../../src/world/weather/wind'
import { type Run, type Sample, advance, ashore, coast, dispose, entry, exitTime, fromRest, turnOut, wingAscent } from './liquidScenarios'
import { buggyPlaning, planingEndsWithin } from '../vehicles2/waterSkipScenarios'

beforeAll(initPhysics)
/** The buggy's derived planing speed (src/vehicles/skip.ts), for the scenarios that skip. */
let planing = 0
beforeAll(() => { planing = buggyPlaning() })
afterEach(() => { for (const p of params.all()) params.set(p.def.id, p.def.default) })

const finite = (r: Run) => r.trace.every((s) => [s.x, s.y, s.z, s.vy, s.speed, s.pitch, s.roll].every(Number.isFinite))
/** Generous: a struggle you can win, not a wait. */
const OUT = 20

describe.each(['lava', 'water'] as const)('buggy in %s', (liquid) => {
  it.each([0.3, 0.7, 1.3, 3])('drives out from rest %s m deep under full throttle', (depth) => {
    const r = fromRest('buggy', { liquid, length: 40, depth, slope: 15 }, OUT + 5)
    try {
      expect(finite(r)).toBe(true)
      expect(exitTime(r)).not.toBeNull()
      expect(exitTime(r)!).toBeLessThan(OUT)
    } finally { dispose(r) }
  })

  it.each([[10, 10], [45, 10], [10, 25], [45, 25]])('drives in at %s m/s over a %s degree shore, upright and never launched by the liquid', (speed, slope) => {
    const r = entry('buggy', { liquid, length: 30, depth: 1.5, slope }, speed, OUT + 5)
    try {
      expect(finite(r)).toBe(true)
      // Over the liquid: upright, and never thrown up by it (the bank is 1 m).
      // The first crossing, until it first reaches the far bank: after a crash there it may tumble back over.
      const far = r.trace.findIndex((s) => s.z <= -r.basin.length + 1)
      const over = r.trace.slice(0, far < 0 ? undefined : far).filter((s) => s.z < 0)
      expect(Math.min(...over.map((s) => s.up))).toBeGreaterThan(0.5)
      expect(Math.max(...over.map((s) => s.y))).toBeLessThan((r.basin.bank ?? 1) + 3)
      // Below its planing speed the liquid slows it and it climbs out and settles upright. Faster,
      // it skims across water (src/vehicles/skip.ts) and meets the far bank at speed: a terrain
      // crash, which the liquid does not own. (Removed for that case: "ashore", "below 10 m" and
      // "upright after settling", which assumed the water had slowed it to a crawl first.)
      if (liquid === 'lava' || Math.max(...over.map((s) => s.speed)) < planing) {
        if (!ashore(r)) advance(r, OUT, (s) => s.z > 4 || s.z < -r.basin.length - 4)
        expect(ashore(r)).toBe(true)
        expect(Math.max(...r.trace.map((s) => s.y))).toBeLessThan(10)
        r.v.input.y = 0
        r.v.input.brakes = true
        advance(r, 3)
        expect(r.trace[r.trace.length - 1].up).toBeGreaterThan(0.5)
      }
    } finally { dispose(r) }
  })

  it.each([[0, 0, 0], [-45, 0, 5], [20, -60, 2]])('wings opened at the bottom (pitch %s, roll %s, %s m/s) float it to the surface and no further', (pitch, roll, speed) => {
    const a = wingAscent(liquid, 3, pitch, roll, speed, 20)
    try {
      expect(finite(a.run)).toBe(true)
      expect(a.surfaced).not.toBeNull()
      expect(a.settled).toBe(true)
      // Clear of the liquid only momentum carries it: it never speeds upward there.
      let prev: Sample | null = null
      for (const s of a.run.trace) {
        const clear = s.depth < -1.6
        if (clear && prev && prev.depth < -1.6) expect(s.vy).toBeLessThanOrEqual(prev.vy + 1e-3)
        prev = s
      }
    } finally { dispose(a.run) }
  })
})

describe.each(['lava', 'water'] as const)('a buggy on size 3 tyres in %s', (liquid) => {
  it.each([1.3, 3])('floats upright and drives out from %s m deep', (depth) => {
    params.set('buggy.tyreSize', 3)
    const r = fromRest('buggy', { liquid, length: 40, depth, slope: 15 }, OUT + 5)
    try {
      expect(finite(r)).toBe(true)
      expect(exitTime(r)).not.toBeNull()
      expect(Math.min(...r.trace.map((s) => s.up))).toBeGreaterThan(0)
    } finally { dispose(r) }
  })
})

describe.each(['lava', 'water'] as const)('steering afloat in %s', (liquid) => {
  it.each([1, 3])('turns round and drives out, on size %s tyres, without flipping', (size) => {
    params.set('buggy.tyreSize', size)
    // Facing away from the near shore, 10 m behind: lock and throttle must turn it round.
    const o = turnOut(liquid, 1, OUT + 10)
    try {
      expect(o.finite).toBe(true)
      expect(o.to90).not.toBeNull()
      expect(o.to90!).toBeLessThan(OUT / 2)
      expect(o.out).not.toBeNull()
      expect(o.backOut).toBe(true)
      expect(o.minUp).toBeGreaterThan(0)
    } finally { dispose(o.run) }
  })
})

describe('water holds a buggy up only while it works to stay up', () => {
  it.each([10, 40])('entering deep water at %s m/s with no throttle, it comes to rest and goes under', (speed) => {
    // Long enough for any skipping and planing to end (bound from the registry), then the old 12 s.
    // (Removed: "rest and under within 8 s", a tuning number from before buggies skipped.)
    const seconds = 12 + planingEndsWithin(speed, planing)
    // Open water long enough that the planing ends before any far bank: no crash into it.
    const c = coast('water', speed, seconds, false, 600 + speed * seconds)
    try {
      expect(finite(c.run)).toBe(true)
      expect(c.rest).not.toBeNull()
      expect(c.under).not.toBeNull()
      expect(Math.min(...c.run.trace.map((s) => s.up))).toBeGreaterThan(0)
    } finally { dispose(c.run) }
  })

  it('entering deep water fast with no throttle, it slows quickly once its planing has ended, even once it has gone under', () => {
    // Coasting drag alone would take ln(from / 3) / water.coast seconds to slow from its speed when
    // planing ended to 3 m/s; allow 60 per cent more. A coasting buggy that has sunk must keep that
    // drag (the 3.1 s regression turned it off under water); a sunk buggy on the bed must not
    // (tests/bots/rescue/tow.test.ts). Timed from the end of planing: a fast entry skips first.
    // (Changed: timed from entry, which assumed no skipping.)
    const seconds = 8 + planingEndsWithin(20, planing)
    const c = coast('water', 20, seconds, false, 600 + 20 * seconds)
    try {
      const trace = c.run.trace
      const last = trace.reduce((k, s, i) => (s.skipping > 0 ? i : k), -1)
      const start = trace[last + 1]
      const slow = trace.slice(last + 1).find((s) => s.speed < 3)
      expect(finite(c.run)).toBe(true)
      expect(start).toBeDefined()
      expect(slow).toBeDefined()
      if (start.speed > 3) expect(slow!.t - start.t).toBeLessThan((1.6 * Math.log(start.speed / 3)) / waterCoast.value)
    } finally { dispose(c.run) }
  })

  it.each([1, 3])('with throttle held it stays at the surface and moves, on size %s tyres', (size) => {
    params.set('buggy.tyreSize', size)
    const c = coast('water', 0, 1 / 60)
    try {
      c.run.v.input.y = 1
      const t0 = c.run.clock.t
      advance(c.run, 10)
      const tail = c.run.trace.filter((s) => s.t > t0 + 4)
      expect(finite(c.run)).toBe(true)
      expect(Math.max(...tail.map((s) => s.depth))).toBeLessThan(0.6)
      expect(Math.min(...tail.map((s) => s.speed))).toBeGreaterThan(1)
      expect(Math.min(...c.run.trace.map((s) => s.up))).toBeGreaterThan(0)
    } finally { dispose(c.run) }
  })
})

describe('liquid forces', () => {
  it('are zero when no part of the hull or wings is in the liquid', async () => {
    const { harness } = await import('../vehicles2/harness')
    const { RAPIER } = await import('../../src/core/physics')
    const h = harness(9.81, false)
    h.terrain.liquidHeightAt = () => 0
    h.terrain.liquidKindAt = () => 'lava'
    const b = h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0))
    h.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.4, 1.6), b)
    const hull = createHullState()
    const profile = { buoyancy: 2, thickness: 1, linear: 1, quadratic: 0.1, heave: 4, paddle: 9, paddleSpeed: 7, porpoise: 0.6, waddle: 0.5, gait: 1, planing: 6, skim: 0.5, planeLift: 0.5, deep: 0, steer: 1 }
    expect(applyHull(b, h.world, h.terrain, 'lava', profile, hull, { throttle: 1, wheelSpeed: 10 }, 1 / 60)).toBe(0)
    expect(applyWings(b, h.world, h.terrain, 'lava', { buoyancy: 1, authority: 1, density: 2 }, hull, { x: 1, y: 1 }, 1 / 60)).toBe(0)
    const f = b.userForce(), t = b.userTorque()
    expect([f.x, f.y, f.z, t.x, t.y, t.z].every((x) => x === 0)).toBe(true)
    h.world.free()
  })
})

describe('waves', () => {
  it('are the same at a point for two clients on the same room clock', () => {
    // The room shares one clock for weather (which turns the sea's wave fans) and water.
    setWeatherClock(() => 4321.5)
    for (const body of [{ kind: 'sea', liquid: 'water' }, { kind: 'inland', liquid: 'water' }, { kind: 'sea', liquid: 'lava' }] as LiquidBody[]) {
      const t = 12345.678
      const a = liquidWavesAt({ ...body, frozen: false }, t)
      // A second client that has evaluated other times first.
      const other = liquidWavesAt({ ...body, frozen: false }, 3)
      liquidWavesAt({ ...body, frozen: false }, t, other)
      for (const [x, z] of [[0, 0], [123.4, -56.7], [-900, 400]]) {
        expect(fieldOffset(other, x, z, 10)).toBe(fieldOffset(a, x, z, 10))
      }
      expect(a.components.length).toBeGreaterThan(0)
    }
  })

  it('are flat on a frozen body', () => {
    expect(liquidWavesAt({ kind: 'sea', liquid: 'water', frozen: true }, 5).components.length).toBe(0)
  })
})

void THREE
