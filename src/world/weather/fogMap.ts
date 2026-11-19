/**
 * Fog maps: where fog banks lie on a world, generated from its terrain and seed, and how much
 * of them the hour shows. Read by the scene fog (fog.ts) as a third haze layer of the haze
 * field (haze.ts):
 *
 *   sigma_bank(p) = FOG_BANK_DENSITY * strength * ( coast(x,z) * wCoast(hour) * exp(-max(y - sea, 0) / Hf)
 *                                                 + valley(x,z) * wValley(hour) * exp(-max(y - top(x,z), 0) / VALLEY_TOP_SOFTNESS) )
 *
 * Both are banks, not veils: coastal fog lies flat on the sea and reaches inland only where the
 * land is low; valley fog fills a hollow to a flat top part way up its rim and thins within a
 * few metres above it, a lake of mist.
 * Coastal fog: thick over the water and up to a few hundred metres inland, from the distance
 * to the waterline. It rolls in at dawn, burns off by mid morning and returns in the evening.
 * Valley fog: cells lying below the terrain round them hold it, deeper hollows more; it pools
 * at night and at dawn and lifts in the morning. Both are broken into banks by noise from the
 * world seed, so no two worlds lie alike.
 *
 * Generated on the CPU when the terrain is built (128 x 128 cells over the wrapping tile, a few
 * milliseconds), uploaded as one small texture. Nothing is shipped as an image. The hour is the
 * room clock's (src/world/sky/dayCycle.ts), so every client sees the same fog; with the day
 * clock stopped the fixed hour decides, so a world held at noon has no dawn bank.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../../shared/params'

const w = 'world' as const
const group = 'Weather'

/** Fog banks on this world, 0 none. Per world (planetWeather.ts); 1 is the full bank. */
export const fogBanks = defineParam({ id: 'weather.fogBanks', label: 'Fog banks', group, scope: w, default: 0, min: 0, max: 2, step: 0.05 })
/** How high the banks reach over their floor before thinning to a third (m). */
export const fogBankHeight = defineParam({ id: 'weather.fogBankHeight', label: 'Fog bank height (m)', group, scope: w, default: 25, min: 5, max: 120, step: 1 })
/** Weight of the coastal fog and of the valley fog in the banks. */
export const fogCoast = defineParam({ id: 'weather.fogCoast', label: 'Coastal fog', group, scope: w, default: 1, min: 0, max: 2, step: 0.05 })
export const fogValley = defineParam({ id: 'weather.fogValley', label: 'Valley fog', group, scope: w, default: 1, min: 0, max: 2, step: 0.05 })
/** Share of the banks that stays all day (a marsh's mist), 0 to 1. */
export const fogAllDay = defineParam({ id: 'weather.fogAllDay', label: 'Fog that stays all day', group, scope: w, default: 0, min: 0, max: 1, step: 0.05 })
/**
 * How the banks are drawn on this device: 0 off, 1 one sample at the pixel (cheap), 2 three
 * samples along the sight line. Set by the quality level (src/core/quality.ts).
 */
export const fogBankDetail = defineParam({ id: 'gfx.fogBanks', label: 'Fog bank detail: 0 off, 1 cheap, 2 full', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })

/** Metres over which valley fog thins above its flat top. */
export const VALLEY_TOP_SOFTNESS = 12
/**
 * Most optical depth a fog bank alone adds to a sight line: a bank never hides more than 63% of
 * what is behind it, so from inside one the ridges stay as silhouettes and the sky brightens
 * above: fog you are in, never a blank screen.
 */
export const FOG_BANK_TAU_MAX = 1
/** How far up its rim a hollow's fog fills it, as a share of the hollow's depth. */
export const VALLEY_FILL = 0.8

/**
 * Extinction per metre at a bank's floor at full strength, at its dawn peak: 20% contrast at
 * about 100 m inside it. The rest of the day the banks are a third of this or less.
 */
export const FOG_BANK_DENSITY = 0.016
/** The dawn window (hours): the banks peak inside it and keep within NIGHT_SHARE outside it. */
export const FOG_DAWN = { peak: 6.5, spread: 0.7, from: 5.25, to: 7.75 }
/** The valleys' night fog and the coast's evening fog, as a share of the dawn peak. */
export const NIGHT_SHARE = 0.35
/** How much brighter than the haze a bank's mist is by day, beyond 1: dawn sun on the top of the fog. */
export const FOG_BANK_GLOW = 0.5
/** How much of the haze's own hue a bank's mist keeps (the rest is grey at its brightness). */
export const FOG_BANK_SATURATION = 0.3
/**
 * Lit mist (fog.ts, with Environment's sky light): the share of the light falling on a bank
 * that it sends back, the sun's floor (a low sun lights a bank's side as well as its top), and
 * how much of the light's hue it keeps. Tuned by frames of Archipelago's coast at dawn.
 */
