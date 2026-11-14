/**
 * Procedural Martian terrain: a pure function of (seed, settings).
 *
 * Generation is a list of passes over one height grid, so later features (lava flows,
 * roads) can be appended as passes without touching the shape code:
 *
 *   layout  pick feature positions from the seed (volcano, cones, mesas, wind)
 *   shape   sample the analytic height field onto the grid
 *   ...     future passes edit `heights` and the per-sample masks in place
 *
 * Nothing here touches three.js, Rapier or the DOM, so it runs in tests, a worker or a
 * server unchanged. See noise.ts for the determinism rules this file must follow.
 */
import { fbm, hash2, perlin, ridged, rng, smoothstep, subSeed } from './noise'
import type { LavaFeatures, Vent } from './lava'
import { type Road, roadsPass } from './roads'
import type { TerrainSettings } from './settings'

export const DEFAULT_WORLD_SIZE = 2048
/** Samples per side. 513 gives 4 m cells; see the report in tests/world for timings. */
export const DEFAULT_RESOLUTION = 513
/** Ground level of the flattened spawn pad at the origin. */
export const SPAWN_LEVEL = 2
/** Radius of the perfectly flat spawn pad, and where it has fully blended back to terrain. */
export const SPAWN_FLAT_RADIUS = 55
export const SPAWN_BLEND_RADIUS = 160
/** roadDist value meaning "no road nearby". */
export const ROAD_DIST_CAP = 64

export interface Volcano {
  x: number
  z: number
  /** Summit height of the uncut cone. */
  height: number
  /** Base radius on the steep side. */
  radius: number
  /** Unit vector from the volcano toward the spawn: the long, gentle approach. */
  gentleX: number
  gentleZ: number
  /** How much longer the gentle flank is than the steep one. */
  gentleStretch: number
  calderaRadius: number
  /** Raised lip around the caldera. */
  lipHeight: number
  /** Flat caldera floor height: where a lava lake will sit. */
  floorHeight: number
}

export interface Mesa {
  x: number
  z: number
  radius: number
  height: number
  /** Second, smaller tier on top. */
  tiered: boolean
  seed: number
}

