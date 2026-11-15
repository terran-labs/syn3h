/**
 * Control signs the pilots are built on, measured on the real vehicles. If a vehicle lane
 * changes a sign, this file fails first and says which one.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics } from '../../../src/core/physics'
import type { InputState } from '../../../src/core/Input'
import { Jet } from '../../../src/vehicles/Jet'
import { Hovercraft } from '../../../src/vehicles/Hovercraft'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import { testWorld, type TestWorld } from './world'

beforeAll(initPhysics)
const run = (w: TestWorld, v: Vehicle, n: number) => { for (let i = 0; i < n; i++) { v.fixedUpdate(FIXED_DT); w.world.step(); v.postPhysics(FIXED_DT) } }
const axes = (v: Vehicle) => {
  const q = new THREE.Quaternion().copy(v.body.rotation())
  return { up: new THREE.Vector3(0, 1, 0).applyQuaternion(q), forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q), vel: new THREE.Vector3().copy(v.body.linvel()), spin: v.body.angvel().y }
}
function jetAfter(set: Partial<InputState>, steps = 50) {
  const w = testWorld(), v = new Jet(w.game, w.terrain, new THREE.Vector3(0, 30, 0)); v.isLocal = false
  Object.assign(v.input, { z: .5 }, set); run(w, v, steps)
  const a = axes(v); w.free(); return a
}

describe('jet hover mode signs', () => {
  it('starts in hover mode with input.special false', () => {
    const w = testWorld(), v = new Jet(w.game, w.terrain, new THREE.Vector3(0, 30, 0))
    expect(v.input.special).toBe(false); expect(v.hoverMode).toBe(true); w.free()
  })
  it('input.y > 0 noses down and accelerates toward the nose (-Z)', () => {
    const a = jetAfter({ y: 1 })
    expect(a.forward.y).toBeLessThan(-.2); expect(a.vel.z).toBeLessThan(-1)
  })
  it('input.x > 0 rolls right, yaws right and slides to +X', () => {
    const a = jetAfter({ x: 1 })
    expect(a.up.x).toBeGreaterThan(.2); expect(a.spin).toBeLessThan(0); expect(a.vel.x).toBeGreaterThan(1)
  })
  it('input.w > 0 yaws right without rolling', () => {
    const a = jetAfter({ w: 1 })
    expect(a.spin).toBeLessThan(-.1); expect(a.forward.x).toBeGreaterThan(.2); expect(Math.abs(a.up.x)).toBeLessThan(.1)
  })
  it('input.z above one half climbs, below sinks', () => {
    expect(jetAfter({ z: .8 }).vel.y).toBeGreaterThan(1)
    expect(jetAfter({ z: .3 }).vel.y).toBeLessThan(-1)
  })
})

describe('hovercraft glide signs', () => {
  it('input.y > 0 thrusts toward the nose and input.x > 0 yaws right', () => {
    const w = testWorld(), v = new Hovercraft(w.game, w.terrain, new THREE.Vector3(0, 3, 0)); v.isLocal = false
    run(w, v, 50); v.input.y = 1; run(w, v, 50)
    expect(axes(v).vel.z).toBeLessThan(-3)
    v.input.x = 1; run(w, v, 25)
    const a = axes(v)
    expect(a.spin).toBeLessThan(-.5); expect(a.forward.x).toBeGreaterThan(.2)
    w.free()
  })
})
