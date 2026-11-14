/**
 * Time the generator's passes, best of several runs, so a busy machine does not hide the
 * real cost.   npx tsx tools/terrainlab/profile.ts [runs]
 */
import { generateTerrain } from '../../src/world/terrain/generate'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const runs = Number(process.argv[2] ?? 12)
const settings = defaultTerrainSettings()
const best: Record<string, number> = {}
let bestTotal = Infinity
for (let i = 0; i < runs; i++) {
  const t = performance.now()
  const d = generateTerrain(100 + i, settings)
  const total = performance.now() - t
  if (i < 2) continue // JIT warm up
  bestTotal = Math.min(bestTotal, total)
  for (const k in d.timings) best[k] = Math.min(best[k] ?? Infinity, d.timings[k])
}
console.log(`best total ${bestTotal.toFixed(1)} ms; ` + Object.entries(best).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '))
