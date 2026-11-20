import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

const settings = defaultTerrainSettings()

describe('variety across seeds', () => {
  it('differs in coast, mountains and route but always has flat spawns and a road to the summit', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => 1000 + i * 7919)
    const axes = new Set<string>()
    const coasts = new Set<number>()
    const mountains = new Set<number>()
    const midpoints = new Set<string>()
    const rivers = new Set<number>()
    const n = { x: 0, y: 0, z: 0 }
    for (const seed of seeds) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      // Which way the gentle flank (and so the road and pad 0) faces, to 30 degrees.
      axes.add(`${Math.round(v.gentleX * 2)},${Math.round(v.gentleZ * 2)}`)
      let land = 0
      let high = 0
      const r2 = (v.radius * 1.5) * (v.radius * 1.5)
      const half = d.size / 2
      for (let iz = 0; iz < d.resolution; iz += 4) {
        for (let ix = 0; ix < d.resolution; ix += 4) {
          const h = d.heights[iz * d.resolution + ix]
          if (h > 0) land++
          const x = -half + ix * d.cell
          const z = -half + iz * d.cell
          // Mountains: high ground outside the volcano.
          if (h > 60 && x * x + z * z > r2) high++
        }
      }
      coasts.add(Math.round(land / 100))
      mountains.add(Math.round(high / 25))
      rivers.add(d.lava.rivers.length)
      const main = d.roads.find((r) => r.kind === 'volcano')!
      const p = main.points[Math.floor(main.points.length / 2)]
      midpoints.add(`${Math.round(p.x / 100)},${Math.round(p.z / 100)}`)
      for (let i = 0; i < 8; i++) {
        const sp = spawnPointAt(s, i)
        expect(s.normalAt(sp.x, sp.z, n).y).toBeGreaterThan(0.99)
      }
      const end = main.points[main.points.length - 1]
      expect(Math.abs(end.y - d.layout.summitHeight)).toBeLessThan(6)
    }
    process.stdout.write(`variety: ${axes.size} road sides, ${coasts.size} coast sizes, ${mountains.size} mountain covers, river counts ${[...rivers]}, ${midpoints.size} distinct road midpoints over ${seeds.length} seeds\n`)
    expect(axes.size).toBeGreaterThanOrEqual(5)
    // The amount of land no longer varies with the seed: the land share slider sets it.
    expect(mountains.size).toBeGreaterThanOrEqual(6)
    expect(midpoints.size).toBeGreaterThan(8)
  })
})
