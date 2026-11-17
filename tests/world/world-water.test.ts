import { describe, expect, it } from 'vitest'
import { configureWorldWater } from '../../src/world/terrain/ProceduralTerrain'
import { fieldOffset, liquidWavesAt, type LiquidBody } from '../../src/world/water/liquidWaves'

const lava: LiquidBody = { kind: 'sea', liquid: 'lava', frozen: false }
const lake: LiquidBody = { kind: 'inland', liquid: 'water', frozen: false }
const heights = (body: LiquidBody, size: number) => {
  const f = liquidWavesAt(body, 12.5)
  return [[3, 7], [410, 95], [size - 1, 1200]].map(([x, z]) => fieldOffset(f, x, z, 40))
}

/**
 * Whichever way a world was built (generated on this thread or adopted from the terrain
 * worker), its liquid waves are sized to its own tile. Lava and lake heights drive buoyancy,
 * so two players on the same world must compute the same surface, and it must wrap at the seam.
 */
describe('liquid waves follow the world they are on', () => {
  it('tile at a new world\'s seam after a change of planet size', () => {
    configureWorldWater(2048, 7)
    configureWorldWater(3072, 7)
    for (const body of [lava, lake]) {
      const f = liquidWavesAt(body, 4)
      for (const [x, z] of [[10, 20], [500, 1700]]) {
        expect(fieldOffset(f, x + 3072, z, 40)).toBeCloseTo(fieldOffset(f, x, z, 40), 6)
        expect(fieldOffset(f, x, z + 3072, 40)).toBeCloseTo(fieldOffset(f, x, z, 40), 6)
      }
    }
  })

  it('are the same for two players who came to the same world from different ones', () => {
    configureWorldWater(2048, 7); configureWorldWater(3072, 9)
    const fromSmall = [heights(lava, 3072), heights(lake, 3072)]
    configureWorldWater(4096, 1); configureWorldWater(3072, 9)
    const fromLarge = [heights(lava, 3072), heights(lake, 3072)]
    expect(fromLarge).toEqual(fromSmall)
  })
})
