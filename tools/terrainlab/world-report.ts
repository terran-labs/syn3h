/**
 * Facts about generated worlds as wrapping tiles: how much is land, whether the opposite
 * edges match (so the tile repeats seamlessly), and how long generation takes, for each
 * planet size and a range of land shares.
 *
 *   npx tsx tools/terrainlab/world-report.ts [seed,seed]
 */
import { generateTerrain } from '../../src/world/terrain/generate'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const seeds = (process.argv[2] ?? '1,7,42').split(',').map(Number)
generateTerrain(3, defaultTerrainSettings())
for (const planetSize of [0, 1, 2]) {
  for (const landShare of planetSize === 1 ? [0.2, 0.35, 0.5, 0.65, 0.8] : [0.5]) {
    const row: string[] = []
    for (const seed of seeds) {
      const s = { ...defaultTerrainSettings(), planetSize, landShare, kind: Number(process.env.KIND ?? 0) }
      const t = performance.now()
      const d = generateTerrain(seed, s)
      const ms = performance.now() - t
      const n = d.resolution, h = d.heights
      let land = 0
      for (let i = 0; i < h.length; i++) if (h[i] > 0) land++
      let seam = 0, edgeLand = 0
      for (let i = 0; i < n; i++) {
        seam = Math.max(seam, Math.abs(h[i] - h[(n - 1) * n + i]), Math.abs(h[i * n] - h[i * n + n - 1]))
        if (h[i] > 0) edgeLand++
        if (h[i * n] > 0) edgeLand++
      }
      row.push(`land ${(100 * land / h.length).toFixed(0)}% seam ${seam.toFixed(3)} m edge land ${(50 * edgeLand / n).toFixed(0)}% ${ms.toFixed(0)} ms roads ${d.roads.length} plants ${d.trees.length / 5}`)
    }
    console.log(`size ${d0(planetSize)} share ${landShare}: ` + row.join(' | '))
  }
}
function d0(p: number) { return ['1 km', '2 km', '4 km'][p] }
