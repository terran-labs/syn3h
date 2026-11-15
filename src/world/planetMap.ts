/**
 * Planet maps: an equirectangular texture of a whole planet, painted from the real island
 * generated for a recipe and seed, so the sphere a player clicks in the lobby is a true
 * preview of where they land.
 *
 * The island is the continent facing the viewer: centred at longitude 0, latitude 0 (the
 * middle of the image), with the full 2 km square spanning ISLAND_ANGLE degrees of arc from
 * the centre to each edge, in an azimuthal equidistant projection. North on the globe is
 * -z in the world, as on the minimap. The rest of the globe is sea with a few small
 * hash-noise islets so the far side is not empty.
 *
 * No three.js or DOM imports: runs in tests, workers and the server.
 */
import { PLANETS, planetById, planetName, type PlanetRecipe } from './planets'
import { generateTerrain, type TerrainData } from './terrain/generate'
import { paletteFor } from './terrain/palettes'
import { defaultTerrainSettings, KIND_VOLCANIC, type TerrainSettings } from './terrain/settings'

/** Angular distance from the globe's centre point to the edge of the 2 km square, in degrees. */
export const ISLAND_ANGLE = 38
/** Grid resolution of the island generated for the map. */
export const MAP_RESOLUTION = 129

export interface PlanetMap {
  width: number
  height: number
  /** RGBA, row 0 is the north pole, column 0 is longitude -180. */
  data: Uint8ClampedArray
}

export interface PlanetCard {
  id: string
  label: string
  blurb: string
  centre: string
  name: string
  seed: number
  sea: 'lava' | 'water'
}

/** Terrain settings for a recipe: the defaults overridden by its 'terrain.*' values. */
export function settingsForRecipe(recipe: PlanetRecipe): TerrainSettings {
  const s = defaultTerrainSettings()
  for (const [id, value] of Object.entries(recipe.values)) {
    if (!id.startsWith('terrain.')) continue
    const key = id.slice('terrain.'.length) as keyof TerrainSettings
    if (key in s && typeof value === 'number') s[key] = value
  }
  return s
}

export function planetCard(recipeId: string, seed: number): PlanetCard {
  const r = planetById(recipeId) ?? PLANETS[0]
  return {
    id: r.id, label: r.label, blurb: r.blurb, centre: r.centre, name: planetName(seed), seed,
    sea: r.values['world.seaKind'] === 0 ? 'lava' : 'water',
  }
}

// ---------------------------------------------------------------------------------------
// Colours. The ground palettes are terrain/palettes.ts, shared with the terrain material.
// ---------------------------------------------------------------------------------------

const TREE = 0x1d3a1a
const LAVA_CRUST = 0x2a0703
const LAVA_HOT = 0xff7a1a
const LAVA_WHITE = 0xffd27a
const FOAM = 0xf2fbff

type RGB = [number, number, number]
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t) }
/** Mix `out` toward `c` by `t`, in place. */
function mixInto(out: RGB, c: RGB, t: number): void {
  out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t
}

// ---------------------------------------------------------------------------------------
// Hash noise: 3D value noise on the unit sphere, so there is no seam or polar pinch.
// ---------------------------------------------------------------------------------------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** Lattice of hashed values, 32 cells each way, wrapping. Built per seed: a table read is
 * much cheaper than hashing eight corners per pixel. The period of 32 cells is longer than
 * the visible side of the globe at the frequencies used, so it never shows. */
const LATTICE = 32
function lattice(seed: number): Float32Array {
  const t = new Float32Array(LATTICE * LATTICE * LATTICE)
  for (let z = 0; z < LATTICE; z++) for (let y = 0; y < LATTICE; y++) for (let x = 0; x < LATTICE; x++) {
    t[(z * LATTICE + y) * LATTICE + x] = hash3(x, y, z, seed)
  }
  return t
}