export interface TerrainLayout {
  half: number
  volcano: Volcano
  /** Smaller cones use the same model with no gentle flank. */
  cones: Volcano[]
  mesas: Mesa[]
  /** Unit wind direction: dune crests run across it. */
  windX: number
  windZ: number
  seeds: {
    warpX: number; warpZ: number; base: number; ridge: number; ridgeMask: number
    dune: number; duneMask: number; detail: number; gully: number
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
function randomDirection(next: () => number): [number, number] {
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

export function computeLayout(seed: number, s: TerrainSettings, size: number): TerrainLayout {
  const next = rng(seed)
  const half = size / 2

  // Main volcano: far enough out that the spawn at the origin sits beyond its gentle foot.
  const [vx, vz] = randomDirection(next)
  const R = s.volcanoRadius
  const dist = Math.max(0, Math.min(610 - next() * 110, half - 24 - R))
  const H = s.volcanoHeight
  const rc = Math.min(s.calderaSize, R * 0.45)
  // The long gentle flank points 45 to 75 degrees off the line to the spawn. Pointed
  // straight at the spawn, its foot would run into the flattened pad and be squeezed into a
  // wall. A table of exact cosines avoids trig, whose last bits differ between engines.
  const ANGLES: [number, number][] = [
    [0.7071067811865476, 0.7071067811865476], [0.5735764363510462, 0.8191520442889918],
    [0.5, 0.8660254037844386], [0.42261826174069944, 0.9063077870366499], [0.25881904510252074, 0.9659258262890683],
  ]
  const [ca, sa0] = ANGLES[Math.floor(next() * ANGLES.length)]
  const sa = next() < 0.5 ? sa0 : -sa0
  const volcano: Volcano = {
    x: vx * dist, z: vz * dist, height: H, radius: R,
    gentleX: -vx * ca + vz * sa, gentleZ: -vz * ca - vx * sa, gentleStretch: 0.65,
    calderaRadius: rc, lipHeight: Math.min(10, rc * 0.12), floorHeight: 0,
  }
  volcano.floorHeight = H * coneProfile(rc / R) - Math.min(rc * 0.45, H * 0.3)

  // Feature placement by rejection: clear of the spawn, the volcano and each other.
  const placed: { x: number; z: number; r: number }[] = [
    { x: volcano.x, z: volcano.z, r: R * 1.1 },
    { x: 0, z: 0, r: SPAWN_BLEND_RADIUS },
  ]
  const tryPlace = (r: number): [number, number] | null => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = (next() * 2 - 1) * (half - 120 - r)
      const z = (next() * 2 - 1) * (half - 120 - r)
      let ok = true
      for (const p of placed) {
        const dx = x - p.x
        const dz = z - p.z
        const min = r + p.r + 40
        if (dx * dx + dz * dz < min * min) { ok = false; break }
      }
      if (ok) {
        placed.push({ x, z, r })
        return [x, z]
      }
    }
    return null
  }

  const cones: Volcano[] = []
  const coneCount = 1 + Math.floor(next() * 3)
  for (let i = 0; i < coneCount; i++) {
    const radius = 120 + next() * 80
    const height = 55 + next() * 55
    const pos = tryPlace(radius * 1.05)
    if (!pos) continue
    const crater = radius * (0.14 + next() * 0.06)
    cones.push({
      x: pos[0], z: pos[1], height, radius, gentleX: 1, gentleZ: 0, gentleStretch: 0,
      calderaRadius: crater, lipHeight: 3, floorHeight: height * coneProfile(crater / radius) - crater * 0.5,
    })
  }

  const mesas: Mesa[] = []
  const mesaCount = 2 + Math.floor(next() * 5)
  for (let i = 0; i < mesaCount; i++) {
    const radius = 55 + next() * 70
    const height = s.mesaHeight * (0.7 + next() * 0.6)
    const tiered = next() < 0.5
    const pos = tryPlace(radius * 1.5)
    if (!pos) continue
    mesas.push({ x: pos[0], z: pos[1], radius, height, tiered, seed: subSeed(seed, 100 + i) })
  }

  const [windX, windZ] = randomDirection(next)
  return {
    half, volcano, cones, mesas, windX, windZ,
    seeds: {
      warpX: subSeed(seed, 1), warpZ: subSeed(seed, 2), base: subSeed(seed, 3), ridge: subSeed(seed, 4),
      ridgeMask: subSeed(seed, 5), dune: subSeed(seed, 6), duneMask: subSeed(seed, 7),
      detail: subSeed(seed, 8), gully: subSeed(seed, 9),
    },
  }
}

// ---------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------

/**
 * Cone height fraction at normalised radius t: a straight flank (steady, drivable grade)
 * that eases into the ground over the outer 30 percent so there is no crease at the foot.
 */
export function coneProfile(t: number): number {
  if (t >= 1) return 0
  if (t > 0.7) {
    const u = 1 - t
    return (u * u) / 0.6 / 0.85
  }
  return (0.85 - t) / 0.85
}

/**
 * Normalised radius of (x, z) on a volcano or cone: 0 at the centre, 1 at its foot in that
 * direction (the gentle flank reaches further). Used to keep roads and rivers off cones.
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

/** Set by `volcanoHeight` as extra return values, to avoid allocating per sample. */
let lastVolcanic = 0
let lastBowl = 0
let lastFloor = 0

/** Height of a volcano or cone at (x, z), 0 outside it. Writes its influence to lastVolcanic. */
function volcanoHeight(v: Volcano, x: number, z: number, roughness: number, gullySeed: number): number {
  lastVolcanic = 0
  lastBowl = 0
  const dx = x - v.x
  const dz = z - v.z
  const reach = v.radius * (1 + v.gentleStretch)
  const r2 = dx * dx + dz * dz
  if (r2 >= reach * reach) return 0
  const r = Math.sqrt(r2)
  const inv = r > 1e-6 ? 1 / r : 0
  const ux = dx * inv
  const uz = dz * inv
  let g = ux * v.gentleX + uz * v.gentleZ
  g = g > 0 ? g * g : 0
  const radius = v.radius * (1 + v.gentleStretch * g)
  const t = r / radius
  if (t >= 1) return 0
  let h = v.height * coneProfile(t)

  // Radial gullies: ridged noise around the cone, kept shallow on the gentle approach.
  const gn = perlin(ux * 3.5 + r * 0.004, uz * 3.5 - r * 0.004, gullySeed)
  let valley = 1 - Math.abs(gn)
  valley *= valley
  valley *= valley
  const flank = smoothstep(0.08, 0.35, t) * smoothstep(1.0, 0.6, t)
  h -= roughness * v.height * 0.06 * flank * (1 - 0.8 * g) * valley

  // Caldera: truncate the cone, add a lip, then carve a flat floored bowl.
  const s = r / v.calderaRadius
  if (s < 1.6) {
    const rim = v.height * coneProfile(v.calderaRadius / radius)
    const lip = v.lipHeight * smoothstep(0.75, 1.0, s) * smoothstep(1.6, 1.0, s)
    h = Math.min(h, rim) + lip
    const bowl = smoothstep(1.0, 0.62, s)
    h += (v.floorHeight - h) * bowl
    lastBowl = bowl
    lastFloor = v.floorHeight
  }
  lastVolcanic = smoothstep(1.0, 0.5, t)
  return h
}

/** Influence of mesas at the last sample, used to calm dunes on their tops. */
let lastMesaMask = 0

function mesaHeight(m: Mesa, x: number, z: number): number {
  const dx = x - m.x
  const dz = z - m.z
  const reach = m.radius * 1.75
  const r2 = dx * dx + dz * dz
  if (r2 >= reach * reach) return 0
  const r = Math.sqrt(r2)
  // Wobble the outline so mesas are not discs.
  const rr = r / (m.radius * (1 + 0.24 * perlin(x * 0.011, z * 0.011, m.seed)))
  const cliff = smoothstep(1.0, 0.86, rr)
  const talus = smoothstep(1.5, 0.95, rr)
  let h = m.height * (0.8 * cliff + 0.2 * talus)
  if (m.tiered) h += m.height * 0.4 * smoothstep(0.55, 0.45, rr)
  if (talus > lastMesaMask) lastMesaMask = talus
  return h
}

/** Volcanic influence of the last `shapeHeight` call. */
export let shapeVolcanic = 0

/** The analytic height field. Exported so tests and tools can sample between grid points. */
export function shapeHeight(L: TerrainLayout, s: TerrainSettings, x: number, z: number): number {
  const S = L.seeds

  // Domain warp keeps every layer from looking grid aligned.
  const wx = x + 70 * perlin(x * 0.0021, z * 0.0021, S.warpX)
  const wz = z + 70 * perlin(x * 0.0021, z * 0.0021, S.warpZ)

  // Broad rolling ground, about 700 m wavelength.
  let h = 16 * fbm(wx * 0.0014, wz * 0.0014, S.base, 3)

  // Volcano and cones first: their influence calms the small scale layers.
  let volcanic = 0
  let features = volcanoHeight(L.volcano, x, z, s.roughness, S.gully)
  volcanic = lastVolcanic
  let bowl = lastBowl
  let floor = lastFloor
  for (const c of L.cones) {
    features += volcanoHeight(c, x, z, s.roughness, S.gully + 17)
    if (lastVolcanic > volcanic) volcanic = lastVolcanic
    if (lastBowl > bowl) { bowl = lastBowl; floor = lastFloor }
  }
  lastMesaMask = 0
  for (const m of L.mesas) features += mesaHeight(m, x, z)
  const mesa = lastMesaMask
  const calm = 1 - (volcanic > mesa ? volcanic : mesa)

  // Ridged badlands in some regions, dune fields in others.
  const ridgeMask = smoothstep(-0.15, 0.45, perlin(x * 0.0011, z * 0.0011, S.ridgeMask))
  if (ridgeMask > 0 && s.roughness > 0) {
    const ridges = s.roughness * 24 * (ridged(wx * 0.0042, wz * 0.0042, S.ridge, 3) - 0.3) * ridgeMask
    h += ridges * (0.3 + 0.7 * calm)
  }

  if (s.duneHeight > 0) {
    // Crests run across the wind: stretch the noise along the crest direction.
    const u = x * L.windX + z * L.windZ
    const v = -x * L.windZ + z * L.windX
    let d = 1 - Math.abs(perlin(u * 0.016 + 0.6 * perlin(wx * 0.004, wz * 0.004, S.duneMask), v * 0.0045, S.dune))
    d *= d
    h += s.duneHeight * d * (1 - 0.8 * ridgeMask) * calm
  }

  // Fine bumps so the ground is never glassy at driving scale.
  h += (0.4 + s.roughness * 1.6) * perlin(x * 0.045, z * 0.045, S.detail) * (0.4 + 0.6 * calm)

  h += features
  // Crater floors are exactly flat at a known height, ready for a lava lake.
  if (bowl > 0) h += (floor - h) * bowl

  // Flat spawn pad at the origin, blended back into the terrain.
  const r0 = Math.sqrt(x * x + z * z)
  if (r0 < SPAWN_BLEND_RADIUS) {
    const f = smoothstep(SPAWN_FLAT_RADIUS, SPAWN_BLEND_RADIUS, r0)
    h = SPAWN_LEVEL + (h - SPAWN_LEVEL) * f
    volcanic *= f
  }

  // A raised rim at the world edge so nobody drives off the map by accident.
  const ax = x < 0 ? -x : x
  const az = z < 0 ? -z : z
  const edge = L.half - (ax > az ? ax : az)
  if (edge < 170) h += 80 * smoothstep(170, 5, edge)

  shapeVolcanic = volcanic
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
  return [shapePass, roadsPass]
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
