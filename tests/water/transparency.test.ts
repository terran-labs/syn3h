import { expect, it } from 'vitest'
import { buildRiverSurface, buildStillSurface, createWaterSurface } from '../../src/world/water/surface'

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
