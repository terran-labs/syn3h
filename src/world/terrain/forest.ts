/**
 * Forest pass: where every tree stands, decided from the seed so every client plants the
 * identical forest. Nothing here renders; see trees.ts.
 *
 * Data shape (`data.trees`): a flat Float32Array, four numbers per tree:
 *
 *   x, y, z      the foot of the trunk on the ground, world metres
 *   scale        height multiplier, about 0.6 to 1.6 (a scale 1 tree is about 11 m tall)
 *
 * Trees stand on a jittered grid (one candidate per cell, so none overlap). A candidate
 * grows if it is on dry ground below the tree line, on a slope gentle enough to hold soil,
 * inside a forest patch (a low frequency mask, so there are woods and clearings), and clear
 * of roads, spawn pads, rivers and pools. `treeCover` is the share of the land in forest.
 */
import { SPAWN_BLEND_RADIUS, type TerrainData, type TerrainPass } from './generate'
import { fbm, hash2, smoothstep, subSeed } from './noise'
import { ROAD_FLAT_HALF } from './roads'
import { HeightSampler } from './sampler'

/** Metres between tree candidates. */
const SPACING = 9
/** Hard cap, so a slider cannot ask for more than phones can draw. */
export const MAX_TREES = 14000
export const TREE_STRIDE = 4

export const forestPass: TerrainPass = {
  name: 'forest',
  run(data) {
    const cover = data.settings.treeCover
    if (!(cover > 0)) { data.trees = new Float32Array(0); return }
    const L = data.layout
    const s = new HeightSampler(data)
    const seed = subSeed(data.seed, 70)
    const maskSeed = subSeed(data.seed, 71)
    const half = data.size / 2
    // Trees thin out toward the tree line, well below the snow.
    const treeLine = L.summitHeight * 0.42
    const n = { x: 0, y: 0, z: 0 }
    const out: number[] = []
    const cells = Math.floor(data.size / SPACING)
    const reach = L.islandRadius * 1.25
    const edge0 = 0.62 - cover * 1.1
    for (let cz = 0; cz < cells && out.length < MAX_TREES * TREE_STRIDE; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        const h = hash2(cx, cz, seed)
        const x = -half + (cx + 0.15 + 0.7 * ((h & 1023) / 1023)) * SPACING
        const z = -half + (cz + 0.15 + 0.7 * (((h >>> 10) & 1023) / 1023)) * SPACING
        if (x * x + z * z > reach * reach) continue
        const y = s.heightAt(x, z)
        if (y < 3.5 || y > treeLine) continue
        // Woods and clearings, with stragglers thinning toward the edge of each wood.
        const m = fbm(x * 0.0035, z * 0.0035, maskSeed, 2)
        const chance = smoothstep(edge0, edge0 + 0.22, m) * smoothstep(treeLine, treeLine * 0.7, y)
        if (((h >>> 20) & 1023) / 1023 >= chance) continue
        if (s.normalAt(x, z, n).y < 0.86) continue
        const i = Math.round((z + half) / data.cell) * data.resolution + Math.round((x + half) / data.cell)
        if (data.roadDist[i] < ROAD_FLAT_HALF + 5) continue
        if (data.volcanic[i] > 0.75) continue
        let clear = true
        for (const p of L.spawns) {
          const dx = x - p.x
          const dz = z - p.z
          if (dx * dx + dz * dz < (SPAWN_BLEND_RADIUS * 0.6) * (SPAWN_BLEND_RADIUS * 0.6)) { clear = false; break }
        }
        if (!clear) continue
        out.push(x, y, z, 0.6 + ((hash2(cx, cz, seed + 1) & 1023) / 1023))
        if (out.length >= MAX_TREES * TREE_STRIDE) break
      }
    }
    data.trees = new Float32Array(out)
  },
}
