/**
 * Can you see the centre's summit from the spawn pads on a round world? Pure geometry:
 * a point of height h is visible from an eye of height e, a ground distance d apart on a
 * sphere of radius R, when  d / R  <  acos(R / (R + e)) + acos(R / (R + h)).
 * Prints, per planet kind and size, the pad distance, the summit, the true radius, whether
 * the summit shows at the true radius, and the largest roundness setting at which it does.
 *
 *   npx tsx tools/terrainlab/pad-view.ts
 */
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { planetRadius } from '../../src/world/curve'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../src/world/terrain/settings'

const EYE = 3.5 // chase camera above the pad
const sees = (d: number, R: number, e: number, h: number) => d / R < Math.acos(R / (R + e)) + Math.acos(R / (R + h))
for (const p of PLANETS) {
  // Every planet size the slider offers, 1024 to 4096 m in 256 m steps (stored as a power of two).
  for (let metres = 1024; metres <= 4096; metres += 256) {
    const planetSize = Math.log2(metres / 1024)
    applyPlanet(p.id, 7)
    const d = generateTerrain(7, { ...currentTerrainSettings(), planetSize })
    const s = new HeightSampler(d)
    // The highest ground within the summit's crown.
    let top = 0
    const rim = d.layout.volcano.calderaRadius * 2.4
    for (let x = -rim; x <= rim; x += 4) for (let z = -rim; z <= rim; z += 4) top = Math.max(top, s.heightAt(x, z))
    const pad = d.layout.spawnRadius
    const eye = s.heightAt(d.layout.spawns[0].x, d.layout.spawns[0].z) + EYE
    const R = planetRadius(d.size)
    let best = 0
    for (let c = 1.8; c > 0.005; c -= 0.005) if (sees(pad, R / c, eye, top)) { best = c; break }
    // How close a pad would have to be for the summit to show at the true radius.
    let reach = 0
    for (let x = pad; x > 0; x -= 2) if (sees(x, R, eye, top)) { reach = x; break }
    console.log(`${p.id.padEnd(8)} ${d.size} m: pads ${pad.toFixed(0)} m out (${(pad / R * 57.3).toFixed(0)} deg round), summit ${top.toFixed(0)} m, radius ${R.toFixed(0)} m, visible at true radius: ${sees(pad, R, eye, top) ? 'yes' : 'no'}; visible up to roundness ${best.toFixed(2)} (radius ${(R / best).toFixed(0)} m); at true radius pads would need to be within ${reach.toFixed(0)} m`)
  }
}
