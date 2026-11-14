/** Owner-side safety nets in the Vehicle base, exercised on the Syn3h buggy. */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
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
