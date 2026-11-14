/**
 * Generate worlds in Node and print timings and the facts that matter for driving:
 * road lengths and grades, river counts, spawn pad flatness.
 *
 *   npx tsx tools/terrainlab/gen-report.ts [seed,seed,...]
 */
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

const seeds = (process.argv[2] ?? '1,7,42').split(',').map(Number)
const settings = defaultTerrainSettings()
generateTerrain(5, settings)
generateTerrain(6, settings)
for (const seed of seeds) {
  const t = performance.now()
  const d = generateTerrain(seed, settings)
  const ms = performance.now() - t
  const s = new HeightSampler(d)
  let lo = Infinity, hi = -Infinity
  for (const h of d.heights) { if (h < lo) lo = h; if (h > hi) hi = h }
  const roads = d.roads.map((r) => {
    let len = 0, maxGrade = 0
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i]
      const ds = Math.hypot(b.x - a.x, b.z - a.z)
      len += ds
      if (ds > 0.5) maxGrade = Math.max(maxGrade, Math.abs(b.y - a.y) / ds)
    }
    const e = r.points[r.points.length - 1]
    return `${r.kind}${r.closed ? '(ring)' : ''} ${len.toFixed(0)}m grade<=${maxGrade.toFixed(2)} y ${r.points[0].y.toFixed(0)}->${e.y.toFixed(0)}`
  })
  const n = { x: 0, y: 0, z: 0 }
  const pads = d.layout.spawns.map((_, i) => { const p = spawnPointAt(s, i); return s.normalAt(p.x, p.z, n).y.toFixed(3) })
  const timings = Object.entries(d.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')
  console.log(`seed ${seed}: ${ms.toFixed(0)} ms (${timings}); heights ${lo.toFixed(0)}..${hi.toFixed(0)}; lake ${d.lava.lake?.surface.toFixed(0)}; rivers ${d.lava.rivers.length} (${d.lava.rivers.map((r) => r.points.length * 6).join(', ')} m); vents ${d.vents.length}`)
  for (const r of roads) console.log('   ' + r)
  console.log('   pad flatness ' + pads.join(' '))
}
