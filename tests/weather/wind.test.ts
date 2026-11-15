/**
 * Wind field and wind force (src/world/weather). The field is pure, so most of this needs no
 * physics; the last block drives real vehicles in Rapier.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { createVehicle } from '../../src/vehicles'
import {
  RECOMMENDED_STORMINESS, WeatherSystem, type WindFrame, exposureOf, gustEnvelope, heightShare,
  windAcceleration, windAt,
} from '../../src/world/weather'
import { harness } from '../vehicles2/harness'

function frame(over: Partial<WindFrame> = {}): WindFrame {
  return {
    seed: 4821, wrap: 2048, sea: 0, top: 500, storminess: RECOMMENDED_STORMINESS, speed: 16,
    gustiness: 0.5, direction: 0, atmosphere: 1, ...over,
  }
}
const at = (f: WindFrame, x: number, y: number, z: number, t: number) => windAt(f, x, y, z, t, { x: 0, y: 0, z: 0 })
const speed = (v: { x: number; z: number }) => Math.hypot(v.x, v.z)
/** A wall clock time, as the room clock gives: large numbers must not lose the gusts. */
const T0 = 1_794_700_000

describe('wind field', () => {
  it('is the same on two clients for the same seed, time and place', () => {
    const a = frame(), b = frame()
    for (let i = 0; i < 50; i++) {
      const x = (i * 97) % 2000 - 1000, z = (i * 61) % 2000 - 1000, y = i * 11, t = T0 + i * 0.37
      expect(at(a, x, y, z, t)).toEqual(at(b, x, y, z, t))
    }
  })

  it('differs between seeds', () => {
    expect(at(frame({ seed: 1 }), 0, 400, 0, T0)).not.toEqual(at(frame({ seed: 2 }), 0, 400, 0, T0))
  })

  it('rises with height: nearly calm at sea level, windiest at and above the summit', () => {
    const f = frame()
    expect(heightShare(f, 0)).toBeLessThan(0.15)
    let last = 0
    for (const y of [0, 100, 200, 300, 400, 500, 700]) {
      const s = heightShare(f, y)
      expect(s).toBeGreaterThan(last)
      last = s
    }
    expect(heightShare(f, 500)).toBeCloseTo(1, 6)
    // Mean over a minute of gusts, same place.
    const mean = (y: number) => { let s = 0; for (let i = 0; i < 600; i++) s += speed(at(f, 100, y, -200, T0 + i * 0.1)); return s / 600 }
    expect(mean(500)).toBeGreaterThan(5 * mean(5))
    expect(mean(5)).toBeLessThan(3)
    expect(mean(500)).toBeGreaterThan(10)
  })

  it('is zero with storminess, speed or atmosphere at zero', () => {
    for (const over of [{ storminess: 0 }, { speed: 0 }, { atmosphere: 0 }]) {
      for (let i = 0; i < 20; i++) expect(speed(at(frame(over), i * 50, 600, -i * 30, T0 + i))).toBe(0)
    }
  })

  it('is continuous across the wrap seam and repeats every tile', () => {
    const f = frame()
    const h = f.wrap / 2
    for (let i = 0; i < 20; i++) {
      const t = T0 + i * 1.3, y = 300, z = i * 40 - 400
      const left = at(f, -h, y, z, t), right = at(f, h, y, z, t)
      expect(left.x).toBeCloseTo(right.x, 6); expect(left.z).toBeCloseTo(right.z, 6)
      const a = at(f, -h + 0.01, y, z, t), b = at(f, h - 0.01, y, z, t)
      expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeLessThan(0.01)
      const moved = at(f, 123 + f.wrap, y, z - f.wrap, t), base = at(f, 123, y, z, t)
      expect(moved.x).toBeCloseTo(base.x, 6); expect(moved.z).toBeCloseTo(base.z, 6)
    }
  })

  it('is smooth in time, with gusts that swell and fade', () => {
    const f = frame()
    let lo = 1, hi = 0, maxJump = 0, prev = speed(at(f, 0, 500, 0, T0))
    for (let i = 1; i < 1200; i++) {
      const t = T0 + i * 0.05
      const g = gustEnvelope(f, 0, 0, t)
      lo = Math.min(lo, g); hi = Math.max(hi, g)
      const s = speed(at(f, 0, 500, 0, t))
      maxJump = Math.max(maxJump, Math.abs(s - prev)); prev = s
    }
    expect(hi - lo).toBeGreaterThan(0.4)
    // Under 1.5 m/s per 50 ms step: no clicks in the force or the sound.
    expect(maxJump).toBeLessThan(1.5)
  })
})

