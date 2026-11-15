/**
 * Procedural island world: a pure function of (seed, settings).
 *
 * Every world is one island. The most interesting thing, a volcano with a lava lake, stands
 * at the centre. Players spawn on pads around a ring near the coast, facing inward, and the
 * liquid (lava or water) runs to the horizon in every direction, so the map pushes players
 * toward each other instead of letting them wander off across an endless plain.
 *
 * The recipe follows the MapMagic graphs shipped with Syn3h (Tholus and Xylia), which were
 * built the same way: a radial form for the island, terraced noise for the ground, a chain
 * of cellular Voronoi for the mountains, and a shore at the waterline.
 *
 * Generation is a list of passes over one height grid:
 *
 *   layout  pick directions and feature positions from the seed
 *   shape   sample the analytic height field onto the grid
 *   roads   plan graded roads and level the ground under them (roads.ts)
 *   lava    caldera lake, rivers with carved channels, pools (lava.ts)
 *   vents   flame, ember and smoke emitter anchors (lava.ts)
 *
 * Heights are metres above the sea surface, which is 0. Nothing here touches three.js,
 * Rapier or the DOM, so it runs in tests, a worker or a server unchanged. See noise.ts for
 * the determinism rules this file must follow.
 */
import { fbm, hash2, perlin, ridged, rng, smoothstep, subSeed } from './noise'
import { type LavaFeatures, type Vent, lavaPass, ventsPass } from './lava'
import { type Road, roadsPass } from './roads'
import type { TerrainSettings } from './settings'

export const DEFAULT_WORLD_SIZE = 2048
/** Samples per side. 513 gives 4 m cells; see the report in tests/world for timings. */
export const DEFAULT_RESOLUTION = 513
/** The liquid surface around the island. All heights are measured from it. */
export const SEA_LEVEL = 0
/** Height of the open plains and of every spawn pad above the sea. */
export const SPAWN_LEVEL = 14
/** Radius of each perfectly flat spawn pad, and where it has fully blended back to terrain. */
export const SPAWN_FLAT_RADIUS = 26
export const SPAWN_BLEND_RADIUS = 80
/** Spawn pads around the island. */
export const SPAWN_PADS = 8
/** Spawn ring radius as a fraction of the island radius. See `spawnRingRadius`. */
export const SPAWN_RING = 0.74
/** roadDist value meaning "no road nearby". */
export const ROAD_DIST_CAP = 64
/** The ring road round the volcano's foot runs at this multiple of the cone radius. */
export const FOOT_RING = 1.04
/** Drop from the summit to the crater floor: far enough to be a fall, near enough to see the lava. */
export const CRATER_DEPTH = 22
/** Radius of the rim road, on the flat summit just outside the crater's crown. */
export function rimRadius(v: Volcano): number {
  return v.calderaRadius * 1.45 + 4
}
/** The flat summit reaches this far outside the rim road, so the road has ground both sides. */
const SUMMIT_MARGIN = 14
/** Depth of the sea floor far from shore. */
const SEA_DEPTH = 60

export interface Volcano {
  x: number
  z: number
  /** Summit height of the uncut cone above its base. */
  height: number
  /** Base radius on the steep side. */
  radius: number
  /** Unit vector along the long, gentler flank: the one the road climbs. */
  gentleX: number
  gentleZ: number
  /** How much longer the gentle flank is than the steep one. */
  gentleStretch: number
  calderaRadius: number
  /** Raised lip around the caldera. */
  lipHeight: number
  /** Caldera floor height: the lava lake sits just above it. */
  floorHeight: number
}

/** Kept for data compatibility: island worlds have no mesas. */
export interface Mesa {
  x: number
  z: number
  radius: number
  height: number
  tiered: boolean
  seed: number
}

/** A flat spawn area near the coast. */
export interface SpawnPad {
  x: number
  z: number
  /** Unit vector from the island centre out to the pad. Players face the other way. */
  dirX: number
  dirZ: number
}

