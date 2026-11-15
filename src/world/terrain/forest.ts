/**
 * Flora pass: where every plant stands, decided from the seed so every client plants the
 * identical flora. Nothing here renders; see trees.ts.
 *
 * Data shape (`data.trees`): a flat Float32Array, five numbers per plant:
 *
 *   x, y, z      the foot of the plant on the ground, world metres
 *   scale        size multiplier, about 0.6 to 1.6 (see SPECIES_HEIGHT for scale 1)
 *   species      one of the SPECIES ids below, stored as a float
 *
 * Plants stand on a jittered grid (one candidate per cell, so none overlap). What grows
 * depends on the kind of world:
 *
 *   alpine    conifer woods with clearings, rounder broadleaf trees on low ground by the
 *             coast, and bushes scattered through the clearings
 *   desert    sparse cacti on the plains, palms in clumps along the coast and round the
 *             summit oasis
 *   volcanic  sparse charred dead trunks, and glowing crystal shards by the lava rivers
 *             and along the lava shore
 *
 * Every plant is on dry ground above the sea, on a slope gentle enough to hold it, and
 * clear of roads, spawn pads, rivers, pools and the lake. `treeCover` scales how much grows.
 */
import { SPAWN_BLEND_RADIUS, type TerrainData, type TerrainPass } from './generate'
import { fbm, hash2, smoothstep, subSeed } from './noise'
import { distanceToPolyline } from './raster'
import { ROAD_FLAT_HALF } from './roads'
import { HeightSampler } from './sampler'
import { KIND_ALPINE, KIND_DESERT } from './settings'

/** Metres between plant candidates. */
const SPACING = 9
/** Hard cap, so a slider cannot ask for more than phones can draw. */
export const MAX_TREES = 14000
export const TREE_STRIDE = 5

export const SPECIES = {
  conifer: 0,
  broadleaf: 1,
  bush: 2,
  cactus: 3,
  palm: 4,
  snag: 5,
  crystal: 6,
} as const
export const SPECIES_COUNT = 7
/** Lowest plants must stand at least this far above the sea surface. */
export const MIN_PLANT_HEIGHT = 3.5
/** Plants keep this far from a road centreline. */
export const ROAD_CLEARANCE = ROAD_FLAT_HALF + 5

// Eight compass directions as literals (no Math.cos in placement).
const D = 0.7071067811865476
const DIRS = [[1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D], [0, -1], [D, -D]] as const

/** True if open liquid (ground below the sea surface) is within `r` metres. */
function nearSea(s: HeightSampler, x: number, z: number, r: number): boolean {
  for (const [dx, dz] of DIRS) {
    if (s.heightAt(x + dx * r, z + dz * r) < 0.5) return true
    if (s.heightAt(x + dx * r * 0.5, z + dz * r * 0.5) < 0.5) return true
  }
  return false
}

/** Distance from (x, z) to the nearest lava river edge, or Infinity if none is near. */
function riverEdgeDistance(data: TerrainData, x: number, z: number, within: number): number {
  let best = Infinity
  for (const r of data.lava.rivers) {
    const b = r.bounds
    if (x < b.minX - within || x > b.maxX + within || z < b.minZ - within || z > b.maxZ + within) continue
    const d = distanceToPolyline(r.points, false, x, z) - r.width * 0.5
    if (d < best) best = d
  }
  return best
}

const unit = (bits: number) => (bits & 1023) / 1023

