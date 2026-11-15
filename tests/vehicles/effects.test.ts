/** Vehicle.getWheelEffects and landing flags, on both buggies. */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { makeBed } from './harness'

const kinds = [
  ['Syn3h', (bed: Awaited<ReturnType<typeof makeBed>>, y: number) => new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, y, 0))],
] as const

describe.each(kinds)('%s buggy wheel effects', (_name, make) => {
  async function spawn(y = 1.5) {
    const bed = await makeBed()
    const b: Vehicle = bed.add(make(bed, y))
    b.isLocal = false
    return { bed, b }
  }

  test('four persistent entries whose grounded flags match wheelsGrounded', async () => {
    const { bed, b } = await spawn(3)
    const first = b.getWheelEffects!()
    const objects = first.map((e) => [e, e.point, e.normal])
    expect(first).toHaveLength(4)
    let checked = 0
    bed.run(3, () => {
      const fx = b.getWheelEffects!()
      expect(fx).toBe(first)
      fx.forEach((e, i) => {
        expect(e).toBe(objects[i][0])
        expect(e.point).toBe(objects[i][1])
        expect(e.normal).toBe(objects[i][2])
      })
      expect(fx.filter((e) => e.grounded).length).toBe(b.wheelsGrounded)
      checked++
    })
    expect(checked).toBe(150)
    expect(b.wheelsGrounded).toBe(4)
    for (const e of first) {
      // Flat ground at y 0: contact on the ground, normal straight up.
      expect(Math.abs(e.point.y)).toBeLessThan(0.05)
      expect(e.normal.y).toBeGreaterThan(0.99)
    }
    // Front left is front (-Z) and left (-X) of the body in world space with heading 0.
    const c = b.body.translation()
    expect(first[0].point.x).toBeLessThan(c.x)
    expect(first[0].point.z).toBeLessThan(c.z)
    expect(first[3].point.x).toBeGreaterThan(c.x)
    expect(first[3].point.z).toBeGreaterThan(c.z)
  })

  test('slip rises in a hard turn', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    const straight = Math.max(...b.getWheelEffects!().map((e) => e.slip))
    b.input.x = 1
    let peak = 0
    bed.run(1, () => { peak = Math.max(peak, ...b.getWheelEffects!().map((e) => e.slip)) })
    expect(peak).toBeGreaterThan(Math.max(1, straight * 3))
  })

  test('touchdown after a fall is flagged with its impact speed', async () => {
    const { bed, b } = await spawn(6)
    let landings = 0
    let impact = 0
    bed.run(3, () => { if (b.landedThisStep) { landings++; impact = Math.max(impact, b.landingImpact) } })
    expect(landings).toBeGreaterThanOrEqual(1)
    expect(landings).toBeLessThanOrEqual(3)
    expect(impact).toBeGreaterThan(5)
  })
})
