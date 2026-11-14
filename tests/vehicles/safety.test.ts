/** Owner-side safety nets in the Vehicle base, exercised on the Syn3h buggy. */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { ClassicBuggy } from '../../src/vehicles/ClassicBuggy'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { makeBed } from './harness'

async function local() {
  const bed = await makeBed()
  const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.5, 0)))
  b.isLocal = true
  return { bed, b }
}

describe('vehicle safety', () => {
  test('falling below -300 returns to a spawn point keeping only the direction of travel', async () => {
    const { bed, b } = await local()
    b.body.setTranslation({ x: 5000, y: -301, z: 0 }, true)
    b.body.setLinvel({ x: 0, y: -80, z: 0 }, true)
    bed.run(0.02)
    const p = b.body.translation()
    const s = bed.terrain.spawnPoint(0).position
    expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(0.1)
    expect(Math.hypot(b.body.linvel().x, b.body.linvel().y, b.body.linvel().z)).toBeLessThan(1.5)
  })

  test('a vehicle trapped under the ground is put back on top', async () => {
    const { bed, b } = await local()
    b.body.setTranslation({ x: 3, y: -5, z: 3 }, true)
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    bed.run(0.02)
    expect(b.body.translation().y).toBeGreaterThan(2)
    bed.run(3)
    expect(b.wheelsGrounded).toBe(4)
  })

  test('speeds above 500 m/s are halved', async () => {
    const { bed, b } = await local()
    b.body.setTranslation({ x: 0, y: 200, z: 0 }, true)
    b.body.setLinvel({ x: 0, y: 0, z: -900 }, true)
    bed.run(0.02)
    expect(Math.abs(b.body.linvel().z)).toBeLessThan(500)
  })

  test('remote copies are left alone', async () => {
    const { bed, b } = await local()
    b.isLocal = false
    b.body.setTranslation({ x: 3, y: -5, z: 3 }, true)
    bed.run(0.02)
    expect(b.body.translation().y).toBeLessThan(-4)
  })
})

describe('upright rescue', () => {
  const makers = [
    ['Syn3h', (bed: Awaited<ReturnType<typeof makeBed>>) => new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.2, 0))],
    ['classic', (bed: Awaited<ReturnType<typeof makeBed>>) => new ClassicBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.2, 0))],
  ] as const

  test.each(makers)('%s buggy stuck on its roof for 3 s is set upright in place, keeping its heading', async (_n, make) => {
    const bed = await makeBed()
    const b = bed.add(make(bed))
    b.isLocal = true
    const heading = 0.9
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    const roof = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.97)
    b.body.setRotation(yaw.multiply(roof), true)
    b.body.setTranslation({ x: 0, y: 0.6, z: 0 }, true)
    // Lying still on its roof for just under 3 s (the native self righting may also act, so
    // drive the timer directly to test the fallback itself).
    b.stuckSteps = 149
    bed.run(0.02)
    const q = b.body.rotation()
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(quat).y).toBeGreaterThan(0.99)
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
    expect(Math.abs(Math.atan2(-f.x, -f.z) - heading)).toBeLessThan(0.05)
    expect(Math.hypot(b.body.translation().x, b.body.translation().z)).toBeLessThan(0.5)
    bed.run(3)
    expect(b.wheelsGrounded).toBe(4)
  })

  test.each(makers)('%s buggy dropped on its roof is upright within 5 s either way', async (_n, make) => {
    const bed = await makeBed()
    const b = bed.add(make(bed))
    b.isLocal = true
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), true)
    bed.run(5)
    const r = b.body.rotation()
    expect(1 - 2 * (r.x * r.x + r.z * r.z)).toBeGreaterThan(0.95)
  })

  test('a buggy sliding fast on its roof is not reset yet', async () => {
    const bed = await makeBed()
    const b = bed.add(new ClassicBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.2, 0)))
    b.isLocal = true
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), true)
    bed.run(0.5)
    expect(b.stuckSteps).toBeGreaterThan(0)
    b.body.setLinvel({ x: 0, y: 0, z: -20 }, true)
    bed.run(0.02)
    expect(b.stuckSteps).toBe(0)
  })
})