/** Smooth 3D value noise in 0..1 from a lattice made by `lattice`. */
function valueNoise(t: Float32Array, x: number, y: number, z: number): number {
  const fx0 = Math.floor(x), fy0 = Math.floor(y), fz0 = Math.floor(z)
  let fx = x - fx0, fy = y - fy0, fz = z - fz0
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz)
  const m = LATTICE - 1
  const x0 = fx0 & m, y0 = fy0 & m, z0 = fz0 & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m, z1 = (z0 + 1) & m
  const r00 = (z0 * LATTICE + y0) * LATTICE, r10 = (z0 * LATTICE + y1) * LATTICE
  const r01 = (z1 * LATTICE + y0) * LATTICE, r11 = (z1 * LATTICE + y1) * LATTICE
  const ab = t[r00 + x0] + (t[r00 + x1] - t[r00 + x0]) * fx, cd = t[r10 + x0] + (t[r10 + x1] - t[r10 + x0]) * fx
  const ef = t[r01 + x0] + (t[r01 + x1] - t[r01 + x0]) * fx, gh = t[r11 + x0] + (t[r11 + x1] - t[r11 + x0]) * fx
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy
  return lo + (hi - lo) * fz
}

// ---------------------------------------------------------------------------------------
// Island sampling
// ---------------------------------------------------------------------------------------

/** Bilinear read of a resolution x resolution grid at world x, z. */
function sampleGrid(grid: Float32Array, n: number, half: number, cell: number, x: number, z: number): number {
  let gx = (x + half) / cell, gz = (z + half) / cell
  const max = n - 1.0001
  gx = gx < 0 ? 0 : gx > max ? max : gx
  gz = gz < 0 ? 0 : gz > max ? max : gz
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, i = iz * n + ix
  const p = grid[i] + (grid[i + 1] - grid[i]) * fx
  const q = grid[i + n] + (grid[i + n + 1] - grid[i + n]) * fx
  return p + (q - p) * fz
}

/** Mark cells of a coverage grid within `radius` metres of a point. */
function stamp(grid: Float32Array, n: number, half: number, cell: number, x: number, z: number, radius: number, value = 1): void {
  const r = Math.ceil(radius / cell)
  const cx = Math.round((x + half) / cell), cz = Math.round((z + half) / cell)
  for (let iz = Math.max(0, cz - r); iz <= Math.min(n - 1, cz + r); iz++) {
    for (let ix = Math.max(0, cx - r); ix <= Math.min(n - 1, cx + r); ix++) {
      const dx = -half + ix * cell - x, dz = -half + iz * cell - z
      if (dx * dx + dz * dz <= radius * radius) grid[iz * n + ix] = Math.max(grid[iz * n + ix], value)
    }
  }
}

interface Overlays { n: number; cell: number; liquid: Float32Array; trees: Float32Array }

/** Rivers, pools and the lake as a liquid mask; trees as a density mask. Both on a fine grid. */
function overlays(data: TerrainData): Overlays {
  const n = 257, cell = data.size / (n - 1), half = data.size / 2
  const liquid = new Float32Array(n * n), trees = new Float32Array(n * n)
  const { lake, rivers, pools } = data.lava
  if (lake) stamp(liquid, n, half, cell, lake.x, lake.z, lake.radius)
  for (const p of pools) stamp(liquid, n, half, cell, p.x, p.z, p.radius)
  for (const r of rivers) for (const p of r.points) stamp(liquid, n, half, cell, p.x, p.z, Math.max(r.width * 0.5, cell * 0.75))
  const t = data.trees
  for (let i = 0; i + 3 < t.length; i += 4) {
    const ix = Math.round((t[i] + half) / cell), iz = Math.round((t[i + 2] + half) / cell)
    if (ix >= 0 && iz >= 0 && ix < n && iz < n) trees[iz * n + ix] = Math.min(1, trees[iz * n + ix] + 0.5)
  }
  return { n, cell, liquid, trees }
}

// ---------------------------------------------------------------------------------------
// Islets: a few blobs scattered over the globe, away from the continent.
// ---------------------------------------------------------------------------------------

interface Islet { x: number; y: number; z: number; cos: number; size: number }

