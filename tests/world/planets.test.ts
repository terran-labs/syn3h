import { describe, expect, it } from 'vitest'
import { params, worldSeed } from '../../shared/params'
import { PLANETS, applyPlanet, currentPlanet, decodeWorld, encodeWorld, planetName } from '../../src/world/planets'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings, worldSeaKind } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

describe('planet recipes', () => {
  it('every recipe only sets parameters that exist, within their ranges', () => {
    for (const p of PLANETS) {
      for (const id in p.values) {
        const param = params.get(id)
        expect(param, `${p.id}: ${id}`).toBeTruthy()
        const def = param!.def as { min?: number; max?: number }
        const v = p.values[id]
        if (typeof v === 'number' && def.min !== undefined) {
          expect(v, `${p.id}: ${id}`).toBeGreaterThanOrEqual(def.min)
          expect(v, `${p.id}: ${id}`).toBeLessThanOrEqual(def.max!)
        }
      }
    }
  })

  it('every kind of planet generates a drivable island on several seeds', () => {
    const n = { x: 0, y: 0, z: 0 }
    for (const p of PLANETS) {
      for (const seed of [1, 7, 4242]) {
        applyPlanet(p.id, seed)
        expect(currentPlanet().id).toBe(p.id)
        const d = generateTerrain(seed, currentTerrainSettings())
        const s = new HeightSampler(d)
        // Flat spawn pads above the sea.
        for (let i = 0; i < 8; i++) {
          const sp = spawnPointAt(s, i)
          expect(s.normalAt(sp.x, sp.z, n).y, `${p.id} ${seed} pad ${i}`).toBeGreaterThan(0.99)
          expect(sp.y).toBeGreaterThan(5)
        }
        // A road from pad 0 to the summit, inside the grade cap.
        const road = d.roads.find((r) => r.kind === 'volcano')!
        const end = road.points[road.points.length - 1]
        expect(Math.abs(end.y - d.layout.summitHeight), `${p.id} ${seed} road end`).toBeLessThan(6)
        let worst = 0
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i]
          const ds = Math.hypot(b.x - a.x, b.z - a.z)
          if (ds > 0.5) worst = Math.max(worst, Math.abs(b.y - a.y) / ds)
        }
        expect(worst, `${p.id} ${seed} grade`).toBeLessThan(0.21)
        // Fire only on the volcanic world; forest only where the recipe asks for it.
        expect(d.vents.length > 0).toBe(p.id === 'volcanic')
        expect(d.trees.length > 0).toBe((p.values['terrain.treeCover'] as number) > 0)
        expect(d.lava.lake).not.toBeNull()
      }
    }
    applyPlanet('volcanic', 1)
  }, 60000)

  it('names are pronounceable, stable and varied', () => {
    expect(planetName(4821)).toBe(planetName(4821))
    const names = new Set(Array.from({ length: 500 }, (_, i) => planetName(i + 1)))
    expect(names.size).toBeGreaterThan(300)
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+( [IVX]+)?$/)
  })

  it('a share string restores the kind, the seed and the sliders the host moved', () => {
    applyPlanet('alpine', 90210)
    params.set('world.lavaAltitude', 12)
    params.set('terrain.islandRadius', 520)
    const text = encodeWorld()
    expect(text.startsWith('alpine.90210~')).toBe(true)
    applyPlanet('volcanic', 1)
    expect(decodeWorld(text)).toBe(true)
    expect(currentPlanet().id).toBe('alpine')
    expect(worldSeed.value).toBe(90210)
    expect(params.get('world.lavaAltitude')!.value).toBe(12)
    expect(params.get('terrain.islandRadius')!.value).toBe(520)
    expect(worldSeaKind.value).toBe(1)
    // An untouched planet is just its id and seed.
    applyPlanet('desert', 77)
    expect(encodeWorld()).toBe('desert.77')
    expect(decodeWorld('not a world')).toBe(false)
    applyPlanet('volcanic', 1)
    for (const id of ['world.lavaAltitude', 'terrain.islandRadius']) params.set(id, params.get(id)!.def.default)
  })
})