/**
 * The slowly varying noise layers (coastline, domain warp, rolling ground, where mountains
 * stand) change over hundreds of metres, so evaluating them at every 4 m sample is wasted
 * work. They are computed once on a lattice `step` metres apart and read back with
 * bilinear interpolation, which costs a few array reads instead of a noise evaluation.
 * The lattice is fixed in world metres, so the terrain is the same at every resolution.
 */
export interface LowFields {
  /** Lattice spacing in metres. */
  step: number
  /** Lattice points per side. */
  n: number
  half: number
  coast: Float32Array
  warpX: Float32Array
  warpZ: Float32Array
  roll: Float32Array
  mask: Float32Array
  duneWarp: Float32Array
}

const FIELD_STEP = 16

function computeFields(size: number, S: TerrainLayout['seeds']): LowFields {
  const half = size / 2
  const n = Math.floor(size / FIELD_STEP) + 2
  const make = () => new Float32Array(n * n)
  const F: LowFields = { step: FIELD_STEP, n, half, coast: make(), warpX: make(), warpZ: make(), roll: make(), mask: make(), duneWarp: make() }
  for (let iz = 0; iz < n; iz++) {
    const z = -half + iz * FIELD_STEP
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * FIELD_STEP
      const i = iz * n + ix
      F.coast[i] = fbm(x * 0.0017, z * 0.0017, S.coast, 2)
      const wx = 60 * perlin(x * 0.0024, z * 0.0024, S.warpX)
      const wz = 60 * perlin(x * 0.0024, z * 0.0024, S.warpZ)
      F.warpX[i] = wx
      F.warpZ[i] = wz
      F.roll[i] = fbm((x + wx) * 0.0021, (z + wz) * 0.0021, S.roll, 2)
      F.mask[i] = perlin(x * 0.0031, z * 0.0031, S.cragMask)
      F.duneWarp[i] = perlin((x + wx) * 0.004, (z + wz) * 0.004, S.dune + 3)
    }
  }
  return F
}

// Lattice cell of the current sample, set by `locate` and read by `field`. Module level
// state avoids allocating per sample.
let fI = 0
let fX = 0
let fZ = 0
let fN = 0

function locate(F: LowFields, x: number, z: number): void {
  let gx = (x + F.half) / F.step
  let gz = (z + F.half) / F.step
  const max = F.n - 1.001
  gx = gx < 0 ? 0 : gx > max ? max : gx
  gz = gz < 0 ? 0 : gz > max ? max : gz
  const ix = Math.floor(gx)
  const iz = Math.floor(gz)
  fX = gx - ix
  fZ = gz - iz
  fN = F.n
  fI = iz * F.n + ix
}

/** Bilinear read of one lattice layer at the located sample. */
function field(a: Float32Array): number {
  const p = a[fI] + (a[fI + 1] - a[fI]) * fX
  const q = a[fI + fN] + (a[fI + fN + 1] - a[fI + fN]) * fX
  return p + (q - p) * fZ
}

export interface TerrainLayout {
  half: number
  volcano: Volcano
  /** Always empty on island worlds. Kept so older consumers still iterate safely. */
  cones: Volcano[]
  mesas: Mesa[]
  /** Mean radius of the coastline. */
  islandRadius: number
  /** Radius of the ring the spawn pads sit on. */
  spawnRadius: number
  /** Height of the flat summit the rim road runs on. */
  summitHeight: number
  /** Spawn pads on a ring near the coast. Pad 0 is where the volcano road starts. */
  spawns: SpawnPad[]
  /** Unit wind direction: dune crests run across it. */
  windX: number
  windZ: number
  /** Slowly varying noise layers, precomputed on a coarse lattice. See `LowFields`. */
  fields: LowFields
  seeds: {
    warpX: number; warpZ: number; coast: number; roll: number; ridge: number; crag: number; cragMask: number
    spire: number; dune: number; detail: number; gully: number; rim: number; approach: number
  }
}

