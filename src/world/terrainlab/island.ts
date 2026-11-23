/**
 * Terrain Lab prototype: an island world.
 *
 * Every world is one island. The most interesting thing (a breached volcano with a lava
 * lake) stands at the centre, players spawn on a ring near the coast facing inward, and the
 * liquid (lava or water) runs to the horizon in every direction, so nobody wanders off into
 * an endless plain.
 *
 * The recipe follows the MapMagic graphs shipped with Mira (Tholus and Xylia), which were
 * both built this way:
 *
 *   radial form + curve     island mask, falling to a sea floor
 *   noise + terrace         stepped rolling ground
 *   voronoi chain + terrace steep crags and monoliths standing out of smooth plains
 *   shore                   a flat beach where land meets the liquid
 *
 * A pure function of (seed, settings) with the same determinism rules as terrain/noise.ts:
 * no Math.random, Math.sin, Math.pow or Math.exp.
 */
import { fbm, hash2, perlin, ridged, rng, smoothstep, subSeed } from '../terrain/noise'

export interface IslandSettings {
  /** Side of the simulated square in metres. The liquid continues beyond it. */
  size: number
  /** Samples per side. */
  resolution: number
  /** Mean radius of the coastline. */
  islandRadius: number
  /** How far capes and bays push the coast in and out, as a fraction of the radius. */
  coastWobble: number
  volcanoHeight: number
  volcanoRadius: number
  calderaRadius: number
  /** Height of the mountain massifs that stand out of the plains. */
  cragHeight: number
  /** 0..1 share of the land between the volcano and the coast covered by massifs. */
  cragDensity: number
  /** Metres between peaks inside a massif. */
  cragSpacing: number
  /** Height of the lone spires. 0 disables them. */
  spireHeight: number
  /** Terrace steps across the crag height. 0 disables terracing. */
  terraces: number
  /** Height of the plains above the liquid. */
  plainsHeight: number
  /** Rolling relief on the plains. */
  rolling: number
  duneHeight: number
  /** Depth of the sea floor far from shore. */
  seaDepth: number
  spawnCount: number
}

export const DEFAULT_ISLAND: IslandSettings = {
  size: 2048,
  resolution: 513,
  islandRadius: 800,
  coastWobble: 0.2,
  volcanoHeight: 430,
  volcanoRadius: 440,
  calderaRadius: 62,
  cragHeight: 120,
  cragDensity: 0.34,
  cragSpacing: 150,
  spireHeight: 190,
  terraces: 9,
  plainsHeight: 14,
  rolling: 9,
  duneHeight: 4,
  seaDepth: 60,
  spawnCount: 8,
}

export interface IslandSpawn {
  x: number
  z: number
  y: number
  /** Radians about +Y, 0 faces -Z: toward the volcano. */
  heading: number
  /** Unit vector from the centre out to this spawn. An open approach runs along it. */
  dirX: number
  dirZ: number
}

export interface IslandLayout {
  half: number
  /** Unit vector from the centre toward the breach in the caldera rim. */
  breachX: number
  breachZ: number
  /** Height of the caldera rim away from the breach and the tooth. */
  rimHeight: number
  /** Surface of the lava lake inside the caldera. */
  lakeLevel: number
  lakeRadius: number
  /** Centre line of the lava channel from the breach to the sea, as x, z pairs. */
  channel: Float32Array
  spawns: IslandSpawn[]
  windX: number
  windZ: number
  seeds: Record<'coast' | 'roll' | 'warpX' | 'warpZ' | 'crag' | 'cragMask' | 'spire' | 'dune' | 'detail' | 'gully' | 'rim' | 'channel' | 'ridge', number>
}

export interface IslandData {
  seed: number
  settings: IslandSettings
  size: number
  resolution: number
  cell: number
  /** Row major, z rows, metres. The sea (lava or water) surface is at 0. */
  heights: Float32Array
  /** 0..1 per sample: how volcanic the ground is (basalt shading). */
  volcanic: Float32Array
  layout: IslandLayout
  timings: Record<string, number>
}

/** Sea level. Everything is measured from the liquid surface. */
export const SEA_LEVEL = 0

const SPAWN_FLAT = 24
const SPAWN_BLEND = 70
const CHANNEL_WIDTH = 16
const CHANNEL_DEPTH = 7

