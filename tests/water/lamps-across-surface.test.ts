/**
 * Headlights under water are seen through the water, like the sea bed they light. The owner, on
 * v26.11.2405: a submerged vehicle's beams were drawn "on top of the water", undistorted, while
 * the lit terrain under them was refracted. What must stay true:
 *  - the half of a beam or pool beyond the surface sorts before the water and the near half after;
 *  - the two halves' weights split every fragment between them exactly once, on either side;
 *  - a submerged lamp's pool lies on the bed, not on the surface over it.
 */
import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { CONE_ORDER, CONE_ORDER_BEYOND_WATER } from '../../src/vehicles/effects/cones'
import { GroundPools, POOL_ORDER, POOL_ORDER_BEYOND_WATER } from '../../src/vehicles/effects/pools'
import { orderFor } from '../../src/world/water/acrossSurface'
import { WATER_RENDER_ORDER } from '../../src/world/terrain/volcanics'
import { beyondSurface } from '../../src/world/water/sideOfSurface'

describe('lamps across the water surface', () => {
  it('draws the far half before the water and the near half after it', () => {
    for (const [near, far] of [[CONE_ORDER, CONE_ORDER_BEYOND_WATER], [POOL_ORDER, POOL_ORDER_BEYOND_WATER]]) {
      expect(far).toBe(orderFor(near, true))
      expect(far).toBeLessThan(WATER_RENDER_ORDER)
      expect(near).toBeGreaterThan(WATER_RENDER_ORDER)
    }
  })

  it('gives every fragment to exactly one half, on the right side', () => {
    for (const below of [0, 1]) for (let y = -3; y <= 3; y += 0.05) {
      const far = beyondSurface(y, 0, below)
      expect(far).toBeGreaterThanOrEqual(0)
      expect(far).toBeLessThanOrEqual(1)
      // Well clear of the surface: all in one half.
      if (y < -0.2) expect(far).toBe(below ? 0 : 1)
      if (y > 0.2) expect(far).toBe(below ? 1 : 0)
    }
  })

  it('lays a submerged lamp\'s pool on the bed', () => {
    const pools = new GroundPools(2)
    const object = new T.Object3D()
    object.position.set(0, -3, 0)
    object.updateMatrixWorld()
    const water = 0, bed = -4
    const tints: boolean[] = []
    pools.update([{ object, lampY: 0.2, lampZ: -1, strength: 1 }], new T.Vector3(0, 5, 10), () => water, (_x, _z, out, beneath) => { tints.push(Boolean(beneath)); out.r = out.g = out.b = 0.5 }, () => bed)
    expect(pools.drawn).toBe(1)
    const y = pools.mesh.geometry.attributes.position.getY(0)
    expect(y).toBeLessThan(bed + 0.5)
    expect(pools.mesh.geometry.attributes.poolBeneath.getX(0)).toBe(1)
    expect(tints).toEqual([true])
  })

  it('keeps a pool from a lamp above the water on the surface', () => {
    const pools = new GroundPools(2)
    const object = new T.Object3D()
    object.position.set(0, 0.5, 0)
    pools.update([{ object, lampY: 0.2, lampZ: -1, strength: 1 }], new T.Vector3(0, 5, 10), () => 0, (_x, _z, out) => { out.r = out.g = out.b = 0.5 }, () => -4)
    expect(pools.drawn).toBe(1)
    expect(pools.mesh.geometry.attributes.position.getY(0)).toBeGreaterThan(-0.01)
    expect(pools.mesh.geometry.attributes.poolBeneath.getX(0)).toBe(0)
  })
})
