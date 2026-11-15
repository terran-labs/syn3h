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
// KIND=1 for desert, 2 for alpine; other settings can be given as JSON in SETTINGS.
const settings = { ...defaultTerrainSettings(), kind: Number(process.env.KIND ?? 0), ...JSON.parse(process.env.SETTINGS ?? '{}') }
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
    // Cut and fill: how far the natural-looking ground 14 m either side sits below (fill,
    // a causeway) or above (cut) the road. Both sides far below means the road is on a wall.
    let causeway = 0, worstFill = 0, turns = 0
    for (let i = 2; i < r.points.length - 2; i++) {
      const a = r.points[i - 2], b = r.points[i], c = r.points[i + 2]
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1
      const nx = -(c.z - a.z) / len, nz = (c.x - a.x) / len
      const l = s.heightAt(b.x + nx * 16, b.z + nz * 16) - b.y
      const rr = s.heightAt(b.x - nx * 16, b.z - nz * 16) - b.y
      const fill = -Math.max(l, rr)
      if (fill > 6) causeway++
      worstFill = Math.max(worstFill, fill)
    }
    for (let i = 1; i < r.points.length - 1; i++) {
      const a = r.points[i - 1], b = r.points[i], c = r.points[i + 1]
      turns += Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z))
    }
    if (r.kind === 'volcano') return `${r.kind} ${len.toFixed(0)}m grade<=${maxGrade.toFixed(2)} y ${r.points[0].y.toFixed(0)}->${e.y.toFixed(0)}, ${(Math.abs(turns) / (2 * Math.PI)).toFixed(2)} turns, causeway points ${causeway}/${r.points.length}, worst fill ${worstFill.toFixed(0)} m`
    return `${r.kind}${r.closed ? '(ring)' : ''} ${len.toFixed(0)}m grade<=${maxGrade.toFixed(2)} y ${r.points[0].y.toFixed(0)}->${e.y.toFixed(0)}`
  })
  const n = { x: 0, y: 0, z: 0 }
  const pads = d.layout.spawns.map((_, i) => { const p = spawnPointAt(s, i); return s.normalAt(p.x, p.z, n).y.toFixed(3) })
  const timings = Object.entries(d.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')
  console.log(`seed ${seed}: ${ms.toFixed(0)} ms (${timings}); heights ${lo.toFixed(0)}..${hi.toFixed(0)}; lake ${d.lava.lake?.surface.toFixed(0)}; rivers ${d.lava.rivers.length} (${d.lava.rivers.map((r) => r.points.length * 6).join(', ')} m); vents ${d.vents.length}`)
  for (const r of roads) console.log('   ' + r)
  console.log('   pad flatness ' + pads.join(' '))
}