export const FOG_BANK_ALBEDO = 0.55, FOG_BANK_SUN_FLOOR = 0.15, FOG_BANK_LIT_SATURATION = 0.6
/** The mist's slight warm lean (luminance about 1). */
export const FOG_BANK_WARM: [number, number, number] = [1.05, 1, 0.93]
/** Metres up and down the valley fog's top wanders, from the seed, so the top is uneven. */
export const VALLEY_TOP_ROUGHNESS = 5
/** Cells per side of the map. */
export const FOG_MAP_CELLS = 128

export interface FogMap {
  /** coast, valley, valley fog top (m above the sea), unused; per cell, row major (z rows). */
  data: Float32Array
  cells: number
  /** World tile side (m), centred on the origin; the map wraps with it. */
  size: number
  sea: number
}

export interface FogGround {
  size: number
  heightAt(x: number, z: number): number
  /** 'water', 'lava' or null for dry ground. */
  liquidAt(x: number, z: number): string | null
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/** Value noise on the wrapping grid, seeded: 0..1, period `n` cells. */
function seededNoise(cells: number, period: number, seed: number): Float32Array {
  const lattice = Math.max(1, Math.round(cells / period))
  let s = (Math.abs(Math.floor(seed)) * 2654435761 + 1) >>> 0
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  const g = new Float32Array(lattice * lattice).map(() => rand())
  const out = new Float32Array(cells * cells)
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const fx = x / cells * lattice, fz = z / cells * lattice
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz
    const at = (a: number, b: number) => g[((b % lattice) + lattice) % lattice * lattice + ((a % lattice) + lattice) % lattice]
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz)
    out[z * cells + x] = (at(ix, iz) * (1 - sx) + at(ix + 1, iz) * sx) * (1 - sz) + (at(ix, iz + 1) * (1 - sx) + at(ix + 1, iz + 1) * sx) * sz
  }
  return out
}

/** Two-pass chamfer distance (in cells, wrapping) from every cell to the nearest `source` cell. */
function distanceTo(source: Uint8Array, n: number): Float32Array {
  const d = new Float32Array(n * n).map((_, i) => source[i] ? 0 : 1e9)
  const at = (x: number, z: number) => ((z + n) % n) * n + ((x + n) % n)
  const D = Math.SQRT2
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const i = at(x, z)
      d[i] = Math.min(d[i], d[at(x - 1, z)] + 1, d[at(x, z - 1)] + 1, d[at(x - 1, z - 1)] + D, d[at(x + 1, z - 1)] + D)
    }
    for (let z = n - 1; z >= 0; z--) for (let x = n - 1; x >= 0; x--) {
      const i = at(x, z)
      d[i] = Math.min(d[i], d[at(x + 1, z)] + 1, d[at(x, z + 1)] + 1, d[at(x + 1, z + 1)] + D, d[at(x - 1, z + 1)] + D)
    }
  }
  return d
}

/** Box blur, wrapping, radius `r` cells, separable. */
function blur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), k = 2 * r + 1
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -r; i <= r; i++) s += src[z * n + ((x + i + n) % n)]; tmp[z * n + x] = s / k }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -r; i <= r; i++) s += tmp[((z + i + n) % n) * n + x]; out[z * n + x] = s / k }
  return out
}

/** Build a world's fog map from its ground and seed. */
/** Banks are cleared round each spawn pad: none within the first distance, full past the second (m). */
export const SPAWN_CLEAR = { from: 80, to: 220 }

/**
 * Build a world's fog map from its ground and seed. `clearings` are the spawn pads: no bank
 * lies on one, so a player never arrives inside fog, whatever the hour.
 */
