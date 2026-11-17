/**
 * Planet maps: an equirectangular texture of a whole planet, painted from the real island
 * generated for a recipe and seed, so the sphere a player clicks in the lobby is a true
 * preview of where they land.
 *
 * A world is a tile that wraps: drive far enough east and you are back where you began. The
 * map lays that tile over the globe twice round the equator and once from pole to pole, so
 * the ground has the same scale both ways there and the whole world shows, its land and sea
 * in their true shares, with the island centred at longitude 0, latitude 0 (the middle of
 * the image; the dive lands there) and again at longitude 180. North on the globe is -z in
 * the world, as on the minimap. Toward the poles, where a turn of longitude shrinks to
 * nothing, the ground continues as seeded noise of the same land share and palette.
 *
 * No three.js or DOM imports: runs in tests, workers and the server.
 */
import { PLANETS, planetById, planetName, type PlanetRecipe } from './planets'
import { generateTerrain, type TerrainData } from './terrain/generate'
import { paletteFor, SEA_ICE } from './terrain/palettes'
import { defaultTerrainSettings, KIND_VOLCANIC, type TerrainSettings } from './terrain/settings'

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
  // Not a hard disc but a ramp across its edge (0.5 exactly on it), so the bilinear read
  // back has a round shoreline at any zoom instead of the grid's octagons.
  const r = Math.ceil(radius / cell) + 2
  const cx = Math.round((x + half) / cell), cz = Math.round((z + half) / cell)
  for (let iz = Math.max(0, cz - r); iz <= Math.min(n - 1, cz + r); iz++) {
    for (let ix = Math.max(0, cx - r); ix <= Math.min(n - 1, cx + r); ix++) {
      const dx = -half + ix * cell - x, dz = -half + iz * cell - z
      const v = Math.min(1, Math.max(0, 0.5 + (radius - Math.sqrt(dx * dx + dz * dz)) / (3 * cell))) * value
      if (v > grid[iz * n + ix]) grid[iz * n + ix] = v
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

/** Share of the tile above the sea, read from the generated heights. */
function landShareOf(data: TerrainData, seaLevel: number): number {
  let above = 0
  for (const h of data.heights) if (h > seaLevel) above++
  return above / data.heights.length
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
  // A frozen sea is ice from space too: floes and blue cracks, and dry to the lobby's glints.
  const frozen = !lavaSea && recipe.values['world.seaFrozen'] === true
  const seaWet = frozen ? 0 : 1
  const lavaLake = kind === KIND_VOLCANIC
  const dry = settings.dry > 0
  // Match the terrain material's threshold; the map still approximates slope and noise.
  const snowy = settings.snowLine < 2
  const snowLine = snowy ? data.layout.summitHeight * settings.snowLine : Infinity
  // A dry world has no sea: its low ground is land all the way down.
  const seaLevel = dry ? -1e6 : Number(recipe.values['world.lavaAltitude'] ?? 0)
  const ov = overlays(data)
  const N = lattice(seed | 0)

  const n = data.resolution, size = data.size, half = size / 2, cell = data.cell, H = data.heights
  // The tile is a wrap: one size of a world is one whole turn of it. Two tiles round the
  // equator and one from pole to pole keep the ground the same scale both ways there.
  const perRadian = size / Math.PI
  const wrap = (v: number) => v - size * Math.floor((v + half) / size)
  // Wet ground a lake or river covers, sampled with the same wrap.
  const wetAt = (x: number, z: number) => sampleGrid(ov.liquid, ov.n, half, ov.cell, x, z)
  // Away from the tile's own rows (toward the poles, where a turn of longitude shrinks to
  // nothing), the ground continues as seeded noise of the same land share and palette.
  const share = dry ? 1 : landShareOf(data, seaLevel)
  const shareCut = 0.5 + (0.5 - share) * 0.42

  const C = {
    gd: rgb(pal.groundDark), gl: rgb(pal.groundLight), rd: rgb(pal.rockDark), rl: rgb(pal.rockLight),
    ba: rgb(pal.darkRockA), bb: rgb(pal.darkRockB), shore: rgb(pal.shore), road: rgb(pal.roadLine),
    snow: rgb(pal.snow), tree: rgb(TREE), crust: rgb(LAVA_CRUST), hot: rgb(LAVA_HOT), white: rgb(LAVA_WHITE),
    deep: rgb(pal.seaDeep), shallow: rgb(pal.seaShallow), foam: rgb(FOAM),
    floe: rgb(SEA_ICE.floe), old: rgb(SEA_ICE.old), crack: rgb(SEA_ICE.crack),
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
      const crack = smooth(0.06, 0.0, Math.abs(v - 0.5))
      col[0] = C.crust[0]; col[1] = C.crust[1]; col[2] = C.crust[2]
      mixInto(col, C.hot, clamp01(crack * 0.85 + shore * 0.75))
      mixInto(col, C.white, shore * shore * 0.6)
    } else if (frozen) {
      const v = valueNoise(N, nx * 11 + 3.3, ny * 11, nz * 11), w = valueNoise(N, nx * 31 + 7.7, ny * 31, nz * 31)
      col[0] = C.old[0]; col[1] = C.old[1]; col[2] = C.old[2]
      mixInto(col, C.floe, smooth(0.35, 0.65, v))
      mixInto(col, C.crack, smooth(0.03, 0, Math.abs(w - 0.5)) * 0.8)
    } else {
      const v = valueNoise(N, nx * 18, ny * 18, nz * 18)
      col[0] = C.deep[0]; col[1] = C.deep[1]; col[2] = C.deep[2]
      mixInto(col, C.shallow, clamp01(shore * 0.85 + (v - 0.5) * 0.12))
      mixInto(col, C.foam, smooth(0.9, 1, shore) * 0.8)
    }
  }

  // Value noise read twice on turned axes and averaged: one read alone shows its lattice as squares.
  const soft = (x: number, y: number, z: number, f: number, o: number) =>
    (valueNoise(N, x * f + o, y * f, z * f) + valueNoise(N, (x * 0.8 - z * 0.6) * f * 1.37 + o + 17.3, (y * 0.8 + x * 0.36) * f * 1.37, (z * 0.8 + x * 0.48 + y * 0.36) * f * 1.37)) * 0.5
  // Bare ground for the far side of a world with no sea: the palette mottled at two scales,
  // with dark basins, so it reads as the same dust as the mapped square.
  const farGround = (nx: number, ny: number, nz: number) => {
    const v1 = soft(nx, ny, nz, 5, 80.41)
    const v2 = soft(nx, ny, nz, 40, 95.03)
    col[0] = C.gd[0]; col[1] = C.gd[1]; col[2] = C.gd[2]
    mixInto(col, C.gl, smooth(0.15, 0.85, v1 * 0.7 + v2 * 0.3))
    mixInto(col, C.ba, smooth(0.52, 0.66, valueNoise(N, nx * 2.3 + 12.7, ny * 2.3, nz * 2.3)) * 0.7)
    const pit = valueNoise(N, nx * 22 + 3.1, ny * 22, nz * 22)
    mixInto(col, C.rd, smooth(0.7, 0.8, pit) * 0.6)
    const s = 0.85 + v2 * 0.25
    col[0] *= s; col[1] *= s; col[2] *= s
  }

  // Light and slope at each grid point, from its neighbours across the wrap. Read back with
  // the same bilinear filter as the heights, they shade smoothly: differencing the filtered
  // heights instead drew every grid cell as a flat facet.
  const shadeGrid = new Float32Array(n * n), slopeGrid = new Float32Array(n * n), last = n - 1
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    // The last row and column repeat the first: step past them to the second.
    const at = (x: number, z: number) => H[(((z % last) + last) % last) * n + (((x % last) + last) % last)]
    const gx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * cell), gz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * cell)
    const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1)
    slopeGrid[iz * n + ix] = 1 - inv
    shadeGrid[iz * n + ix] = 0.6 + 0.6 * clamp01((-gx * lx + ly - gz * lz) * inv)
  }
  const rock: RGB = [0, 0, 0], land: RGB = [0, 0, 0]
  const cratered = settings.craters > 0
  const banded = settings.look === 1 || settings.look === 6
  // Craters too small for the tile's grid, on the sphere itself: a bowl lit from the map's
  // light, a bright rim, a darker floor. Worley cells at two scales, a share of them struck.
  const craterShade = (nx: number, ny: number, nz: number): number => {
    let shade = 1
    for (const [scale, share, salt] of [[34, 0.45, 11], [90, 0.35, 23]] as const) {
      // A crater reaches at most 0.45 of a cell from its centre: only the cells within that of this point.
      const px = nx * scale, py = ny * scale, pz = nz * scale, ix = Math.floor(px - 0.45), iy = Math.floor(py - 0.45), iz = Math.floor(pz - 0.45)
      const ax = Math.floor(px + 0.45) - ix, ay = Math.floor(py + 0.45) - iy, az = Math.floor(pz + 0.45) - iz
      for (let a = 0; a <= ax; a++) for (let b = 0; b <= ay; b++) for (let c = 0; c <= az; c++) {
        const h = hash3(ix + a, iy + b, iz + c, salt + (seed | 0))
        if (h > share * settings.craters / 0.7) continue
        const ox = ix + a + hash3(ix + a, iy + b, iz + c, salt + 1) - px, oy = iy + b + hash3(ix + a, iy + b, iz + c, salt + 2) - py, oz = iz + c + hash3(ix + a, iy + b, iz + c, salt + 3) - pz
        const radius = 0.14 + 0.22 * hash3(ix + a, iy + b, iz + c, salt + 4), d = Math.sqrt(ox * ox + oy * oy + oz * oz) / radius
        if (d > 1.25) continue
        // Inside: the wall facing the light is in shade. Outside, a fading rim of ejecta.
        const towards = (ox * -0.6 + oy * 0.4 + oz * -0.6) / (d * radius + 1e-6)
        shade *= d < 1 ? 0.78 + 0.22 * towards * d + 0.16 * smooth(0.75, 1, d) : 1 + 0.18 * smooth(1.25, 1, d)
      }
    }
    return shade
  }
  // Dry ground at world (x, z), height h, into col. Returns how much a lake or river covers it.
  const ground = (h: number, wx: number, wz: number, nx: number, ny: number, nz: number): number => {
    const slope = sampleGrid(slopeGrid, n, half, cell, wx, wz), shade = sampleGrid(shadeGrid, n, half, cell, wx, wz)
    // Mottling on the sphere itself, so it has no seam where the tile wraps.
    // (Finer grain than this is the lobby shader's, at close range: see Galaxy.)
    const v1 = valueNoise(N, nx * 2.6 + 80.41, ny * 2.6, nz * 2.6), v2 = soft(nx, ny, nz, 19, 95.03)
    const light = smooth(0.3, 0.7, v2)
    col[0] = C.gd[0]; col[1] = C.gd[1]; col[2] = C.gd[2]
    mixInto(col, C.gl, smooth(0.15, 0.85, v1 * 0.7 + v2 * 0.3))
    // Rock on cliffs, broken up by noise so a ring of cliffs reads as relief, not a painted band.
    const cliff = smooth(0.1, 0.34, slope) * (0.4 + 0.35 * v2)
    // Sandstone and badland cliffs are banded: strata by height, wavering with the noise.
    const strata = banded ? 0.5 + 0.5 * Math.sin(h * 0.09 + v2 * 5) : light
    const tone = banded ? strata * 0.7 + light * 0.3 : light
    rock[0] = C.rd[0] + (C.rl[0] - C.rd[0]) * tone; rock[1] = C.rd[1] + (C.rl[1] - C.rd[1]) * tone; rock[2] = C.rd[2] + (C.rl[2] - C.rd[2]) * tone
    mixInto(col, rock, cliff)
    const vol = sampleGrid(data.volcanic, n, half, cell, wx, wz)
    rock[0] = C.ba[0] + (C.bb[0] - C.ba[0]) * light; rock[1] = C.ba[1] + (C.bb[1] - C.ba[1]) * light; rock[2] = C.ba[2] + (C.bb[2] - C.ba[2]) * light
    mixInto(col, rock, clamp01(vol * (0.45 + smooth(0.03, 0.2, slope) * 0.35)) * (0.7 + 0.3 * v2))
    // Beach.
    if (!dry) mixInto(col, C.shore, smooth(8, 2, h - seaLevel) * 0.9)
    // Trees.
    const tree = sampleGrid(ov.trees, ov.n, half, ov.cell, wx, wz)
    mixInto(col, C.tree, clamp01(tree * 1.4) * 0.75)
    // Snow, ragged at its lower edge and thinner on steep faces.
    if (h + v2 * 40 > snowLine) mixInto(col, C.snow, smooth(snowLine, snowLine + 50, h + v2 * 40) * smooth(0.5, 0.2, slope))
    // Roads, barely: from space a track is a thread, and a ring road must not make a target.
    const road = sampleGrid(data.roadDist, n, half, cell, wx, wz)
    mixInto(col, C.road, smooth(9, 4, road) * 0.07)
    // Relief from the height map's own normals, a little stronger than before, so terraces read as steps.
    const lit = (0.4 + 0.85 * (shade - 0.6) / 0.6) * (cratered ? craterShade(nx, ny, nz) : 1)
    col[0] *= lit; col[1] *= lit; col[2] *= lit
    // Lake, rivers and pools over the ground, with soft round shores.
    const wet = sampleGrid(ov.liquid, ov.n, half, ov.cell, wx, wz)
    if (wet > 0.42) {
      const keep: RGB = [col[0], col[1], col[2]]
      liquid(lavaLake, 0.6, nx, ny, nz)
      const t = smooth(0.42, 0.58, wet)
      col[0] = keep[0] + (col[0] - keep[0]) * t; col[1] = keep[1] + (col[1] - keep[1]) * t; col[2] = keep[2] + (col[2] - keep[2]) * t
      return t
    }
    return 0
  }
  // The tile at world (x, z): sets col, returns how wet it is (0 dry ground, 1 sea). The coast
  // is blended across a couple of metres of height, so it is a smooth curve, not stair steps.
  const tile = (wx: number, wz: number, nx: number, ny: number, nz: number): number => {
    const h = sampleGrid(H, n, half, cell, wx, wz), t = dry ? 1 : smooth(seaLevel - 1.5, seaLevel + 1.5, h)
    let wet = 0
    if (t > 0) { wet = ground(h, wx, wz, nx, ny, nz); if (t < 1) { land[0] = col[0]; land[1] = col[1]; land[2] = col[2] } }
    if (t < 1) {
      // Sea: shallower water lightens, a lava sea glows brighter toward its shore.
      liquid(lavaSea, smooth(lavaSea ? -30 : -60, 0, h - seaLevel), nx, ny, nz)
      if (t > 0) { col[0] += (land[0] - col[0]) * t; col[1] += (land[1] - col[1]) * t; col[2] += (land[2] - col[2]) * t }
      wet = wet * t + (1 - t) * seaWet
    }
    return wet
  }
  // The same world's ground where the tile does not reach: noise of its land share.
  const beyond = (nx: number, ny: number, nz: number): number => {
    if (dry) { farGround(nx, ny, nz); if (cratered) { const k = craterShade(nx, ny, nz); col[0] *= k; col[1] *= k; col[2] *= k } return 0 }
    const v = valueNoise(N, nx * 3.1 + 7.3, ny * 3.1, nz * 3.1) * 0.6 + valueNoise(N, nx * 9 + 1.7, ny * 9, nz * 9) * 0.3
      + valueNoise(N, nx * 27 + 4.1, ny * 27, nz * 27) * 0.1
    const coast = v - shareCut
    if (coast < 0) { liquid(lavaSea, smooth(-0.08, 0, coast), nx, ny, nz); return seaWet }
    farGround(nx, ny, nz)
    mixInto(col, C.shore, smooth(0.02, 0, coast) * 0.8)
    return 0
  }

  const keep: RGB = [0, 0, 0]
  for (let py = 0; py < height; py++) {
    const lat = Math.PI / 2 - ((py + 0.5) / height) * Math.PI
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat)
    // Toward the poles the tile's rows give way to the noise: by 70 degrees it is all noise.
    const away = smooth(0.8, 0.94, Math.abs(sinLat))
    // Polar caps: frost on a water world (thicker on a snowy one), dark crust on a lava sea.
    const polar = smooth(0.93, 0.985, Math.abs(sinLat))
    const wz = wrap(-lat * perRadian)
    for (let px = 0; px < width; px++) {
      const lon = ((px + 0.5) / width) * Math.PI * 2 - Math.PI
      // Unit vector: +x towards (lon 0, lat 0), +y north, +z east.
      const nx = cosLat * Math.cos(lon), ny = sinLat, nz = cosLat * Math.sin(lon)
      let wet = 0
      if (away < 1) wet = tile(wrap(lon * perRadian), wz, nx, ny, nz)
      if (away > 0) {
        keep[0] = col[0]; keep[1] = col[1]; keep[2] = col[2]
        const far = beyond(nx, ny, nz)
        if (away < 1) {
          col[0] = keep[0] + (col[0] - keep[0]) * away; col[1] = keep[1] + (col[1] - keep[1]) * away; col[2] = keep[2] + (col[2] - keep[2]) * away
          wet += (far - wet) * away
        } else wet = far
      }
      if (polar > 0) {
        if (lavaSea && wet > 0.5) mixInto(col, C.crust, polar * 0.7)
        else if (!lavaSea && !dry) { mixInto(col, C.snow, polar * (snowy ? 0.9 : 0.35)); wet *= 1 - polar * (snowy ? 0.9 : 0.35) }
      }
      const o = (py * width + px) * 4
      // Alpha is dryness: 255 ground, 0 open sea, lake or river. The lobby reads it for
      // glints on water and the glow of lava, so it never has to guess from the colour.
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = Math.round(255 * (1 - clamp01(wet)))
    }
  }
  return { width, height, data: out }
}
