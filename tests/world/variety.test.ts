import { describe, expect, it } from 'vitest'
import { coneProfile, generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

const settings = defaultTerrainSettings()

describe('variety across seeds', () => {
  it('differs in layout and route but always has a flat spawn and a road to the rim', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => 1000 + i * 7919)
    const volcanoes = new Set<string>()
    const cones = new Set<number>()
    const mesas = new Set<number>()
    const firstTurns = new Set<string>()
    const n = { x: 0, y: 0, z: 0 }
    for (const seed of seeds) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      volcanoes.add(`${Math.round(v.x / 100)},${Math.round(v.z / 100)}`)
      cones.add(d.layout.cones.length)
      mesas.add(d.layout.mesas.length)
      const main = d.roads.find((r) => r.kind === 'volcano')!
      const p = main.points[Math.floor(main.points.length / 2)]
      firstTurns.add(`${Math.round(p.x / 100)},${Math.round(p.z / 100)}`)
      for (let i = 0; i < 8; i++) {
        const sp = spawnPointAt(s, i)
        expect(s.normalAt(sp.x, sp.z, n).y).toBeGreaterThan(0.99)
      }
      const end = main.points[main.points.length - 1]
      expect(end.y).toBeGreaterThan(v.height * coneProfile(v.calderaRadius / v.radius) * 0.75)
    }
    process.stdout.write(`variety: ${volcanoes.size} volcano sites, cone counts ${[...cones]}, mesa counts ${[...mesas]}, ${firstTurns.size} distinct road midpoints over ${seeds.length} seeds\n`)
    expect(volcanoes.size).toBeGreaterThan(10)
    expect(cones.size).toBeGreaterThanOrEqual(2)
    expect(mesas.size).toBeGreaterThanOrEqual(3)
    expect(firstTurns.size).toBeGreaterThan(10)
  })
})