function unitFromRng(next: () => number): [number, number] {
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

/**
 * Volcano height fraction at normalised radius t. Concave: a long gentle foot that steepens
 * all the way to the summit, the classic stratovolcano silhouette (and the one the Mars
 * Explorer volcano had), instead of a constant grade cone that reads as a dune.
 */
export function volcanoProfile(t: number): number {
  if (t >= 1) return 0
  const u = 1 - t
  return 0.16 * u + 0.3 * u * u + 0.54 * u * u * u
}

/** Lateral offset of the lava channel centre line at a distance along the breach direction. */
function channelMeander(along: number, seed: number): number {
  return 34 * perlin(along * 0.0045, 0.5, seed) * smoothstep(60, 220, along)
}

/** Lateral wander of the open approach from a spawn to the volcano. */
function approachMeander(along: number, seed: number): number {
  return 55 * perlin(along * 0.004, 0.5, seed) * smoothstep(40, 200, along) * smoothstep(620, 480, along)
}

export function computeIslandLayout(seed: number, s: IslandSettings): IslandLayout {
  const next = rng(seed)
  const half = s.size / 2
  const [breachX, breachZ] = unitFromRng(next)
  const [windX, windZ] = unitFromRng(next)
  const seeds = {
    coast: subSeed(seed, 11), roll: subSeed(seed, 12), warpX: subSeed(seed, 13), warpZ: subSeed(seed, 14),
    crag: subSeed(seed, 15), cragMask: subSeed(seed, 16), dune: subSeed(seed, 17), detail: subSeed(seed, 18),
    gully: subSeed(seed, 19), rim: subSeed(seed, 20), channel: subSeed(seed, 21), ridge: subSeed(seed, 22),
    spire: subSeed(seed, 23),
  }
  const rc = Math.min(s.calderaRadius, s.volcanoRadius * 0.4)
  const rimHeight = s.plainsHeight + s.volcanoHeight * volcanoProfile(rc / s.volcanoRadius)
  const lakeLevel = rimHeight - 26
  const lakeRadius = rc * 0.86

  // Channel centre line: from the breach, down the flank and across the plain to the sea.
  const pts: number[] = []
  for (let along = rc * 0.8; along < s.islandRadius * 1.25; along += 12) {
    const lat = channelMeander(along, seeds.channel)
    pts.push(breachX * along - breachZ * lat, breachZ * along + breachX * lat)
  }

  // Spawns: an even ring near the coast, rotated so no pad sits in the lava channel.
  const spawns: IslandSpawn[] = []
  const ringR = s.islandRadius * 0.7
  const count = Math.max(1, s.spawnCount | 0)
  // Rotation by half a step relative to the breach, built without trig: rotate the breach
  // vector by 2*pi/count per step using a precomputed cos/sin from a polygon recurrence.
  const [stepC, stepS] = polygonStep(count)
  // Start half a step off the breach: half angle from the full step.
  const hc = Math.sqrt((1 + stepC) / 2)
  const hs = (stepS >= 0 ? 1 : -1) * Math.sqrt((1 - stepC) / 2)
  let dx = breachX * hc - breachZ * hs
  let dz = breachZ * hc + breachX * hs
  for (let i = 0; i < count; i++) {
    const x = dx * ringR
    const z = dz * ringR
    // Heading 0 faces -Z; we want to face the origin, direction (-dx, -dz).
    spawns.push({ x, z, y: s.plainsHeight, heading: headingToward(-dx, -dz), dirX: dx, dirZ: dz })
    const nx = dx * stepC - dz * stepS
    dz = dz * stepC + dx * stepS
    dx = nx
  }
  return {
    half, breachX, breachZ, rimHeight, lakeLevel, lakeRadius, channel: new Float32Array(pts), spawns, windX, windZ, seeds,
  }
}

/** cos and sin of 2*pi/n for small n, as exact literals so every engine agrees. */
function polygonStep(n: number): [number, number] {
  const table: Record<number, [number, number]> = {
    1: [1, 0], 2: [-1, 0], 3: [-0.5, 0.8660254037844386], 4: [0, 1],
    5: [0.30901699437494745, 0.9510565162951535], 6: [0.5, 0.8660254037844386],
    8: [0.7071067811865476, 0.7071067811865476], 10: [0.8090169943749475, 0.5877852522924731],
    12: [0.8660254037844386, 0.5], 16: [0.9238795325112867, 0.3826834323650898],
  }
  return table[n] ?? table[8]
}

/**
 * Heading (radians about +Y, 0 faces -Z) for a unit direction. Only used for spawn facing,
 * which is cosmetic, so Math.atan2 is acceptable here: it never feeds into heights.
 */
function headingToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

// Extra return values of islandHeight, to avoid allocating per sample.
export let islandVolcanic = 0

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

/**
 * Mountain massif relief: three octaves of cellular Voronoi, the chain the Xylia graph
 * uses (cell counts 4, 8, 16). Returns about 0..1.
 */
function massifField(x: number, z: number, spacing: number, seed: number): number {
  return (
    0.58 * cellular(x, z, spacing, seed) +
    0.28 * cellular(x, z, spacing * 0.5, seed + 1) +
    0.14 * cellular(x, z, spacing * 0.25, seed + 2)
  ) * 1.25
}

/**
 * Lone spires: sparse Voronoi points, each a narrow pointed peak. Returns 0..1.
 */
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
  // Flat tread then a steep riser: smoothstep squeezed toward the top of each step.
  const r = smoothstep(1 - steepness, 1, t)
  return (i + t * (1 - steepness) * 0.35 + r * (1 - (1 - steepness) * 0.35)) / steps
}

