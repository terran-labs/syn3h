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

  it('comes to rest at the default bounciness, from a big drop, within a reasonable time', () => {
    const r = ride('flat'); place(r, 20)
    const b = bounces(r, 60)
    expect(b.settled).toBeGreaterThan(0)
    // The tail of ever smaller bounces ends: a ball still hopping after 20 s is a bug.
    expect(b.settled).toBeLessThan(20)
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

describe('zorb brake', () => {
  const firstRebound = (brake: boolean | 'toggle', h = 10) => {
    const r = ride('flat')
    r.v.input.brakes = brake === true; r.step(20); place(r, h)
    const peaks: number[] = []
    let rising = false, top = 0, touched = false, start = energy(r), gained = 0
    for (let i = 0; i < 400; i++) {
      if (brake === 'toggle' && i % 15 === 0) r.v.input.brakes = !r.v.input.brakes
      r.step()
      gained = Math.max(gained, energy(r) - start)
      const y = r.height(), vy = r.v.body.linvel().y
      if (y < .05) touched = true
      if (!touched) continue
      if (vy > .05) { rising = true; top = Math.max(top, y) } else if (rising) { rising = false; peaks.push(top); top = 0 }
    }
    r.done()
    return { first: (peaks[0] ?? 0) / h, gained }
  }

  it('holding brake through a landing sticks it: under a tenth of the drop', () => {
    expect(firstRebound(true).first).toBeLessThan(0.1)
  })

  it('released, the bounce is what it is without ever braking', () => {
    const r = ride('flat'); r.v.input.brakes = true; r.step(30); r.v.input.brakes = false; r.step(30); place(r, 10)
    const after = bounces(r, 6).peaks[0] / 10; r.done()
    const never = firstRebound(false).first
    expect(Math.abs(after - never)).toBeLessThan(0.03)
  })

  it('toggling brake mid-bounce never adds energy', () => {
    expect(firstRebound('toggle').gained).toBeLessThan(0.5)
  })

  it('a remote copy given the same brake input damps the same', () => {
    const owner = ride('flat'), copy = ride('flat')
    owner.v.input.brakes = true
    for (let i = 0; i < 20; i++) { owner.step(); Object.assign(copy.v.input, owner.v.getState().input); copy.step() }
    expect(copy.v.zorb.damp).toBeCloseTo(owner.v.zorb.damp, 5)
    expect(owner.v.zorb.damp).toBeGreaterThan(0.9)
    owner.done(); copy.done()
  })
})

describe('zorb hop', () => {
  it('hops to the same height under any gravity: the Moon changes the hang time, not the height', () => {
    const earth = ride('flat'); const a = hop(earth).vehicle; earth.done()
    const moon = ride('flat', 'buggy', new THREE.Vector3(0, 2, 0), 1.62); const b = hop(moon, 12).vehicle; moon.done()
    const rolling = ride('flat'); rolling.v.body.setLinvel({ x: 15, y: 0, z: 0 }, true); rolling.step(5); const c = hop(rolling).vehicle; rolling.done()
    expect(c / Number(params.get('zorb.hopHeight')!.value)).toBeGreaterThan(0.9); expect(c / Number(params.get('zorb.hopHeight')!.value)).toBeLessThan(1.1)
    // The slider means what it says: the vehicle rises its height, at any gravity.
    const height = Number(params.get('zorb.hopHeight')!.value)
    expect(a / height).toBeGreaterThan(0.9); expect(a / height).toBeLessThan(1.1)
    expect(b / height).toBeGreaterThan(0.9); expect(b / height).toBeLessThan(1.1)
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

  it('remembers a press made just before touching down and hops on contact', () => {
    const r = ride('flat'); place(r, .9); r.step(2)
    expect(r.v.zorb.contact).toBe(0)
    // About 0.2 s from the ground: too early to hop, soon enough to be remembered.
    r.v.input.special = !r.v.input.special
    for (let i = 0; i < 25 && r.v.zorb.hops === 0; i++) r.step()
    expect(r.v.zorb.hops).toBe(1)
    r.done()
  })

  it('forgets a press made high in the air, and never hops in mid-air unless mid-air hops are on', () => {
    const r = ride('flat'); place(r, 12); r.step(2)
    r.v.input.special = !r.v.input.special
    for (let i = 0; i < 150; i++) r.step()
    expect(r.v.zorb.hops).toBe(0)
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