function islets(seed: number): Islet[] {
  const out: Islet[] = []
  let s = (seed ^ 0x5bd1e995) >>> 0
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  const count = 9 + Math.floor(next() * 6)
  for (let tries = 0; out.length < count && tries < 200; tries++) {
    // Uniform direction on the sphere.
    const y = next() * 2 - 1, a = next() * Math.PI * 2, r = Math.sqrt(1 - y * y)
    const x = r * Math.cos(a), z = r * Math.sin(a)
    // The continent's centre is +x in our frame (lon 0, lat 0): keep islets well clear.
    if (x > Math.cos(((ISLAND_ANGLE + 14) * Math.PI) / 180)) continue
    const size = (2 + next() * 6) * (Math.PI / 180)
    out.push({ x, y, z, size, cos: Math.cos(size * 1.6) })
  }
  return out
}

// ---------------------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------------------

/**
 * Paint a planet as an RGBA equirectangular texture: longitude across (column 0 at -180),
 * latitude down (row 0 at the north pole). Deterministic for the same inputs.
 * Overrides come from the sanitized parameter snapshot; this painter does not mutate it.
 */
export function paintPlanetMap(recipeId: string, seed: number, width = 1024, height = 512, overrides: PlanetRecipe['values'] = {}): PlanetMap {
  const base = planetById(recipeId) ?? PLANETS[0]
  const recipe = { ...base, values: { ...base.values, ...overrides } }
  const settings = settingsForRecipe(recipe)
  const data = generateTerrain(seed, settings, { resolution: MAP_RESOLUTION })
  const kind = settings.kind
  const pal = paletteFor(settings.look)
  const lavaSea = recipe.values['world.seaKind'] === 0
  const lavaLake = kind === KIND_VOLCANIC
  const dry = settings.dry > 0
  // Match the terrain material's threshold; the map still approximates slope and noise.
  const snowy = settings.snowLine < 2
  const snowLine = snowy ? data.layout.summitHeight * settings.snowLine : Infinity
  // A dry world has no sea: its low ground is land all the way down.
  const seaLevel = dry ? -1e6 : Number(recipe.values['world.lavaAltitude'] ?? 0)
  const ov = overlays(data)
  const isles = islets(seed)
  const N = lattice(seed | 0)

  const n = data.resolution, half = data.size / 2, cell = data.cell, H = data.heights
  const metresPerRad = half / ((ISLAND_ANGLE * Math.PI) / 180)
  // Beyond this angle from the centre the square cannot reach (its corners).
  const maxC = ((ISLAND_ANGLE * Math.SQRT2 + 1) * Math.PI) / 180
  const cosMaxC = Math.cos(maxC)

  const C = {
    gd: rgb(pal.groundDark), gl: rgb(pal.groundLight), rd: rgb(pal.rockDark), rl: rgb(pal.rockLight),
    ba: rgb(pal.darkRockA), bb: rgb(pal.darkRockB), shore: rgb(pal.shore), road: rgb(pal.roadLine),
    snow: rgb(pal.snow), tree: rgb(TREE), crust: rgb(LAVA_CRUST), hot: rgb(LAVA_HOT), white: rgb(LAVA_WHITE),
    deep: rgb(pal.seaDeep), shallow: rgb(pal.seaShallow), foam: rgb(FOAM),
  }
  // Light from the north west, a little above the horizon. World: north is -z, west is -x.
  const lx = -0.55, lz = -0.55, ly = 0.63
  const out = new Uint8ClampedArray(width * height * 4)
  const col: RGB = [0, 0, 0]

  // Liquid colour for a pixel. `shore` is 0 in open sea, 1 at the coastline.
  const liquid = (lava: boolean, shore: number, nx: number, ny: number, nz: number) => {
    if (lava) {
      // Crust plates with bright cracks along the noise's mid contour.
      const v = valueNoise(N, nx * 9, ny * 9, nz * 9) * 0.7 + valueNoise(N, nx * 27 + 51.17, ny * 27, nz * 27) * 0.3
      const crack = smooth(0.035, 0.0, Math.abs(v - 0.5))
      col[0] = C.crust[0]; col[1] = C.crust[1]; col[2] = C.crust[2]
      mixInto(col, C.hot, clamp01(crack * 0.85 + shore * 0.75))
      mixInto(col, C.white, shore * shore * 0.6)
    } else {
      const v = valueNoise(N, nx * 18, ny * 18, nz * 18)
      col[0] = C.deep[0]; col[1] = C.deep[1]; col[2] = C.deep[2]
      mixInto(col, C.shallow, clamp01(shore * 0.85 + (v - 0.5) * 0.12))
      mixInto(col, C.foam, smooth(0.9, 1, shore) * 0.8)
    }
  }

  // Bare ground for the far side of a world with no sea: the palette mottled at two scales,
  // with dark basins, so it reads as the same dust as the mapped square.
  const farGround = (nx: number, ny: number, nz: number) => {
    const v1 = valueNoise(N, nx * 5 + 80.41, ny * 5, nz * 5)
    const v2 = valueNoise(N, nx * 40 + 95.03, ny * 40, nz * 40)
    col[0] = C.gd[0]; col[1] = C.gd[1]; col[2] = C.gd[2]
    mixInto(col, C.gl, smooth(0.15, 0.85, v1 * 0.7 + v2 * 0.3))
    mixInto(col, C.ba, smooth(0.52, 0.66, valueNoise(N, nx * 2.3 + 12.7, ny * 2.3, nz * 2.3)) * 0.7)
    const pit = valueNoise(N, nx * 22 + 3.1, ny * 22, nz * 22)
    mixInto(col, C.rd, smooth(0.7, 0.8, pit) * 0.6)
    const s = 0.85 + v2 * 0.25
    col[0] *= s; col[1] *= s; col[2] *= s
  }

  // Longitude trig per column, reused on every row.
  const cosLon = new Float64Array(width), sinLon = new Float64Array(width)
  for (let px = 0; px < width; px++) {
    const lon = ((px + 0.5) / width) * Math.PI * 2 - Math.PI
    cosLon[px] = Math.cos(lon); sinLon[px] = Math.sin(lon)
  }

  for (let py = 0; py < height; py++) {
    const lat = Math.PI / 2 - ((py + 0.5) / height) * Math.PI
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat)
    // Polar tint: frost on water worlds, dark crust on lava worlds.
    const polar = smooth(0.93, 0.985, Math.abs(sinLat))
    for (let px = 0; px < width; px++) {
      // Unit vector: +x towards (lon 0, lat 0), +y north, +z east.
      const nx = cosLat * cosLon[px], ny = sinLat, nz = cosLat * sinLon[px]
      let land = false

      if (nx > cosMaxC) {
        // Azimuthal equidistant around the centre: distance c and bearing from north.
        const c = Math.acos(nx > 1 ? 1 : nx)
        const s = Math.hypot(ny, nz) || 1
        const east = (nz / s) * c, north = (ny / s) * c
        const wx = east * metresPerRad, wz = -north * metresPerRad
        if (wx > -half && wx < half && wz > -half && wz < half) {
          const h = sampleGrid(H, n, half, cell, wx, wz)
          if (h > seaLevel) {
            land = true
            const hx = sampleGrid(H, n, half, cell, wx + cell, wz) - sampleGrid(H, n, half, cell, wx - cell, wz)
            const hz = sampleGrid(H, n, half, cell, wx, wz + cell) - sampleGrid(H, n, half, cell, wx, wz - cell)
            // Normal of the surface: (-dh/dx, 1, -dh/dz) normalised.
            const gx = hx / (2 * cell), gz = hz / (2 * cell)
            const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1)
            const slope = 1 - inv
            const shade = 0.55 + 0.75 * clamp01((-gx * lx + ly - gz * lz) * inv)
            const v1 = valueNoise(N, wx * 0.004 + 80.41, 0, wz * 0.004)
            const v2 = valueNoise(N, wx * 0.03 + 95.03, 1.5, wz * 0.03)
            col[0] = C.gd[0]; col[1] = C.gd[1]; col[2] = C.gd[2]
            mixInto(col, C.gl, smooth(0.15, 0.85, v1 * 0.7 + v2 * 0.3))
            // Rock on cliffs, basalt on volcanic ground.
            const cliff = smooth(0.08, 0.3, slope)
            mixInto(col, v2 > 0.5 ? C.rl : C.rd, cliff)
            const vol = sampleGrid(data.volcanic, n, half, cell, wx, wz)
            mixInto(col, v2 > 0.5 ? C.bb : C.ba, clamp01(vol * (0.5 + smooth(0.03, 0.2, slope) * 0.4)))
            // Beach.
            mixInto(col, C.shore, smooth(8, 2, h - (dry ? -1e6 : seaLevel)) * 0.9)
            // Trees.
            const tree = sampleGrid(ov.trees, ov.n, half, ov.cell, wx, wz)
            mixInto(col, C.tree, clamp01(tree * 1.4) * 0.75)
            // Snow, ragged at its lower edge and thinner on steep faces.
            if (h + v2 * 40 > snowLine) mixInto(col, C.snow, smooth(snowLine, snowLine + 50, h + v2 * 40) * smooth(0.5, 0.2, slope))
            // Faint roads.
            const road = sampleGrid(data.roadDist, n, half, cell, wx, wz)
            mixInto(col, C.road, smooth(9, 4, road) * 0.35)
            col[0] *= shade; col[1] *= shade; col[2] *= shade
            // Lake, rivers and pools, drawn over the ground.
            const wet = sampleGrid(ov.liquid, ov.n, half, ov.cell, wx, wz)
            if (wet > 0.35) {
              const keep: RGB = [col[0], col[1], col[2]]
              liquid(lavaLake, 0.6, nx, ny, nz)
              const t = smooth(0.35, 0.6, wet)
              col[0] = keep[0] + (col[0] - keep[0]) * t; col[1] = keep[1] + (col[1] - keep[1]) * t; col[2] = keep[2] + (col[2] - keep[2]) * t
            }
          } else {
            // Sea over the continent's shelf: shallower water glows or lightens near the coast.
            const edge = Math.max(Math.abs(wx), Math.abs(wz))
            liquid(lavaSea, smooth(lavaSea ? -30 : -60, 0, h - seaLevel) * smooth(half, half * 0.8, edge), nx, ny, nz)
          }
        } else if (dry) {
          land = true
          farGround(nx, ny, nz)
        } else {
          liquid(lavaSea, 0, nx, ny, nz)
        }
      } else if (dry) {
        land = true
        farGround(nx, ny, nz)
      } else {
        // Islets: a wobbled distance to the nearest blob centre.
        let best = -1
        for (const is of isles) {
          const d = nx * is.x + ny * is.y + nz * is.z
          if (d < is.cos) continue
          const ang = Math.acos(d > 1 ? 1 : d)
          const wob = valueNoise(N, nx * 30 + is.x * 9 + 21.93, ny * 30, nz * 30) - 0.5
          const v = 1 - ang / is.size + wob * 0.9
          if (v > best) best = v
        }
        if (best > 0) {
          land = true
          const v2 = valueNoise(N, nx * 140 + 36.55, ny * 140, nz * 140)
          col[0] = C.gd[0]; col[1] = C.gd[1]; col[2] = C.gd[2]
          mixInto(col, C.gl, v2 * 0.7)
          mixInto(col, kind === KIND_VOLCANIC ? C.ba : C.rd, smooth(0.45, 0.9, best) * 0.6)
          mixInto(col, C.shore, smooth(0.12, 0.0, best) * 0.8)
          if (snowy) mixInto(col, C.snow, smooth(settings.snowLine < 0.2 ? 0.1 : 0.7, 0.95, best))
          const s = 0.8 + v2 * 0.3
          col[0] *= s; col[1] *= s; col[2] *= s
        } else {
          liquid(lavaSea, smooth(-0.35, 0, best), nx, ny, nz)
        }
      }

      if (polar > 0) {
        if (lavaSea && !land) mixInto(col, C.crust, polar * 0.7)
        else if (!lavaSea && !dry) mixInto(col, C.snow, polar * (snowy ? 0.9 : 0.35))
      }
      const o = (py * width + px) * 4
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255
    }
  }
  return { width, height, data: out }
}
