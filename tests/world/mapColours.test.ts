import { describe, expect, it } from 'vitest'
import { bakeMapColours, MAP_GRID } from '../../src/world/terrain/mapColours'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { settingsForRecipe } from '../../src/world/planetMap'
import { PLANETS } from '../../src/world/planets'
import { paletteFor, SEA_ICE } from '../../src/world/terrain/palettes'

const hue = (c: number) => [c >> 16 & 255, c >> 8 & 255, c & 255]
const near = (a: number, b: number, tolerance: number) => Math.hypot(...hue(a).map((v, i) => v - hue(b)[i])) < tolerance

describe('map colours', () => {
  const world = (id: string) => { const data = generateTerrain(7, settingsForRecipe(PLANETS.find(p => p.id === id)!), { resolution: 129 }); return { data, sampler: new HeightSampler(data) } }
  const deepest = (data: ReturnType<typeof world>['data']) => { let k = 0; for (let i = 1; i < data.heights.length; i++) if (data.heights[i] < data.heights[k]) k = i; return k }
  it('show each world in its own palette, its sea as its sea, and a frozen sea as ice', () => {
    for (const [id, opts] of [['alpine', { lava: false, frozen: false }], ['ice', { lava: false, frozen: true }], ['volcanic', { lava: true, frozen: false }]] as const) {
      const { data, sampler } = world(id), grid = bakeMapColours(data, sampler, { sea: 0, ...opts, snow: 1e6 })
      expect(grid.length).toBe(MAP_GRID * MAP_GRID)
      // The deepest point of the tile, in grid cells.
      const k = deepest(data), n = data.resolution, gx = Math.min(MAP_GRID - 1, Math.floor((k % n) / (n - 1) * MAP_GRID)), gz = Math.min(MAP_GRID - 1, Math.floor(Math.floor(k / n) / (n - 1) * MAP_GRID))
      const sea = grid[gz * MAP_GRID + gx], pal = paletteFor(data.settings.look)
      if (opts.frozen) expect(near(sea, SEA_ICE.old, 60) || near(sea, SEA_ICE.floe, 60)).toBe(true)
      else if (opts.lava) expect(hue(sea)[0]).toBeGreaterThan(hue(sea)[2])
      else expect(near(sea, pal.seaDeep, 40)).toBe(true)
      // Most land cells sit near the world's ground colours, not a shared brown.
      const grounds = [pal.groundDark, pal.groundLight, pal.rockDark, pal.shore, pal.snow]
      let own = 0, land = 0
      for (let i = 0; i < grid.length; i += 37) { const h = sampler.heightAt(((i % MAP_GRID + 0.5) / MAP_GRID - 0.5) * data.size, ((Math.floor(i / MAP_GRID) + 0.5) / MAP_GRID - 0.5) * data.size); if (h <= 1) continue; land++; if (grounds.some(g => near(grid[i], g, 90))) own++ }
      expect(own / land).toBeGreaterThan(0.85)
    }
  })
})
