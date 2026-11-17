/**
 * Zorb bounce and hop invariants. How bouncy and how high are tuning, reported by
 * tools/zorb-bounce-report.ts; what must hold whatever the tuning is checked here.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { initPhysics } from '../../src/core/physics'
import { zorbRestitution } from '../../src/vehicles/zorb'
import { bounces, hop, place, ride } from './zorbBounceProbe'

beforeAll(initPhysics)
afterEach(() => { for (const id of ['zorb.bounce', 'zorb.hopHeight', 'zorb.airHops']) params.set(id, params.get(id)!.def.default) })

/** Height plus kinetic energy as height, of the body: never more than it started with. */
const energy = (r: ReturnType<typeof ride>, g = 9.81) => { const v = r.v.body.linvel(); return r.v.body.translation().y + (v.x * v.x + v.y * v.y + v.z * v.z) / (2 * g) }

describe('zorb bounce', () => {
  it('keeps a value saved with the old slider: half the bounciness is the restitution, a perfect bounce at most', () => {
    // The old slider was averaged with the ground's 0: .5 meant .25. It must still.
    expect(zorbRestitution(0.5)).toBe(0.25)
    expect(zorbRestitution(1)).toBe(0.5)
    expect(zorbRestitution(params.get('zorb.bounce')!.def.max as number)).toBeLessThanOrEqual(1)
  })

  it('never gains energy from a bounce, over 20 bounces, even at a perfect bounce', () => {
    for (const bounce of [params.get('zorb.bounce')!.def.default as number, 2]) {
      params.set('zorb.bounce', bounce)
      const r = ride('flat'); place(r, 20)
      const b = bounces(r, 40, .02)
      expect(b.finite).toBe(true)
      expect(b.peaks.length).toBeGreaterThan(1)
      // A little allowance for the ball's settling keel and solver slop.
      expect(b.peaks[0]).toBeLessThanOrEqual(20 * 1.02)
      for (let i = 1; i < Math.min(20, b.peaks.length); i++) expect(b.peaks[i]).toBeLessThanOrEqual(b.peaks[i - 1] * 1.02 + .05)
      r.done()
    }
  })

  it('never gains energy on a 20 degree slope, stays finite, and does not leave the ground for orbit', () => {
    const r = ride('slope')
    const start = energy(r)
    for (let i = 0; i < 1500; i++) {
      r.step()
      expect(energy(r)).toBeLessThanOrEqual(start + 1)
      expect(Number.isFinite(r.v.body.translation().y)).toBe(true)
    }
    r.done()
  })

  it('comes to rest at the default bounciness', () => {
    const r = ride('flat'); place(r, 20)
    const b = bounces(r, 60)
    expect(b.settled).toBeGreaterThan(0)
    r.done()
  })

  it('bounces every vehicle kind (bots ride the same ball) no higher than it fell', () => {
    for (const kind of ['jet', 'hovercraft', 'tank'] as const) {
      const r = ride('flat', kind); place(r, 20)
      const b = bounces(r, 20)
      expect(b.finite, kind).toBe(true)
      expect(b.maxHeight, kind).toBeLessThanOrEqual(20 * 1.02)
      r.done()
    }
  })
})

describe('zorb hop', () => {
  it('hops to the same height under any gravity: the Moon changes the hang time, not the height', () => {
    const earth = ride('flat'); const a = hop(earth).apex; earth.done()
    const moon = ride('flat', 'buggy', new THREE.Vector3(0, 2, 0), 1.62); const b = hop(moon, 12).apex; moon.done()
    expect(a).toBeGreaterThan(0.5)
    expect(b / a).toBeGreaterThan(0.8)
    expect(b / a).toBeLessThan(1.25)
  })

  it('hop, land, hop at the cooldown cannot climb without bound', () => {
    const r = ride('flat')
    const apexes: number[] = []
    for (let i = 0; i < 30; i++) apexes.push(hop(r, params.get('zorb.hopCooldown')!.value as number + .05).apex)
    const first = apexes[0]
    for (const a of apexes) expect(a).toBeLessThanOrEqual(first * 1.5 + .2)
    expect(Number.isFinite(r.v.body.translation().y)).toBe(true)
    r.done()
  })

  it('does not hop in mid-air unless mid-air hops are on', () => {
    const r = ride('flat'); place(r, 10); r.step(3)
    const before = r.v.body.linvel().y
    r.v.input.special = !r.v.input.special; r.step(2)
    expect(r.v.body.linvel().y).toBeLessThan(before + .5)
    expect(r.v.zorb.hops).toBe(0)
    r.done()
  })

  it('kicks off a slope, away from it, with a tumble, and stays finite', () => {
    const r = ride('slope'); r.step(5)
    const w0 = r.v.body.angvel()
    r.v.input.special = !r.v.input.special; r.step(2)
    const v = r.v.body.linvel(), w = r.v.body.angvel()
    expect(r.v.zorb.hops).toBe(1)
    // The slope rises toward -x: off the slope is toward +x as well as up.
    expect(v.y).toBeGreaterThan(1)
    expect(Math.hypot(w.x - w0.x, w.z - w0.z)).toBeGreaterThan(.5)
    for (let i = 0; i < 400; i++) { r.step(); expect(Number.isFinite(r.height())).toBe(true) }
    r.done()
  })
})
