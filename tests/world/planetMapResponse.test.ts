import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintPlanetMap } from '../../src/world/planetMap'
import * as terrain from '../../src/world/terrain/generate'

const generate = terrain.generateTerrain
const W = 128, H = 64

// Isolate the painter from changes to terrain shape: a flat shelf with no roads or lakes.
// The centre pixel lies inside the mapped tile, away from decorative islets and polar tint.
function flatShelf(height: () => number): void {
  vi.spyOn(terrain, 'generateTerrain').mockImplementation((seed, settings, options) => {
    const data = generate(seed, settings, options)
    data.heights.fill(height())
    data.volcanic.fill(0)
    data.roadDist.fill(100)
    data.lava = { lake: null, rivers: [], pools: [] }
    data.trees = new Float32Array(0)
    data.layout.summitHeight = 100
    return data
  })
}

function centre(overrides: Record<string, number>): Uint8ClampedArray {
  const map = paintPlanetMap('alpine', 42, W, H, overrides)
  const offset = ((H / 2) * W + W / 2) * 4
  return map.data.slice(offset, offset + 4)
}

afterEach(() => vi.restoreAllMocks())

describe('planet map sea depth and snow response', () => {
  for (const seaKind of [0, 1]) {
    it(`shades sea kind ${seaKind} by depth below the chosen sea level`, () => {
      let height = -10
      flatShelf(() => height)
      const base = { 'world.seaKind': seaKind, 'terrain.snowLine': 2 }
      const shallow = centre({ ...base, 'world.lavaAltitude': 0 })
      const deep = centre({ ...base, 'world.lavaAltitude': 40 })
      expect(deep).not.toEqual(shallow)
      // Translating ground and sea equally must preserve the submerged pixel's colour.
      height = 10
      expect(centre({ ...base, 'world.lavaAltitude': 20 })).toEqual(shallow)
    })
  }

  it('places snow at the chosen share of summit height without a half-summit cap', () => {
    flatShelf(() => 100)
    const bare = centre({ 'terrain.snowLine': 2 })
    // A threshold at 150 m is above this shelf, including the painter's edge noise.
    expect(centre({ 'terrain.snowLine': 1.5 })).toEqual(bare)
    const snowy = centre({ 'terrain.snowLine': 0.5 })
    expect(snowy).not.toEqual(bare)
    expect(snowy[0] + snowy[1] + snowy[2]).toBeGreaterThan(bare[0] + bare[1] + bare[2])
  })
})
