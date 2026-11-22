import { describe, expect, it } from 'vitest'
import { Object3D } from 'three/webgpu'
import { AcrossSurface, BELOW_WATER_SHIFT, SIDE_HYSTERESIS, farSide } from '../../src/world/water/acrossSurface'
import { WATER_RENDER_ORDER } from '../../src/world/terrain/volcanics'

/**
 * The bug a player hit (v26.11.2201): a submerged buggy's force field wings and canopy drew on
 * top of the water. A transparent part on the far side of the surface from the camera must sort
 * before the water, from above and from below, and return to its own order when it comes back.
 */
describe('transparent parts across the water surface', () => {
  it('sorts a part on the far side before the water, from either side', () => {
    const across = new AcrossSurface(), part = new Object3D()
    part.renderOrder = 0
    across.begin(false, () => 0)
    across.place(part, -4, 0)
    expect(part.renderOrder).toBeLessThan(WATER_RENDER_ORDER)
    across.begin(true, () => 0)
    across.place(part, -4, 0)
    expect(part.renderOrder).toBe(0)
    across.place(part, 3, 0)
    expect(part.renderOrder).toBeLessThan(WATER_RENDER_ORDER)
  })

  it('keeps the order between a vehicle’s own parts and restores it on dry land', () => {
    const across = new AcrossSurface(), tint = new Object3D(), glow = new Object3D()
    tint.renderOrder = -1; glow.renderOrder = 0
    across.begin(false, () => 0)
    across.place(tint, -4, 0); across.place(glow, -4, 0)
    expect(tint.renderOrder).toBe(-1 - BELOW_WATER_SHIFT)
    expect(glow.renderOrder).toBe(-BELOW_WATER_SHIFT)
    across.begin(false, () => -Infinity)
    across.place(tint, -4, -Infinity); across.place(glow, -4, -Infinity)
    expect([tint.renderOrder, glow.renderOrder]).toEqual([-1, 0])
  })

  it('does not flicker on a swell at the waterline', () => {
    expect(farSide(-SIDE_HYSTERESIS / 2, 0, false, true)).toBe(true)
    expect(farSide(-SIDE_HYSTERESIS / 2, 0, false, false)).toBe(false)
  })

  it('adopts an order set by the vehicle itself as the new base', () => {
    const across = new AcrossSurface(), part = new Object3D()
    across.begin(false, () => 0)
    across.place(part, -4, 0)
    part.renderOrder = 5
    across.place(part, -4, 0)
    expect(part.renderOrder).toBe(5 - BELOW_WATER_SHIFT)
  })
})
