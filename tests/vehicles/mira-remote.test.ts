/**
 * A remote player's buggy beyond net.proxyRadius is a kinematic body moved along its owner's
 * snapshots (RemotePlayer.steer), with the owner's input copied onto it. It runs no forces,
 * but it must still look alive: wings, steering, wheel spin and wheel travel follow the input
 * and the motion.
 */
import { expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, RAPIER } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import { makeBed } from './harness'

/** A settled buggy turned kinematic, then carried along -Z (its nose) at `speed`. */
async function carried(speed: number, lateral = 0) {
  const bed = await makeBed()
  const b = bed.add(new MiraBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.5, 0), 0))
  b.isLocal = false
  bed.run(3)
  const at = b.body.translation()
  const start = { x: at.x, y: at.y, z: at.z }
  b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  let t = 0
  const carry = (seconds: number) => bed.run(seconds, () => {
    t += FIXED_DT
    b.body.setNextKinematicTranslation({ x: start.x + lateral * t, y: start.y, z: start.z - speed * t })
  })
  return { b, carry }
}

test('a distant remote copy opens and closes its wings with its owner', async () => {
  const { b, carry } = await carried(20)
  b.input.special = true
  carry(1)
  expect(b.wingState).toBe(1)
  expect(b.wingsOpen).toBe(true)
  b.input.special = false
  carry(1)
  expect(b.wingState).toBe(0)
  expect(b.wingsOpen).toBe(false)
})

test('a distant remote copy steers its wheels with its owner', async () => {
  const { b, carry } = await carried(5)
  b.input.x = 1
  carry(1)
  // Turning right is negative yaw in front, opposite at the rear (four wheel steering).
  expect(b.steer[0]).toBeLessThan(-0.2)
  expect(b.steer[1]).toBe(b.steer[0])
  expect(b.steer[2]).toBeGreaterThan(0.1)
  b.input.x = 0
  carry(1)
  expect(Math.abs(b.steer[0])).toBeLessThan(0.01)
})

test('a distant remote copy rolls its wheels at its ground speed', async () => {
  const { b, carry } = await carried(20)
  carry(1)
  // The fixture carries the body at its resting height while the suspension shortens with
  // speed (a real owner's body rides lower), so only some wheel rays still reach the ground.
  expect(b.wheelsGrounded).toBeGreaterThan(0)
  expect(b.motorSpeed).toBeCloseTo(20, 0)
  // Rolling straight: no dust from sideways slip.
  for (const eff of b.wheelEffects) expect(eff.slip).toBeLessThan(0.5)
})

test('a distant remote copy sliding sideways reports wheel slip', async () => {
  const { b, carry } = await carried(0, 12)
  carry(1)
  for (const eff of b.wheelEffects) expect(eff.slip).toBeCloseTo(12, 0)
  expect(Math.abs(b.motorSpeed)).toBeLessThan(1)
})
