/**
 * Fords, in numbers: with `terrain.fords` on, how long the rivers are, how many reach the
 * sea, and how deep the water lies over each road they cross.
 *
 *   npx tsx tools/terrainlab/ford-report.ts [seeds]
 */
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../src/world/terrain/settings'

const seeds = (process.argv[2] ?? '1,7,42,99,2,3').split(',').map(Number)
for (const p of PLANETS) {
  for (const seed of seeds) {
    applyPlanet(p.id, seed)
    const d = generateTerrain(seed, { ...currentTerrainSettings(), fords: 1 })
    const s = new HeightSampler(d)
    const rivers = d.lava.rivers.map((r) => {
      const e = r.points[r.points.length - 1]
      return `${r.points.length * 6}m${s.heightAt(e.x, e.z) < 4 ? ' to sea' : ''}`
    })
    const fords = d.roads.flatMap((r) => r.fords.map((f) => `${r.kind} ${(f.end - f.start + 1) * 4}m long ${f.depth.toFixed(2)}m deep`))
    console.log(`${p.id} ${seed}: rivers ${rivers.join(', ') || 'none'} | fords ${fords.join('; ') || 'none'}`)
  }
}
