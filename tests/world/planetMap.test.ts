import { describe, expect, it } from 'vitest'
import { paintPlanetMap, planetCard, settingsForRecipe } from '../../src/world/planetMap'
import { PLANETS, planetName } from '../../src/world/planets'
import { SEA_ICE, paletteFor } from '../../src/world/terrain/palettes'
import { generateTerrain } from '../../src/world/terrain/generate'

const W = 256, H = 128

function pixel(map: { width: number; data: Uint8ClampedArray }, x: number, y: number): [number, number, number] {
  const o = (y * map.width + x) * 4
  return [map.data[o], map.data[o + 1], map.data[o + 2]]
}

describe('planet maps', () => {
  it('maps recipe values onto terrain settings', () => {
    const s = settingsForRecipe(PLANETS.find((p) => p.id === 'alpine')!)
    expect(s.kind).toBe(2)
    expect(s.volcanoHeight).toBe(600)
    expect(s.treeCover).toBe(PLANETS.find((p) => p.id === 'alpine')!.values['terrain.treeCover'])
  })

  it('is deterministic and depends on seed and recipe', () => {
    const a = paintPlanetMap('volcanic', 4821, W, H)
    const b = paintPlanetMap('volcanic', 4821, W, H)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
    expect(Buffer.from(paintPlanetMap('volcanic', 4822, W, H).data).equals(Buffer.from(a.data))).toBe(false)
    expect(Buffer.from(paintPlanetMap('desert', 4821, W, H).data).equals(Buffer.from(a.data))).toBe(false)
  })

  for (const recipe of PLANETS) {
    it(`${recipe.id}: the globe is its own world, in its own palette and true land share`, () => {
      const map = paintPlanetMap(recipe.id, 90210, W, H)
      const settings = settingsForRecipe(recipe)
      const lava = recipe.values['world.seaKind'] === 0
      const dry = settings.dry > 0
      // A frozen sea is ice, painted dry like land (planetMap.ts), in the sea ice colours.
      const frozen = !lava && recipe.values['world.seaFrozen'] === true
      // The island sits at longitude 0, latitude 0, where the dive lands: a ring round its
      // centre (past any crater lake) is dry ground on every recipe.
      let ring = 0
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = Math.round(W / 2 + Math.cos(a) * W * 0.03), y = Math.round(H / 2 + Math.sin(a) * W * 0.03)
        if (map.data[(y * W + x) * 4 + 3] > 128) ring++
      }
      expect(ring).toBeGreaterThanOrEqual(12)
      // Sea where the world has sea, as much as it has: away from the poles, the share of dry
      // pixels is the generated tile's land share. A dry world has none at all.
      const terrain = generateTerrain(90210, settings, { resolution: 129 })
      const sea = Number(recipe.values['world.lavaAltitude'] ?? 0)
      // The band sampled, latitudes within 36 degrees, is the tile's rows within a fifth of its side of the island.
      const n = terrain.resolution, rows = Array.from({ length: n }, (_, iz) => iz).filter(iz => Math.abs(iz / (n - 1) - 0.5) < 0.2)
      const band = rows.flatMap(iz => Array.from(terrain.heights.subarray(iz * n, iz * n + n - 1)))
      const share = dry || frozen ? 1 : band.filter(h => h > sea).length / band.length
      let dryPixels = 0, counted = 0
      for (let y = Math.round(H * 0.3); y < Math.round(H * 0.7); y++) for (let x = 0; x < W; x++) { counted++; if (map.data[(y * W + x) * 4 + 3] > 128) dryPixels++ }
      if (dry) expect(dryPixels).toBe(counted)
      else if (frozen) expect(dryPixels / counted).toBeGreaterThan(0.92)
      else expect(Math.abs(dryPixels / counted - share)).toBeLessThan(0.08)
      // Every pixel comes from the biome's palette: its ground, rock, snow and shore (lit or
      // shaded), its own sea or lava. Nothing borrowed, no default blue.
      const pal = paletteFor(settings.look)
      const rgb = (hex: number, k = 1) => [((hex >> 16) & 255) * k, ((hex >> 8) & 255) * k, (hex & 255) * k]
      const own = [pal.groundDark, pal.groundLight, pal.rockDark, pal.rockLight, pal.darkRockA, pal.darkRockB, pal.shore, pal.snow, pal.roadLine,
        ...(dry ? [] : lava ? [0x2a0703, 0xff7a1a, 0xffd27a] : [pal.seaDeep, pal.seaShallow, 0xf2fbff]),
        ...(frozen ? [SEA_ICE.floe, SEA_ICE.old, SEA_ICE.scour, SEA_ICE.crack] : [])]
        .flatMap(hex => [rgb(hex, 0.6), rgb(hex, 0.85), rgb(hex), rgb(hex, 1.2)])
      const near = (c: number[]) => Math.min(...own.map(k => Math.hypot(c[0] - k[0], c[1] - k[1], c[2] - k[2])))
      let inPalette = 0, sampled = 0
      for (let y = 2; y < H; y += 5) for (let x = 1; x < W; x += 5) { sampled++; if (near(pixel(map, x, y)) < 60) inPalette++ }
      expect(inPalette / sampled).toBeGreaterThan(0.9)
    })
  }

  it('paints 1024 x 512 in a reasonable time', () => {
    paintPlanetMap('alpine', 1, 128, 64)
    const t = performance.now()
    const map = paintPlanetMap('alpine', 77, 1024, 512)
    const ms = performance.now() - t
    console.log(`paintPlanetMap 1024x512: ${ms.toFixed(0)} ms`)
    expect(map.data.length).toBe(1024 * 512 * 4)
    expect(ms).toBeLessThan(1500)
  })

  it('builds a lobby card', () => {
    const card = planetCard('volcanic', 4821)
    expect(card).toMatchObject({ id: 'volcanic', label: 'Volcanic', name: planetName(4821), seed: 4821, sea: 'lava' })
    expect(planetCard('desert', 3).sea).toBe('water')
  })
})
