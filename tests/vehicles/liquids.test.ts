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

beforeAll(initPhysics)
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

  it.each([[10, 10], [45, 10], [10, 25], [45, 25]])('drives in at %s m/s over a %s degree shore and out again, upright and on the ground', (speed, slope) => {
    const r = entry('buggy', { liquid, length: 30, depth: 1.5, slope }, speed, OUT + 5)
    try {
      expect(finite(r)).toBe(true)
      // Either shore: a crash into a steep far bank may turn it round, and that is fine.
      if (!ashore(r)) advance(r, OUT, (s) => s.z > 4 || s.z < -r.basin.length - 4)
      expect(ashore(r)).toBe(true)
      // Never launched into the sky: the bank is 1 m, a ramp hop is a few metres at most.
      expect(Math.max(...r.trace.map((s) => s.y))).toBeLessThan(10)
      // Not stuck on its side or roof once it has settled on land.
      r.v.input.y = 0
      advance(r, 3)
      expect(r.trace[r.trace.length - 1].up).toBeGreaterThan(0.5)
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
    const c = coast('water', speed, 12)
    try {
      expect(finite(c.run)).toBe(true)
      expect(c.rest).not.toBeNull()
      expect(c.under).not.toBeNull()
      expect(c.rest!).toBeLessThan(8)
      expect(c.under!).toBeLessThan(8)
      expect(Math.min(...c.run.trace.map((s) => s.up))).toBeGreaterThan(0)
    } finally { dispose(c.run) }
  })

  it('entering deep water fast with no throttle, it slows quickly, even once it has gone under', () => {
    // Coasting drag alone would take ln(20 / 3) / water.coast seconds to slow 20 m/s to 3; allow
    // 60 per cent more. A coasting buggy that has sunk must keep that drag (the 3.1 s regression
    // turned it off under water); a sunk buggy on the bed must not (tests/bots/rescue/tow.test.ts).
    const bound = (1.6 * Math.log(20 / 3)) / waterCoast.value
    const c = coast('water', 20, 8)
    try {
      const t0 = c.run.trace[0].t
      const slow = c.run.trace.find((s) => s.speed < 3)
      expect(finite(c.run)).toBe(true)
      expect(slow).toBeDefined()
      expect(slow!.t - t0).toBeLessThan(bound)
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
