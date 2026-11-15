/**
 * Summit arena facts for King of the Hill: how much of the crater edge is open between the
 * rock fangs, how wide the gaps are, and whether anything inside the crater is dry ground
 * a vehicle could rest on without being in the lava or able to drive out.
 *
 *   npx tsx tools/terrainlab/summit-report.ts [seed,seed,...]
 */
import { generateTerrain, rimRadius } from '../../src/world/terrain/generate'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const seeds = (process.argv[2] ?? '1,2,3,7,42,99,777,12345').split(',').map(Number)
const settings = defaultTerrainSettings()
for (const seed of seeds) {
  const d = generateTerrain(seed, settings)
  const s = new HeightSampler(d)
  const v = d.layout.volcano
  const rc = v.calderaRadius
  const top = d.layout.summitHeight
  const N = 720
  // A direction is open if a car can roll from the ring road to the crater edge: no step
  // higher than 1.2 m above the summit anywhere along that radial line.
  const open: boolean[] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const ux = Math.cos(a), uz = Math.sin(a)
    let worst = 0
    for (let r = rc * 0.98; r <= rimRadius(v) - 10; r += 1) worst = Math.max(worst, s.heightAt(ux * r, uz * r) - top)
    open.push(worst < 1.2)
  }
  const arc = (2 * Math.PI * rc) / N
  const gaps: number[] = []
  let run = 0
  const startAt = open.indexOf(false)
  for (let k = 0; k < N; k++) {
    const i = (startAt + 1 + k) % N
    if (open[i]) run++
    else if (run) { gaps.push(run * arc); run = 0 }
  }
  if (run) gaps.push(run * arc)
  // Dry ledges inside the crater: ground above the lake but flat enough to park on,
  // more than 3 m below the summit (so not just the lip).
  let ledges = 0
  let checked = 0
  const lake = d.lava.lake!
  for (let x = -rc; x <= rc; x += 2) {
    for (let z = -rc; z <= rc; z += 2) {
      const r = Math.hypot(x, z)
      if (r > rc * 0.99) continue
      checked++
      const h = s.heightAt(x, z)
      if (h <= lavaSurfaceAt(d.lava, x, z, 0)) continue
      if (h > top - 3) continue
      const slope = Math.hypot(s.heightAt(x + 1, z) - s.heightAt(x - 1, z), s.heightAt(x, z + 1) - s.heightAt(x, z - 1)) / 2
      if (slope < 0.45) ledges++
    }
  }
  const openShare = open.filter(Boolean).length / N
  console.log(`seed ${seed}: crater edge ${(openShare * 100).toFixed(0)}% open, ${gaps.length} gaps, widths ${gaps.map((g) => g.toFixed(0)).join(', ')} m; ` +
    `lake ${(top - lake.surface).toFixed(1)} m below summit; parkable dry ledges in crater: ${ledges} of ${checked} samples`)
}
