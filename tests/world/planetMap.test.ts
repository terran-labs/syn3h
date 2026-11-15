import { describe, expect, it } from 'vitest'
import { paintPlanetMap, planetCard, settingsForRecipe } from '../../src/world/planetMap'
import { PLANETS, planetName } from '../../src/world/planets'

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
    expect(s.treeCover).toBe(0.75)
  })

  it('is deterministic and depends on seed and recipe', () => {
    const a = paintPlanetMap('volcanic', 4821, W, H)
    const b = paintPlanetMap('volcanic', 4821, W, H)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
    expect(Buffer.from(paintPlanetMap('volcanic', 4822, W, H).data).equals(Buffer.from(a.data))).toBe(false)
    expect(Buffer.from(paintPlanetMap('desert', 4821, W, H).data).equals(Buffer.from(a.data))).toBe(false)
  })

  for (const recipe of PLANETS) {
    it(`${recipe.id}: land at the centre, sea of the right colour at the antipode`, () => {
      const map = paintPlanetMap(recipe.id, 90210, W, H)
      const lava = recipe.values['world.seaKind'] === 0
      const isSea = ([r, g, b]: number[]) => lava ? r > g && r > b : b > r && b >= g * 0.6
      // The very centre is the crater lake, so look at a ring about 400 m out (15 degrees),
      // between the volcano and the coast: it must be land on every recipe.
      const isLand = ([r, g, b]: number[]) => lava ? r > 90 && r < 250 && b < 110 && r - g > 40 : !(b > r && b > g)
      let land = 0
      const ringPx = (15 / 360) * W
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        if (isLand(pixel(map, Math.round(W / 2 + Math.cos(a) * ringPx), Math.round(H / 2 + Math.sin(a) * ringPx)))) land++
      }
      expect(land).toBeGreaterThanOrEqual(12)
      // The antipode (longitude 180, latitude 0) is at the image edge; sample a small ring
      // and require most of it to be sea of the right colour.
      let sea = 0
      for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) for (const y of [H / 2 - 1, H / 2]) { const c = pixel(map, x, y); if (isSea(c) && !isLand(c)) sea++ }
      expect(sea).toBeGreaterThanOrEqual(10)
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
