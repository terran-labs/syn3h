/** Legacy water behaviour on a flat bed with a water surface 2 m above the ground. */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { buggyLavaFloat } from '../../src/vehicles/lava'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { makeBed } from './harness'

const LAVA = 4
async function inLava(y = LAVA + 1, vz = 0) {
  const bed = await makeBed()
  bed.terrain.liquidHeightAt = () => LAVA
  bed.terrain.liquidKindAt = () => 'water'
  const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, y, 0)))
  b.isLocal = false
  b.body.setLinvel({ x: 0, y: 0, z: vz }, true)
  return { bed, b }
}
afterEach(() => { for (const p of params.all()) params.set(p.def.id, p.def.default) })

describe('legacy water buoyancy', () => {
  // This suite verifies the retained float controller, not the default sinking model.
  beforeEach(() => params.set(waterSinking.def.id, false))
  test('a slow buggy floats near the surface instead of sinking', async () => {
    const { bed, b } = await inLava()
    bed.run(6)
    const y = b.body.translation().y
    expect(y).toBeGreaterThan(LAVA - 1.5)
    expect(y).toBeLessThan(LAVA + 0.5)
    expect(Math.abs(b.body.linvel().y)).toBeLessThan(0.3)
    expect(b.inLiquid).toBe(true)
  })

  test('throttle paddles it forward toward local -Z', async () => {
    const { bed, b } = await inLava()
    bed.run(2)
    const z0 = b.body.translation().z
    b.input.y = 1
    bed.run(4)
    expect(b.body.translation().z - z0).toBeLessThan(-8)
  })

  test('hitting water fast skims across it', async () => {
    const { bed, b } = await inLava(LAVA + 0.3, -30)
    let maxY = -Infinity
    bed.run(1.5, () => { maxY = Math.max(maxY, b.body.translation().y) })
    expect(b.body.translation().z).toBeLessThan(-15)
    expect(maxY).toBeGreaterThan(LAVA)
  })

  test('a plunge resurfaces', async () => {
    const { bed, b } = await inLava(LAVA - 1.5)
    b.body.setTranslation({ x: 0, y: LAVA - 5, z: 0 }, true)
    bed.run(6)
    expect(b.body.translation().y).toBeGreaterThan(LAVA - 2)
  })

  test('with the legacy float toggle off it ignores water', async () => {
    params.set(buggyLavaFloat.def.id, false)
    const { bed, b } = await inLava()
    bed.run(4)
    expect(b.inLiquid).toBe(false)
    expect(b.wheelsGrounded).toBe(4)
  })
})