export function buildFogMap(ground: FogGround, sea: number, seed: number, cells = FOG_MAP_CELLS, clearings: ReadonlyArray<{ x: number; z: number }> = []): FogMap {
  const n = cells, cell = ground.size / n
  const h = new Float32Array(n * n), water = new Uint8Array(n * n), land = new Uint8Array(n * n)
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const wx = -ground.size / 2 + (x + 0.5) * cell, wz = -ground.size / 2 + (z + 0.5) * cell
    const i = z * n + x, liquid = ground.liquidAt(wx, wz)
    h[i] = ground.heightAt(wx, wz) - sea
    water[i] = liquid === 'water' ? 1 : 0
    land[i] = liquid ? 0 : 1
  }
  const toWater = distanceTo(water, n), toLand = distanceTo(land, n)
  const around = blur(h, n, Math.max(1, Math.round(160 / cell)))
  const patch = seededNoise(n, 10, seed), patchFine = seededNoise(n, 4, seed + 17)
  const data = new Float32Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const px = -ground.size / 2 + ((i % n) + 0.5) * cell, pz = -ground.size / 2 + (Math.floor(i / n) + 0.5) * cell
    let nearest = Infinity
    for (const c of clearings) {
      // Wrapping distance: the tile repeats.
      const dx = Math.abs(px - c.x) % ground.size, dz = Math.abs(pz - c.z) % ground.size
      nearest = Math.min(nearest, Math.hypot(Math.min(dx, ground.size - dx), Math.min(dz, ground.size - dz)))
    }
    const clear = smooth(SPAWN_CLEAR.from, SPAWN_CLEAR.to, nearest)
    const broken = (0.45 + 0.75 * patch[i] * (0.7 + 0.3 * patchFine[i])) * clear
    // Coastal: thick over water within about 700 m of land, and up to about 250 m inland.
    const coast = water[i] ? Math.exp(-toLand[i] * cell / 700) : land[i] ? Math.exp(-toWater[i] * cell / 250) : 0
    // Valleys: ground lying below its surroundings by 4 to 35 m holds fog; none over liquid.
    const valley = land[i] ? smooth(4, 35, around[i] - h[i]) : 0
    data[i * 4] = Math.min(1, coast * broken)
    data[i * 4 + 1] = Math.min(1, valley * broken)
    // The valley fog's flat top: part way from the hollow's floor up to its surroundings,
    // blurred so neighbouring cells of one hollow share it.
    // The seeded fine noise breaks the top into an uneven, wispy surface.
    data[i * 4 + 2] = Math.max(0, h[i] + VALLEY_FILL * Math.max(0, around[i] - h[i]) + (patchFine[i] - 0.5) * 2 * VALLEY_TOP_ROUGHNESS)
  }
  return { data, cells: n, size: ground.size, sea }
}

/**
 * The texture the fog node reads: one per Environment, FOG_MAP_CELLS square, wrapping,
 * filtered, half float, empty (no fog) until a map is written into it. It is never replaced:
 * a TSL sample node keeps the texture it was built with, so a new world's map is copied into
 * this same texture (writeFogMap) rather than swapped in.
 */
export function createFogMapTexture(cells = FOG_MAP_CELLS): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(cells * cells * 4), cells, cells, THREE.RGBAFormat, THREE.HalfFloatType)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/** Copy a map into the fog node's texture (same cell count) and mark it for upload. */
export function writeFogMap(t: THREE.DataTexture, map: FogMap): void {
  const out = t.image.data as Uint16Array
  for (let i = 0; i < map.data.length && i < out.length; i++) out[i] = THREE.DataUtils.toHalfFloat(map.data[i])
  t.needsUpdate = true
}

/** The map's value (coast, valley, floor) at world (x, z), bilinear and wrapping, for the CPU. */
export function sampleFogMap(map: FogMap, x: number, z: number, out = { coast: 0, valley: 0, top: 0 }) {
  const n = map.cells, fx = (x / map.size + 0.5) * n - 0.5, fz = (z / map.size + 0.5) * n - 0.5
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz
  const at = (a: number, b: number, c: number) => map.data[(((b % n) + n) % n * n + ((a % n) + n) % n) * 4 + c]
  const lerp = (c: number) => (at(ix, iz, c) * (1 - tx) + at(ix + 1, iz, c) * tx) * (1 - tz) + (at(ix, iz + 1, c) * (1 - tx) + at(ix + 1, iz + 1, c) * tx) * tz
  out.coast = lerp(0); out.valley = lerp(1); out.top = lerp(2)
  return out
}

/**
 * How much of each kind of fog the hour shows, 0 to 1 of the dawn peak. Both peak briefly at
 * dawn (FOG_DAWN: about an hour of thick fog round 6.5 h), the show. Outside the dawn window
 * they keep within NIGHT_SHARE: the coast's fog returns that far in the evening, and the
 * valleys hold that much through the night, lifting by about 10 h. Midday is clear. `allDay`
 * keeps that share of the peak at any hour (a marsh).
 */
export function fogHourWeights(hour: number, allDay = 0): { coast: number; valley: number } {
  const h = ((hour % 24) + 24) % 24
  const bell = (centre: number, width: number) => { let d = Math.abs(h - centre); d = Math.min(d, 24 - d); return Math.exp(-(d * d) / (2 * width * width)) }
  const dawn = bell(FOG_DAWN.peak, FOG_DAWN.spread)
  const coast = Math.max(dawn, NIGHT_SHARE * bell(20.5, 1.5))
  // Night: from 21 h to 7.5 h, easing out by 10 h and in from 18.5 h.
  const night = h >= 21 || h <= 7.5 ? 1 : h < 10 ? 1 - smooth(7.5, 10, h) : h > 18.5 ? smooth(18.5, 21, h) : 0
  const valley = Math.max(dawn, NIGHT_SHARE * night)
  return { coast: allDay + (1 - allDay) * coast, valley: allDay + (1 - allDay) * valley }
}