export interface TerrainData {
  seed: number
  settings: TerrainSettings
  /** Side length in metres, centred on the origin. */
  size: number
  /** Samples per side. */
  resolution: number
  /** Metres between samples. */
  cell: number
  /** Row major, z rows: heights[iz * resolution + ix] at (-size/2 + ix*cell, -size/2 + iz*cell). */
  heights: Float32Array
  /** 0..1 per sample, how volcanic the ground is. Drives basalt shading. */
  volcanic: Float32Array
  layout: TerrainLayout
  /** Distance in metres from each sample to the nearest road centreline, capped at 64. */
  roadDist: Float32Array
  /** Road centrelines, filled by the roads pass. See roads.ts for the shape. */
  roads: Road[]
  /** Lava lake, rivers and pools, filled by the lava pass. See lava.ts for the shape. */
  lava: LavaFeatures
  /** Fire, ember and smoke emitter positions, filled by the vents pass. See lava.ts. */
  vents: Vent[]
  /** Milliseconds spent in each pass, for profiling. */
  timings: Record<string, number>
}

export interface TerrainPass {
  name: string
  run(data: TerrainData): void
}

export interface GenerateOptions {
  size?: number
  resolution?: number
  /** Replace the pass list (tests, future features). Defaults to defaultPasses(). */
  passes?: TerrainPass[]
}

// ---------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------

/** Deterministic unit vector without trig: rejection sample the unit disk. */
export function randomDirection(next: () => number): [number, number] {
  for (let i = 0; i < 64; i++) {
    const x = next() * 2 - 1
    const z = next() * 2 - 1
    const d2 = x * x + z * z
    if (d2 > 0.04 && d2 <= 1) {
      const inv = 1 / Math.sqrt(d2)
      return [x * inv, z * inv]
    }
  }
  return [1, 0]
}

/** Lateral wander of the open approach (and its road) from a spawn pad toward the volcano. */
export function approachMeander(along: number, seed: number): number {
  return 50 * perlin(along * 0.004, 0.5, seed) * smoothstep(0, 140, along)
}

export function computeLayout(seed: number, s: TerrainSettings, size: number): TerrainLayout {
  const next = rng(seed)
  const half = size / 2
  // The island has to fit inside the simulated square with sea all round it.
  const islandRadius = Math.min(s.islandRadius, half - 200)

  const [gx, gz] = randomDirection(next)
  const R = Math.min(s.volcanoRadius, islandRadius * 0.55)
  const H = s.volcanoHeight
  const rc = Math.min(s.calderaSize, R * 0.4)
  const volcano: Volcano = {
    x: 0, z: 0, height: H, radius: R, gentleX: gx, gentleZ: gz, gentleStretch: 0.3,
    calderaRadius: rc, lipHeight: 0, floorHeight: 0,
  }
  // The cone is cut flat where the rim road runs, and the crater drops from that summit.
  const summitHeight = SPAWN_LEVEL + H * coneProfile((rimRadius(volcano) + SUMMIT_MARGIN) / R)
  volcano.floorHeight = summitHeight - CRATER_DEPTH

  // Spawn pads: an even ring, pad 0 on the gentle axis where the volcano road starts.
  // Rotating by 45 degrees with exact literals avoids trig.
  const C = 0.7071067811865476
  const spawns: SpawnPad[] = []
  // Outside the foot ring road, with room for a pad and the road's shoulder between them.
  const ringR = Math.max(islandRadius * SPAWN_RING, R * (1 + volcano.gentleStretch) * FOOT_RING + 78)
  let dx = gx
  let dz = gz
  for (let i = 0; i < SPAWN_PADS; i++) {
    spawns.push({ x: dx * ringR, z: dz * ringR, dirX: dx, dirZ: dz })
    const nx = dx * C - dz * C
    dz = dx * C + dz * C
    dx = nx
  }

  const [windX, windZ] = randomDirection(next)
  const seeds = {
    warpX: subSeed(seed, 1), warpZ: subSeed(seed, 2), coast: subSeed(seed, 3), roll: subSeed(seed, 4),
    ridge: subSeed(seed, 5), crag: subSeed(seed, 6), cragMask: subSeed(seed, 7), spire: subSeed(seed, 8),
    dune: subSeed(seed, 9), detail: subSeed(seed, 10), gully: subSeed(seed, 11), rim: subSeed(seed, 12),
    approach: subSeed(seed, 13),
  }
  return {
    half, volcano, cones: [], mesas: [], islandRadius, spawnRadius: ringR, summitHeight, spawns,
    windX, windZ, fields: computeFields(size, seeds), seeds,
  }
}