describe('wind force', () => {
  it('adds nothing in still air, at any vehicle speed', () => {
    const a = windAcceleration({ x: 0, y: 0, z: 0 }, { x: 30, y: -2, z: 4 }, 8, 30, 1, { x: 1, y: 1, z: 1 })
    expect([a.x, a.y, a.z]).toEqual([0, 0, 0])
  })

  it('pushes a resting body downwind, harder for more exposure and less mass', () => {
    const w = { x: 10, y: 0, z: 0 }, still = { x: 0, y: 0, z: 0 }
    const small = windAcceleration(w, still, 1.5, 30, 1, { x: 0, y: 0, z: 0 })
    const big = windAcceleration(w, still, 40, 30, 1, { x: 0, y: 0, z: 0 })
    const heavy = windAcceleration(w, still, 6, 250, 1, { x: 0, y: 0, z: 0 })
    expect(small.x).toBeGreaterThan(0)
    expect(big.x).toBeGreaterThan(20 * small.x)
    expect(heavy.x).toBeLessThan(small.x)
    expect(small.z).toBe(0)
  })

  it('never pushes a body faster than the air, and holds back one that outruns it', () => {
    const w = { x: 10, y: 0, z: 0 }
    const along = windAcceleration(w, { x: 10, y: -3, z: 0 }, 40, 30, 1, { x: 0, y: 0, z: 0 })
    expect([along.x, along.y, along.z]).toEqual([0, 0, 0])
    expect(windAcceleration(w, { x: 25, y: 0, z: 0 }, 40, 30, 1, { x: 0, y: 0, z: 0 }).x).toBeLessThan(0)
    // A headwind costs more the faster you go into it.
    const slow = windAcceleration(w, { x: -5, y: 0, z: 0 }, 2, 30, 1, { x: 0, y: 0, z: 0 })
    const fast = windAcceleration(w, { x: -25, y: 0, z: 0 }, 2, 30, 1, { x: 0, y: 0, z: 0 })
    expect(fast.x).toBeGreaterThan(slow.x)
  })

  it('uses the zorb ball real radius', () => {
    const ball = { kind: 'buggy', wingsOpen: false, zorbed: true, zorb: { radius: 5.25 } }
    expect(exposureOf(ball)).toBeCloseTo(0.47 * Math.PI * 5.25 * 5.25, 6)
    expect(exposureOf({ ...ball, zorbed: false })).toBeLessThan(exposureOf({ ...ball, zorbed: false, wingsOpen: true }))
  })
})

describe('wind on real vehicles', () => {
  beforeAll(initPhysics)

  /** Downwind travel in metres over `seconds` of a strong steady gust. */
  function drift(zorb: boolean, seconds: number, f: WindFrame | null): number {
    const h = harness()
    const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 2, 0))
    v.isLocal = false
    v.zorbView = new THREE.Quaternion()
    if (zorb) v.input.zorb = true
    h.step(v, 250)
    const weather = new WeatherSystem(() => h.terrain, () => [v])
    const start = v.body.translation()
    const t0 = T0
    for (let i = 0; i < seconds * 50; i++) {
      if (f) weather.apply(v, f, t0 + i * 0.02, h.terrain)
      h.step(v, 1)
    }
    const end = v.body.translation()
    const dir = at(f ?? frame(), 0, 2, 0, t0)
    const n = Math.hypot(dir.x, dir.z) || 1
    const out = ((end.x - start.x) * dir.x + (end.z - start.z) * dir.z) / n
    v.dispose(); h.world.free()
    return out
  }

  it('pushes a zorb ball measurably further than a buggy in the same gust', () => {
    // Summit-strength wind at ground level: sea far below, rim at the floor.
    const f = frame({ sea: -1000, top: 0, storminess: 1, gustiness: 0 })
    const ball = drift(true, 4, f)
    const buggy = drift(false, 4, f)
    const still = drift(true, 4, null)
    expect(ball - still).toBeGreaterThan(5)
    expect(ball).toBeGreaterThan(buggy + 4)
  })

  it('leaves a vehicle exactly as it was when the wind is zero', () => {
    const run = (f: WindFrame | null) => {
      const h = harness()
      const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 2, 0))
      v.isLocal = false
      v.input.y = 1
      const weather = new WeatherSystem(() => h.terrain, () => [v])
      for (let i = 0; i < 200; i++) { if (f) weather.apply(v, f, T0 + i * 0.02, h.terrain); h.step(v, 1) }
      const p = v.body.translation(), out = [p.x, p.y, p.z]
      v.dispose(); h.world.free()
      return out
    }
    expect(run(frame({ storminess: 0 }))).toEqual(run(null))
  })
})
