import { expect, it } from 'vitest'
import { DataUtils, HalfFloatType, RepeatWrapping } from 'three/webgpu'
import { buildBedTexture, buildRiverSurface, buildStillSurface, createWaterSurface } from '../../src/world/water/surface'

it('retains bed depth at elevated pools and downhill river surfaces', () => {
  const ground = { heightAt: (x: number, z: number) => 96 + x * .02 + z * .01 }
  const pool = buildStillSurface(ground, 0, 100, 0, 10)
  const river = buildRiverSurface(ground, [{ x: 0, y: 100, z: 0 }, { x: 0, y: 98, z: 20 }], 4, () => 2)
  for (const g of [pool, river]) {
    const p = g.getAttribute('position'), bed = g.getAttribute('groundHeight')
    expect(bed.count).toBe(p.count)
    for (let i = 0; i < p.count; i++) {
      expect(bed.getX(i)).toBeCloseTo(ground.heightAt(p.getX(i), p.getZ(i)), 4)
      expect(p.getY(i) - bed.getX(i)).toBeGreaterThan(0)
      expect(p.getY(i) - bed.getX(i)).toBeLessThan(5)
    }
    g.dispose()
  }
})

it('all water surface paths blend once without writing opaque depth; sea keeps displacement', () => {
  for (const mode of ['sea', 'still', 'river'] as const) {
    const { material } = createWaterSurface(mode)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.forceSinglePass).toBe(true)
    expect(material.opacityNode).toBeTruthy()
    // CurvedVelocity rejects history for positionNode materials. Do not replace this
    // displacement with a transform that would make the water look temporally static.
    if (mode === 'sea') expect(material.positionNode).toBeTruthy()
    material.dispose()
  }
})

it('packs the wrapping height field relative to sea level for per-pixel depth', () => {
  // Three samples a side; the last row and column repeat the first on a wrapping tile.
  const heights = Float32Array.from([10, 12, 10, 14, 9.5, 14, 10, 12, 10])
  const bed = buildBedTexture({ heights, resolution: 3, size: 8 }, 10)
  expect(bed.texture.image.width).toBe(2)
  expect(bed.texture.image.height).toBe(2)
  expect(bed.texture.wrapS).toBe(RepeatWrapping)
  expect(bed.texture.type).toBe(HalfFloatType)
  const texels = Array.from(bed.texture.image.data as Uint16Array, (v) => DataUtils.fromHalfFloat(v) + bed.reference)
  expect(texels).toEqual([10, 12, 14, 9.5])
  // Near the reference, where the shoreline is, half floats resolve well under a millimetre.
  const fine = buildBedTexture({ heights: Float32Array.from([10.0123, 0, 0, 0]), resolution: 2, size: 4 }, 10)
  expect(DataUtils.fromHalfFloat((fine.texture.image.data as Uint16Array)[0])).toBeCloseTo(0.0123, 4)
  bed.texture.dispose(); fine.texture.dispose()
})

it('takes a bed and a sky capture without replacing the material', () => {
  const surface = createWaterSurface('sea')
  const material = surface.material
  const bed = buildBedTexture({ heights: new Float32Array(9), resolution: 3, size: 8 }, 0)
  surface.setBed(bed)
  surface.setEnvironment(null)
  expect(surface.material).toBe(material)
  expect(material.envMap).toBeNull()
  bed.texture.dispose(); material.dispose()
})