// ---------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------

/**
 * Volcano height fraction at normalised radius t. Concave: a long gentle foot that steepens
 * all the way to the summit, the stratovolcano silhouette the Mars Explorer volcano had,
 * instead of a constant grade cone that reads as a dune.
 */
export function coneProfile(t: number): number {
  if (t >= 1) return 0
  const u = 1 - t
  return 0.2 * u + 0.34 * u * u + 0.46 * u * u * u
}

/**
 * Normalised radius of (x, z) on the volcano: 0 at the centre, 1 at its foot in that
 * direction (the gentle flank reaches further). Used to keep roads and rivers on or off it.
 */
export function volcanoT(v: Volcano, x: number, z: number): number {
  const dx = x - v.x
  const dz = z - v.z
  const r = Math.sqrt(dx * dx + dz * dz)
  if (r < 1e-6) return 0
  let g = (dx * v.gentleX + dz * v.gentleZ) / r
  g = g > 0 ? g * g : 0
  return r / (v.radius * (1 + v.gentleStretch * g))
}

/**
 * Cellular Voronoi, the "cellular" blend of MapMagic's Voronoi node: the gap between the
 * nearest and second nearest feature point. It is 0 on cell borders and largest at the
 * points, so it draws peaks separated by a network of sharp valleys. Returns about 0..1.
 */
function cellular(x: number, z: number, spacing: number, seed: number): number {
  const gx = x / spacing
  const gz = z / spacing
  const cx = Math.floor(gx)
  const cz = Math.floor(gz)
  let d1 = 9
  let d2 = 9
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = hash2(cx + i, cz + j, seed)
      const px = cx + i + 0.15 + 0.7 * ((h & 1023) / 1023)
      const pz = cz + j + 0.15 + 0.7 * (((h >>> 10) & 1023) / 1023)
      const ddx = gx - px
      const ddz = gz - pz
      const d = ddx * ddx + ddz * ddz
      if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
    }
  }
  const v = Math.sqrt(d2) - Math.sqrt(d1)
  return v > 1 ? 1 : v
}

/** Mountain relief: three octaves of cellular Voronoi, the chain the Xylia graph uses. */
function massifField(x: number, z: number, spacing: number, seed: number): number {
  const v = (
    0.58 * cellular(x, z, spacing, seed) +
    0.28 * cellular(x, z, spacing * 0.5, seed + 1) +
    0.14 * cellular(x, z, spacing * 0.25, seed + 2)
  ) * 1.25
  return v > 1 ? 1 : v
}

/** Lone spires: sparse Voronoi points, each a narrow pointed peak. Returns 0..1. */
function spireField(x: number, z: number, spacing: number, seed: number): number {
  const gx = x / spacing
  const gz = z / spacing
  const cx = Math.floor(gx)
  const cz = Math.floor(gz)
  let best = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = hash2(cx + i, cz + j, seed)
      if ((h & 255) > 96) continue // most cells are empty
      const px = cx + i + 0.25 + 0.5 * (((h >>> 8) & 1023) / 1023)
      const pz = cz + j + 0.25 + 0.5 * (((h >>> 18) & 1023) / 1023)
      const size = 0.55 + 0.45 * (((h >>> 28) & 15) / 15)
      const ddx = gx - px
      const ddz = gz - pz
      const v = (1 - Math.sqrt(ddx * ddx + ddz * ddz) / (0.3 * size)) * size
      if (v > best) best = v
    }
  }
  return best
}

/** Stepped version of a 0..1 value: `steps` terraces with soft risers. */
function terrace(v: number, steps: number, steepness: number): number {
  if (steps <= 0) return v
  const f = v * steps
  const i = Math.floor(f)
  const t = f - i
  const tread = (1 - steepness) * 0.35
  return (i + t * tread + smoothstep(1 - steepness, 1, t) * (1 - tread)) / steps
}