export const forestPass: TerrainPass = {
  name: 'forest',
  run(data) {
    const cover = data.settings.treeCover
    if (!(cover > 0)) { data.trees = new Float32Array(0); return }
    const kind = data.settings.kind
    const L = data.layout
    const s = new HeightSampler(data)
    const seed = subSeed(data.seed, 70)
    const maskSeed = subSeed(data.seed, 71)
    const half = data.size / 2
    // Trees thin out toward the tree line, well below the snow.
    const treeLine = L.summitHeight * 0.42
    const lake = data.lava.lake
    const n = { x: 0, y: 0, z: 0 }
    const out: number[] = []
    const cells = Math.floor(data.size / SPACING)
    const reach = L.islandRadius * 1.25
    const edge0 = 0.62 - cover * 1.1
    // Sparse kinds: cover 0.5 plants the intended density; the slider scales it.
    const sparse = cover * 2
    const padR2 = (SPAWN_BLEND_RADIUS * 0.6) * (SPAWN_BLEND_RADIUS * 0.6)
    for (let cz = 0; cz < cells && out.length < MAX_TREES * TREE_STRIDE; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        const h = hash2(cx, cz, seed)
        const h2 = hash2(cx, cz, seed + 1)
        const x = -half + (cx + 0.15 + 0.7 * unit(h)) * SPACING
        const z = -half + (cz + 0.15 + 0.7 * unit(h >>> 10)) * SPACING
        if (x * x + z * z > reach * reach) continue
        const y = s.heightAt(x, z)
        if (y < MIN_PLANT_HEIGHT) continue
        const roll = unit(h >>> 20)
        const pick = unit(h2 >>> 10)

        // Decide what would grow here before the costlier clearance checks.
        let species = -1
        let minNormal = 0.86
        let respectVolcanic = true
        if (kind === KIND_ALPINE) {
          if (y > treeLine) continue
          // Woods and clearings, with stragglers thinning toward the edge of each wood.
          const m = fbm(x * 0.0035, z * 0.0035, maskSeed, 2)
          const chance = smoothstep(edge0, edge0 + 0.22, m) * smoothstep(treeLine, treeLine * 0.7, y)
          if (roll < chance) {
            // Low ground by the coast grows broadleaf trees among the conifers.
            const lowland = y < 28 && pick < 0.75 && nearSea(s, x, z, 110)
            species = lowland ? SPECIES.broadleaf : SPECIES.conifer
          } else if (pick < 0.07 * (1 - chance)) {
            species = SPECIES.bush
            minNormal = 0.8
          } else continue
        } else if (kind === KIND_DESERT) {
          const oasis = lake !== null && y > lake.surface + 0.8 &&
            (x - lake.x) * (x - lake.x) + (z - lake.z) * (z - lake.z) < (lake.radius + 45) * (lake.radius + 45)
          if (oasis) {
            if (roll >= 0.5 * sparse) continue
            species = SPECIES.palm
          } else {
            if (y > treeLine) continue
            // Palms come in clumps along the shore; cacti dot the plains.
            const clump = fbm(x * 0.012, z * 0.012, maskSeed, 2)
            if (y < 22 && clump > 0.05 && roll < 0.55 * sparse && nearSea(s, x, z, 60)) species = SPECIES.palm
            else if (pick < 0.03 * sparse) species = SPECIES.cactus
            else continue
          }
        } else {
          // Volcanic: crystals by the lava, dead trunks scattered on the plains.
          const river = riverEdgeDistance(data, x, z, 20)
          if (river < 3) continue
          if (river < 18 && roll < 0.35 * sparse) {
            species = SPECIES.crystal
            respectVolcanic = false
            minNormal = 0.8
          } else if (y < 14 && roll < 0.22 * sparse && nearSea(s, x, z, 36)) {
            species = SPECIES.crystal
            minNormal = 0.8
          } else if (y < treeLine && pick < 0.02 * sparse) {
            species = SPECIES.snag
          } else continue
        }

        if (s.normalAt(x, z, n).y < minNormal) continue
        const i = Math.round((z + half) / data.cell) * data.resolution + Math.round((x + half) / data.cell)
        if (data.roadDist[i] < ROAD_CLEARANCE) continue
        if (respectVolcanic && data.volcanic[i] > 0.75) continue
        if (lake && y < lake.surface + 0.8 &&
          (x - lake.x) * (x - lake.x) + (z - lake.z) * (z - lake.z) < (lake.radius + 5) * (lake.radius + 5)) continue
        let clear = true
        for (const p of L.spawns) {
          const dx = x - p.x
          const dz = z - p.z
          if (dx * dx + dz * dz < padR2) { clear = false; break }
        }
        if (!clear) continue
        for (const p of data.lava.pools) {
          const dx = x - p.x
          const dz = z - p.z
          const r = p.radius + 4
          if (dx * dx + dz * dz < r * r) { clear = false; break }
        }
        if (!clear) continue
        if (species !== SPECIES.crystal && riverEdgeDistance(data, x, z, 6) < 4) continue
        out.push(x, y, z, 0.6 + unit(h2), species)
        if (out.length >= MAX_TREES * TREE_STRIDE) break
      }
    }
    data.trees = new Float32Array(out)
  },
}
