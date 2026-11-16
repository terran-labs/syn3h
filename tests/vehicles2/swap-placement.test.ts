/** Where a switched-in vehicle starts: where the old one was, moving as it moved, never buried. */
import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { SWAP_CLEARANCE, swapPlacement } from '../../src/vehicles/swap'
import { REST_HEIGHT } from '../../src/vehicles/Vehicle'

const level = { x: 0, y: 0, z: 0, w: 1 }
const still = { x: 0, y: 0, z: 0 }
/** Rolling hills with a lake at height 2 in places. */
const hills = { heightAt: (x: number, z: number) => 6 * Math.sin(x * 0.07) * Math.cos(z * 0.05), liquidHeightAt: () => 2 }
const KINDS = ['buggy', 'jet', 'hovercraft', 'tank'] as const

describe('switch placement', () => {
  it('keeps the position, moving it only up and only by the lift the new body needs', () => {
    for (const kind of KINDS) for (let i = 0; i < 200; i++) {
      const x = (i * 37) % 300 - 150, z = (i * 53) % 300 - 150, y = hills.heightAt(x, z) + (i % 9) - 4
      const p = swapPlacement({ position: { x, y, z }, rotation: level, linvel: still, angvel: still }, kind, hills)
      const floor = Math.max(hills.heightAt(x, z), 2) + REST_HEIGHT[kind] + SWAP_CLEARANCE
      expect(p.position.x).toBe(x); expect(p.position.z).toBe(z)
      expect(p.position.y).toBeCloseTo(Math.max(y, floor), 9)
      // Never inside the ground or under the liquid.
      expect(p.position.y - REST_HEIGHT[kind]).toBeGreaterThan(Math.max(hills.heightAt(x, z), 2))
    }
  })

  it('carries the velocity, and a switch in mid-air stays in mid-air to fall from there', () => {
    const p = swapPlacement({ position: { x: 10, y: 80, z: 0 }, rotation: level, linvel: { x: 25, y: -6, z: -3 }, angvel: { x: 0.4, y: 1.2, z: -2 } }, 'buggy', hills)
    expect(p.position.y).toBe(80)
    expect(p.linvel.toArray()).toEqual([25, -6, -3])
    expect(p.angvel.toArray()).toEqual([0, 1.2, 0])
  })

  it('does not keep sinking into what it was lifted out of', () => {
    const p = swapPlacement({ position: { x: 0, y: -1, z: 0 }, rotation: level, linvel: { x: 4, y: -9, z: 0 }, angvel: still }, 'tank', hills)
    expect(p.lift).toBeGreaterThan(0)
    expect(p.linvel.toArray()).toEqual([4, 0, 0])
  })

  it('rights a vehicle switched while upside down, keeping its heading', () => {
    const q = new T.Quaternion().setFromEuler(new T.Euler(0, 1.1, Math.PI, 'YXZ'))
    const p = swapPlacement({ position: { x: 0, y: 50, z: 0 }, rotation: q, linvel: still, angvel: still }, 'jet', hills)
    const back = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), p.heading)
    const nose = new T.Vector3(0, 0, -1).applyQuaternion(back), oldNose = new T.Vector3(0, 0, -1).applyQuaternion(q)
    expect(nose.dot(oldNose.setY(0).normalize())).toBeCloseTo(1, 6)
  })

  it('never produces a non-finite value', () => {
    const p = swapPlacement({ position: { x: NaN, y: Infinity, z: 0 }, rotation: level, linvel: { x: NaN, y: 0, z: 0 }, angvel: { x: 0, y: NaN, z: 0 } }, 'hovercraft', hills)
    for (const n of [...p.position.toArray(), ...p.linvel.toArray(), ...p.angvel.toArray(), p.heading]) expect(Number.isFinite(n)).toBe(true)
  })
})