/** Volcanic influence of the last `shapeHeight` call. */
export let shapeVolcanic = 0

/** The analytic height field. Exported so tests and tools can sample between grid points. */
export function shapeHeight(L: TerrainLayout, s: TerrainSettings, x: number, z: number): number {
  const S = L.seeds
  const v = L.volcano
  const r = Math.sqrt(x * x + z * z)
  const inv = r > 1e-6 ? 1 / r : 0
  const ux = x * inv
  const uz = z * inv

  // --- Island mask: a radial form, wobbled into capes and bays ---------------------------
  const F = L.fields
  locate(F, x, z)
  const rr = r / L.islandRadius - s.coastWobble * field(F.coast)
  const land = smoothstep(1.0, 0.7, rr) // 1 inland, 0 at the waterline
  let h = -SEA_DEPTH * smoothstep(1.0, 1.4, rr) + SPAWN_LEVEL * land
  if (rr > 1.16) {
    // Open sea: only the floor, which nobody sees under the liquid. Skipping every other
    // layer here saves a third of the time.
    shapeVolcanic = 0
    return sinkEdge(L, x, z, h)
  }
  const fine = perlin(x * 0.05, z * 0.05, S.detail)

  // Domain warp keeps every layer from looking round or grid aligned.
  const wx = x + field(F.warpX)
  const wz = z + field(F.warpZ)

  // --- Plains: rolling, lightly stepped ground -------------------------------------------
  let roll = 0.5 + 0.5 * field(F.roll)
  roll = terrace(roll, 6, 0.35)
  h += (4 + 12 * s.roughness) * 2 * (roll - 0.35) * land

  // --- Volcano ------------------------------------------------------------------------------
  let gentle = ux * v.gentleX + uz * v.gentleZ
  gentle = gentle > 0 ? gentle * gentle : 0
  const radius = v.radius * (1 + v.gentleStretch * gentle)
  const t = r / radius
  let volcanic = 0
  if (t < 1) {
    let cone = v.height * coneProfile(t)
    // Radial gullies down the flanks, shallower on the side the road climbs.
    const gn = perlin(ux * 4 + r * 0.003, uz * 4 - r * 0.003, S.gully)
    let valley = 1 - Math.abs(gn)
    valley *= valley
    valley *= valley
    // Gullies and broken rock fade out toward the summit, which stays a clean flat top.
    const rho = rimRadius(v)
    const belowSummit = smoothstep(rho * 1.2, rho * 2.1, r)
    const flank = belowSummit * smoothstep(1.0, 0.55, t)
    cone -= s.roughness * v.height * 0.13 * flank * valley * (1 - 0.7 * gentle)
    // Broken, ridged rock toward the summit so the silhouette is not smooth.
    if (t < 0.75) {
      const rough = ridged(wx * 0.011, wz * 0.011, S.ridge, 2) - 0.35
      cone += s.roughness * v.height * 0.2 * rough * smoothstep(0.75, 0.2, t) * belowSummit * (1 - 0.6 * gentle)
    }
    h += cone
    volcanic = smoothstep(1.0, 0.45, t)
  }

  // --- Massifs and spires: steep rock standing abruptly out of smooth plains ------------
  // Between the volcano's ring road and the coast, with a few sea stacks past the shore.
  const foot = radius * FOOT_RING
  const band = smoothstep(foot + 45, foot + 115, r) * smoothstep(1.12, 0.9, rr)
  if (band > 0) {
    // An open approach from every spawn pad to the volcano: the way in is never walled
    // off, and it is where that pad's road runs.
    let clear = 1
    for (let i = 0; i < L.spawns.length; i++) {
      const p = L.spawns[i]
      const ap = x * p.dirX + z * p.dirZ
      if (ap <= 0) continue
      const pr = L.spawnRadius
      const lp = -x * p.dirZ + z * p.dirX - approachMeander(pr - ap, S.approach + 31 * i)
      const a = lp < 0 ? -lp : lp
      // A corridor inward of the pad, and a round clearing at the pad itself.
      const inward = smoothstep(pr + 70, pr + 20, ap)
      clear *= 1 - inward * smoothstep(150, 80, a)
      const dx = x - p.x
      const dz = z - p.z
      const d2 = dx * dx + dz * dz
      if (d2 < 150 * 150) clear *= smoothstep(70, 150, Math.sqrt(d2))
    }
    if (clear > 0 && s.mesaHeight > 0) {
      // Where massifs stand: a low frequency mask with a hard edge, so they rise as cliffs.
      const m = field(F.mask) + 0.35 * perlin(x * 0.009, z * 0.009, S.cragMask + 9)
      const edge0 = 0.52 - s.cragDensity * 1.15
      const mask = smoothstep(edge0, edge0 + 0.11, m) * band * clear
      if (mask > 0) {
        const relief = terrace(massifField(wx, wz, 150, S.crag), 9, 0.5)
        // A cliff base from the mask edge, then the peaks on top.
        const body = 0.34 * smoothstep(0, 0.6, mask) + 0.66 * relief * mask
        h += s.mesaHeight * body * (0.75 + 0.45 * smoothstep(-0.2, 0.6, m))
        if (mask * 0.35 > volcanic) volcanic = mask * 0.35
      }
    }
    if (clear > 0 && s.spireHeight > 0) {
      let sp = spireField(wx, wz, 230, S.spire)
      if (sp > 0) {
        // Pointed, with a flared foot and a ragged ridge.
        sp = 0.45 * sp + 0.55 * sp * sp
        sp *= 0.7 + 0.6 * ridged(wx * 0.014, wz * 0.014, S.ridge + 5, 2)
        h += s.spireHeight * sp * band * clear
        const cv = smoothstep(0.1, 0.5, sp) * 0.35
        if (cv > volcanic) volcanic = cv
      }
    }
  }

  // --- Dunes and grain on open ground ----------------------------------------------------
  const calm = (1 - volcanic) * land
  if (s.duneHeight > 0 && calm > 0.05) {
    // Crests run across the wind: stretch the noise along the crest direction.
    const u = x * L.windX + z * L.windZ
    const w = -x * L.windZ + z * L.windX
    let d = 1 - Math.abs(perlin(u * 0.017 + 0.6 * field(F.duneWarp), w * 0.005, S.dune))
    d *= d
    h += s.duneHeight * d * calm
  }
  h += 0.9 * fine * (0.3 + 0.7 * land)

  // --- Summit: a flat top for the rim road, a crown of rock fangs, and the crater -------
  // The cone is cut off where the rim road runs, leaving a flat summit to fight on. A
  // broken crown stands round the crater edge with gaps between the fangs, so a rammed
  // player can go over the edge into the lake. One tall tooth marks the gentle side.
  const rc = v.calderaRadius
  const rho = rimRadius(v)
  if (r < rho * 1.9) {
    const top = L.summitHeight
    if (h > top) h = top
    // The summit tips gently toward the crater, so a car shoved inward keeps rolling.
    h -= 1.5 * smoothstep(rho - 6, rc, r)
    const sN = r / rc
    if (sN < 1.24) {
      const fang = smoothstep(0.02, 0.5, perlin(ux * 3.4, uz * 3.4, S.rim) + 0.25 * perlin(ux * 9, uz * 9, S.rim + 1))
      const crown = s.roughness * 56 * fang + 60 * smoothstep(0.72, 0.97, gentle)
      if (sN >= 1) {
        h += crown * smoothstep(1.24, 1.1, sN) * smoothstep(0.98, 1.05, sN)
      } else {
        // Inside: a steep wall from the edge down to the floor.
        const edge = h + crown * 0.25
        h = edge + (v.floorHeight - edge) * smoothstep(1.0, 0.74, sN)
      }
    }
  }

  // --- Spawn pads: flat ground near the coast --------------------------------------------
  // Every pad is on the spawn ring, so only samples near that ring need the search.
  const offRing = r - L.spawnRadius
  if (offRing < SPAWN_BLEND_RADIUS && offRing > -SPAWN_BLEND_RADIUS) {
    for (const p of L.spawns) {
      const dx = x - p.x
      const dz = z - p.z
      const d2 = dx * dx + dz * dz
      if (d2 < SPAWN_BLEND_RADIUS * SPAWN_BLEND_RADIUS) {
        const f = smoothstep(SPAWN_FLAT_RADIUS, SPAWN_BLEND_RADIUS, Math.sqrt(d2))
        h = SPAWN_LEVEL + (h - SPAWN_LEVEL) * f
        volcanic *= f
      }
    }
  }

  // --- Shore: a bank at the waterline ----------------------------------------------------
  // The ground crosses the liquid surface steeply, so the coast is a crisp line with a low
  // bank above it and no wide shelf lying a few centimetres under the surface. A monotone
  // piecewise linear remap, continuous at both ends.
  if (h > -6 && h < 8 && t >= 1) {
    if (h < -1) h = -6 + (h + 6) * 0.4
    else if (h < 1) h = -4 + (h + 1) * 2.8
    else h = 1.6 + (h - 1) * (6.4 / 7)
  }

  shapeVolcanic = volcanic
  return sinkEdge(L, x, z, h)
}