/** The analytic island height in metres at a world position. */
export function islandHeight(L: IslandLayout, s: IslandSettings, x: number, z: number): number {
  const S = L.seeds
  const r = Math.sqrt(x * x + z * z)
  const inv = r > 1e-6 ? 1 / r : 0
  const ux = x * inv
  const uz = z * inv

  // Domain warp, shared by the layers that should not look round.
  const wx = x + 60 * perlin(x * 0.0024, z * 0.0024, S.warpX)
  const wz = z + 60 * perlin(x * 0.0024, z * 0.0024, S.warpZ)

  // --- Island mask: radial form, wobbled into capes and bays --------------------------
  const rr = r / s.islandRadius - s.coastWobble * fbm(x * 0.0017, z * 0.0017, S.coast, 3)
  const land = smoothstep(1.0, 0.7, rr) // 1 inland, 0 at the waterline
  const sea = smoothstep(1.0, 1.4, rr) // 0 at the waterline, 1 far out
  let h = -s.seaDepth * sea + s.plainsHeight * land
  if (rr > 1.45) {
    // Open sea: nothing but the floor. Skipping the land layers here saves a third of the time.
    islandVolcanic = 0
    return h + 0.9 * perlin(x * 0.05, z * 0.05, S.detail) * 0.3
  }

  // --- Plains: rolling, lightly terraced ground and dunes ------------------------------
  let roll = 0.5 + 0.5 * fbm(wx * 0.0021, wz * 0.0021, S.roll, 3)
  roll = terrace(roll, s.terraces > 0 ? 6 : 0, 0.35)
  h += s.rolling * 2 * (roll - 0.35) * land

  // --- Volcano -------------------------------------------------------------------------
  const R = s.volcanoRadius
  const rc = Math.min(s.calderaRadius, R * 0.4)
  const t = r / R
  let volcanic = 0
  let cone = 0
  if (t < 1) {
    cone = s.volcanoHeight * volcanoProfile(t)
    // Radial gullies and ridges down the flanks.
    const gn = perlin(ux * 4 + r * 0.003, uz * 4 - r * 0.003, S.gully)
    let valley = 1 - Math.abs(gn)
    valley *= valley
    valley *= valley
    const flank = smoothstep(0.1, 0.3, t) * smoothstep(1.0, 0.55, t)
    cone -= s.volcanoHeight * 0.07 * flank * valley
    // Broken, ridged rock toward the summit so the silhouette is not smooth.
    const rough = ridged(wx * 0.011, wz * 0.011, S.ridge, 3) - 0.35
    cone += s.volcanoHeight * 0.1 * rough * smoothstep(0.75, 0.2, t) * smoothstep(0.1, 0.22, t)
    volcanic = smoothstep(1.0, 0.45, t)
  }
  h += cone

  // --- Massifs and spires: steep rock standing abruptly out of smooth plains -----------
  // Between the volcano's lower flank and the coast, with a few sea stacks past the shore.
  const band = smoothstep(0.5, 0.72, t) * smoothstep(1.12, 0.9, rr)
  if (band > 0) {
    // Keep the lava channel and the spawn pads clear of rock.
    let clear = 1
    const al = x * L.breachX + z * L.breachZ
    if (al > 0) {
      const la = -x * L.breachZ + z * L.breachX - channelMeander(al, S.channel)
      clear = smoothstep(30, 90, la < 0 ? -la : la)
    }
    // An open approach from every spawn to the volcano: the way in is never walled off,
    // and it is where a road goes.
    for (let i = 0; i < L.spawns.length; i++) {
      const p = L.spawns[i]
      const dx = x - p.x
      const dz = z - p.z
      const d2 = dx * dx + dz * dz
      if (d2 < 150 * 150) clear *= smoothstep(60, 150, Math.sqrt(d2))
      const ap = x * p.dirX + z * p.dirZ
      if (ap > 0) {
        const lp = -x * p.dirZ + z * p.dirX - approachMeander(ap, S.channel + 31 * (i + 1))
        clear *= smoothstep(26, 80, lp < 0 ? -lp : lp)
      }
    }
    if (clear > 0 && s.cragHeight > 0) {
      // Where massifs stand: a low frequency mask with a hard edge, so they rise as cliffs.
      const m = perlin(x * 0.0031, z * 0.0031, S.cragMask) + 0.35 * perlin(x * 0.009, z * 0.009, S.cragMask + 9)
      const edge0 = 0.52 - s.cragDensity * 1.15
      const mask = smoothstep(edge0, edge0 + 0.11, m) * band * clear
      if (mask > 0) {
        let v = massifField(wx, wz, s.cragSpacing, S.crag)
        v = terrace(v > 1 ? 1 : v, s.terraces, 0.5)
        // A cliff base from the mask edge, then the peaks on top.
        const body = 0.34 * smoothstep(0, 0.6, mask) + 0.66 * v * mask
        h += s.cragHeight * body * (0.75 + 0.45 * smoothstep(-0.2, 0.6, m))
        const cv = mask * 0.35
        if (cv > volcanic) volcanic = cv
      }
    }
    if (clear > 0 && s.spireHeight > 0) {
      const sx = wx + 26 * perlin(x * 0.013, z * 0.013, S.spire + 3)
      const sz = wz + 26 * perlin(x * 0.013, z * 0.013, S.spire + 4)
      let v = spireField(sx, sz, 230, S.spire)
      if (v > 0) {
        // Pointed, with a flared foot and a ragged ridge.
        v = 0.45 * v + 0.55 * v * v
        v *= 0.7 + 0.6 * ridged(wx * 0.014, wz * 0.014, S.ridge + 5, 3)
        h += s.spireHeight * v * band * clear
        const cv = smoothstep(0.1, 0.5, v) * 0.35
        if (cv > volcanic) volcanic = cv
      }
    }
  }

  // --- Dunes and grain on open ground ---------------------------------------------------
  const calm = (1 - volcanic) * land
  if (s.duneHeight > 0) {
    const u = x * L.windX + z * L.windZ
    const v = -x * L.windZ + z * L.windX
    let d = 1 - Math.abs(perlin(u * 0.017 + 0.6 * perlin(wx * 0.004, wz * 0.004, S.dune + 3), v * 0.005, S.dune))
    d *= d
    h += s.duneHeight * d * calm
  }
  h += 0.9 * perlin(x * 0.05, z * 0.05, S.detail) * (0.3 + 0.7 * land)

  // --- Caldera: ragged rim, a tooth, a breach and a floor for the lava lake ------------
  if (r < rc * 1.9) {
    const sN = r / rc
    // The rim is where the cone is cut off. Its height varies around the circle.
    const teeth = 16 * perlin(ux * 2.6, uz * 2.6, S.rim) + 7 * perlin(ux * 7, uz * 7, S.rim + 1)
    const facing = ux * L.breachX + uz * L.breachZ // 1 toward the breach, -1 opposite
    // King of the Hill tooth: the high point of the rim, opposite the breach.
    const tooth = 46 * smoothstep(-0.78, -0.98, facing)
    // Breach: the rim drops below the lake surface over a narrow arc.
    const breach = smoothstep(0.9, 0.985, facing)
    const rimTop = L.rimHeight + teeth + tooth
    const rimHere = rimTop + (L.lakeLevel - 3 - rimTop) * breach
    const outside = smoothstep(1.9, 1.05, sN)
    // Outside the rim: pull the cone toward the local rim height near the edge.
    if (sN >= 1) {
      h += (rimHere - h) * smoothstep(1.35, 1.0, sN) * 0.85 * outside
    } else {
      // Inside: steep wall down to a floor a few metres under the lake surface.
      const floor = L.lakeLevel - 9
      const wall = smoothstep(1.0, 0.7, sN)
      h = rimHere + (floor - rimHere) * wall
    }
  }

  // --- Lava channel: a trench from the breach to the sea --------------------------------
  const along = x * L.breachX + z * L.breachZ
  if (along > rc * 0.75) {
    const lat = -x * L.breachZ + z * L.breachX - channelMeander(along, S.channel)
    const a = lat < 0 ? -lat : lat
    if (a < CHANNEL_WIDTH * 2.5) {
      const cut = smoothstep(CHANNEL_WIDTH * 1.2, CHANNEL_WIDTH * 0.45, a)
      // Levees: a low bank either side.
      const levee = smoothstep(CHANNEL_WIDTH * 2.5, CHANNEL_WIDTH * 1.3, a) * (1 - cut)
      const fade = smoothstep(rc * 0.75, rc * 1.2, along) * smoothstep(1.1, 0.95, rr)
      h += (2.5 * levee - CHANNEL_DEPTH * cut) * fade
      if (cut * fade > volcanic) volcanic = cut * fade
    }
  }

  // --- Spawn pads: flat ground near the coast -------------------------------------------
  for (const p of L.spawns) {
    const dx = x - p.x
    const dz = z - p.z
    const d2 = dx * dx + dz * dz
    if (d2 < SPAWN_BLEND * SPAWN_BLEND) {
      const f = smoothstep(SPAWN_FLAT, SPAWN_BLEND, Math.sqrt(d2))
      h = p.y + (h - p.y) * f
      volcanic *= f
    }
  }

  // --- Shore: a bank at the waterline ----------------------------------------------------
  // The ground crosses the liquid surface steeply, so the coast is a crisp line with a low
  // bank above it and no wide shelf lying a few centimetres under the surface. A monotone
  // piecewise linear remap, continuous at both ends.
  if (h > -6 && h < 8 && r > R * 0.6) {
    if (h < -1) h = -6 + (h + 6) * 0.4
    else if (h < 1) h = -4 + (h + 1) * 2.8
    else h = 1.6 + (h - 1) * (6.4 / 7)
  }

  // --- The simulated square must end under the liquid on every side ---------------------
  const ax = x < 0 ? -x : x
  const az = z < 0 ? -z : z
  const edge = L.half - (ax > az ? ax : az)
  if (edge < 150) {
    const k = smoothstep(150, 30, edge)
    const deep = -s.seaDepth * 0.6
    if (h > deep) h += (deep - h) * k
  }

  islandVolcanic = volcanic
  return h
}

export function generateIsland(seed: number, settings: IslandSettings = DEFAULT_ISLAND): IslandData {
  const timings: Record<string, number> = {}
  let t0 = performance.now()
  const layout = computeIslandLayout(seed | 0, settings)
  timings.layout = performance.now() - t0
  const n = settings.resolution
  const cell = settings.size / (n - 1)
  const heights = new Float32Array(n * n)
  const volcanic = new Float32Array(n * n)
  t0 = performance.now()
  const half = settings.size / 2
  for (let iz = 0; iz < n; iz++) {
    const z = -half + iz * cell
    const row = iz * n
    for (let ix = 0; ix < n; ix++) {
      heights[row + ix] = islandHeight(layout, settings, -half + ix * cell, z)
      volcanic[row + ix] = islandVolcanic
    }
  }
  timings.shape = performance.now() - t0
  // Seat each spawn on the generated ground.
  for (const p of layout.spawns) p.y = islandHeight(layout, settings, p.x, p.z)
  return { seed: seed | 0, settings: { ...settings }, size: settings.size, resolution: n, cell, heights, volcanic, layout, timings }
}