/** The simulated square must end under the liquid on every side. */
function sinkEdge(L: TerrainLayout, x: number, z: number, h: number): number {
  const ax = x < 0 ? -x : x
  const az = z < 0 ? -z : z
  const edge = L.half - (ax > az ? ax : az)
  if (edge < 150) {
    const deep = -SEA_DEPTH * 0.6
    if (h > deep) h += (deep - h) * smoothstep(150, 30, edge)
  }
  return h
}

export const shapePass: TerrainPass = {
  name: 'shape',
  run(data) {
    const { resolution: n, cell, heights, volcanic, layout, settings } = data
    const half = data.size / 2
    for (let iz = 0; iz < n; iz++) {
      const z = -half + iz * cell
      const row = iz * n
      for (let ix = 0; ix < n; ix++) {
        heights[row + ix] = shapeHeight(layout, settings, -half + ix * cell, z)
        volcanic[row + ix] = shapeVolcanic
      }
    }
  },
}

/**
 * The standard pass order. A function rather than a constant because the pass modules
 * import this one: resolving at call time keeps the import cycle harmless.
 */
export function defaultPasses(): TerrainPass[] {
  return [shapePass, roadsPass, lavaPass, ventsPass]
}

/** Only for profiling: never feeds into heights. */
function now(): number {
  return performance.now()
}

export function generateTerrain(seed: number, settings: TerrainSettings, options: GenerateOptions = {}): TerrainData {
  const size = options.size ?? DEFAULT_WORLD_SIZE
  const resolution = options.resolution ?? DEFAULT_RESOLUTION
  const timings: Record<string, number> = {}
  let t = now()
  const layout = computeLayout(seed | 0, settings, size)
  timings.layout = now() - t
  const data: TerrainData = {
    seed: seed | 0, settings: { ...settings }, size, resolution, cell: size / (resolution - 1),
    heights: new Float32Array(resolution * resolution),
    volcanic: new Float32Array(resolution * resolution),
    roadDist: new Float32Array(resolution * resolution).fill(ROAD_DIST_CAP),
    roads: [], lava: { lake: null, rivers: [], pools: [] }, vents: [],
    layout, timings,
  }
  for (const pass of options.passes ?? defaultPasses()) {
    t = now()
    pass.run(data)
    timings[pass.name] = now() - t
  }
  return data
}

/** Order-sensitive checksum of the heights, handy for comparing worlds across machines. */
export function terrainChecksum(data: TerrainData): number {
  const bits = new Uint32Array(data.heights.buffer, data.heights.byteOffset, data.heights.length)
  let h = 0
  for (let i = 0; i < bits.length; i++) h = hash2(h, bits[i], i)
  return h >>> 0
}
