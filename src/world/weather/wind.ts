/**
 * The wind field: a pure function of the world seed, the shared room clock and a position.
 *
 * Every client computes the same wind from numbers it already shares (world sliders, the
 * seed, the clock), so wind costs no network traffic. Nothing here keeps state between calls
 * except the clock hook and a small cache of the summit height per terrain.
 *
 * Shape of the field:
 *  - A prevailing direction from the seed that drifts slowly (a few minutes per swing), plus
 *    the direction slider.
 *  - Gusts from smooth noise in time. Each place sees them a few seconds earlier or later,
 *    from an offset that is periodic in the world tile, so gusts sweep across the island.
 *  - Strength rising with height above sea level: nearly calm at the shore, the reference
 *    speed at the summit rim, a little more above it for anything flying.
 *  - Every spatial term has the tile as its period, so the field is continuous across the
 *    wrap seam of the round planet.
 *
 * Horizontal only: y is always 0.
 */
import { worldLavaAltitude, worldSeed } from '../../../shared/params'
import type { Terrain } from '../Terrain'
import { STORMINESS_REFERENCE, atmosphereValue, gustiness, storminess, windDirection, windSpeed } from './params'

/** Everything the field depends on, as plain numbers. */
export interface WindFrame {
  seed: number
  /** Side of the wrapping tile in metres. */
  wrap: number
  /** Sea or lava level in metres. */
  sea: number
  /** Height of the summit rim in metres: where the reference speed is reached. */
  top: number
  storminess: number
  /** m/s at the summit at the reference storminess. */
  speed: number
  gustiness: number
  /** Degrees added to the prevailing direction. */
  direction: number
  atmosphere: number
}

export interface Vec3Like { x: number; y: number; z: number }

/** Share of the summit wind left at sea level. */
export const SEA_LEVEL_SHARE = 0.1
/** Above the rim the wind keeps growing up to this many times the summit value. */
export const ALTITUDE_CAP = 1.4
/** Exponent of the height profile: above 1 keeps the lower slopes and roads calm. */
export const HEIGHT_EXPONENT = 1.4
/** Wind speed, m/s, that counts as full strength for `windStrength01` (a strong gale). */
export const FULL_STRENGTH = 30

// ---------------------------------------------------------------------------------------
// Shared clock
// ---------------------------------------------------------------------------------------

/**
 * Seconds on the shared room clock. The room server's clock is wall time (Date.now on the
 * server), so wall time is already a close guess; the networking layer installs the synced
 * clock with `setWeatherClock(() => clock.now())`.
 */
let clock: () => number = () => Date.now() / 1000

export function setWeatherClock(now: () => number): void {
  clock = now
}

export function weatherTime(): number {
  return clock()
}

// ---------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------

function hash(n: number, seed: number): number {
  // n can be about 2e9 (wall clock seconds): fold it into 32 bits before mixing.
  const lo = n - Math.floor(n / 4294967296) * 4294967296
  let h = Math.imul((lo >>> 0) ^ Math.imul(seed | 0, 0x27d4eb2d), 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1
}

/** Smooth 1D value noise in [-1, 1], one lattice point per unit. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = hash(i, seed)
  return a + (hash(i + 1, seed) - a) * u
}

/** The seed's own fixed numbers, so a frame costs no hashing per call beyond the noise. */
function seedAngle(seed: number, k: number): number {
  return (hash(k, seed) + 1) * Math.PI
}

const TAU = Math.PI * 2

/**
 * Gust shape in [-1, 1] at time t: three octaves, slowest first. Periods of 13, 5 and 2
 * seconds give swells a player can feel and hear arrive and pass.
 */
function gustNoise(t: number, seed: number): number {
  return (noise1(t / 13, seed + 101) * 0.6 + noise1(t / 5, seed + 202) * 0.3 + noise1(t / 2, seed + 303) * 0.1) / 0.8
}

// ---------------------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------------------

/** Effective summit speed and gustiness for a frame, in m/s and 0..1+. */
function strength(f: WindFrame): { mean: number; gust: number } {
  const air = Math.max(0, f.atmosphere)
  const mean = air > 0 ? f.speed * (f.storminess / STORMINESS_REFERENCE) * Math.min(1, air * 4) : 0
  return { mean, gust: f.gustiness * (0.6 + 0.8 * f.storminess) }
}

/** Share of the summit wind at height y: SEA_LEVEL_SHARE at sea level, 1 at the rim. */
export function heightShare(f: WindFrame, y: number): number {
  const span = Math.max(20, f.top - f.sea)
  const h = Math.min(ALTITUDE_CAP ** (1 / HEIGHT_EXPONENT), Math.max(0, (y - f.sea) / span))
  return SEA_LEVEL_SHARE + (1 - SEA_LEVEL_SHARE) * h ** HEIGHT_EXPONENT
}

/**
 * Seconds by which a place leads or lags the island's gusts, periodic in the tile so the
 * field is continuous across the seam. About plus or minus 8 s.
 */
function gustLag(f: WindFrame, x: number, z: number): number {
  const kx = TAU * x / f.wrap
  const kz = TAU * z / f.wrap
  return 4 * (Math.sin(kx + seedAngle(f.seed, 1)) + Math.sin(kz + seedAngle(f.seed, 2)))
}

/** Gust envelope in [0, 1] at a place and time: 0 a lull, 0.5 the mean, 1 the strongest gust. */
export function gustEnvelope(f: WindFrame, x: number, z: number, t: number): number {
  return Math.min(1, Math.max(0, 0.5 + 0.5 * gustNoise(t - gustLag(f, x, z), f.seed)))
}

/** Prevailing direction in radians (0 blows toward +x) at time t. */
export function windHeading(f: WindFrame, t: number, gust = 0): number {
  return seedAngle(f.seed, 3) + f.direction * Math.PI / 180
    + 0.9 * noise1(t / 240, f.seed + 404) + 0.25 * gust * noise1(t / 7, f.seed + 505)
}

/**
 * Wind velocity in m/s at a world position and shared time, written into `out`. Horizontal.
 */
export function windAt<T extends Vec3Like>(f: WindFrame, x: number, y: number, z: number, t: number, out: T): T {
  const { mean, gust } = strength(f)
  out.y = 0
  if (mean <= 0 || f.wrap <= 0) { out.x = 0; out.z = 0; return out }
  const n = gustNoise(t - gustLag(f, x, z), f.seed)
  // Skewed: gusts rise further above the mean than lulls fall below it, as real wind does.
  const g = Math.max(0.15, 1 + gust * (n > 0 ? 1.3 * n : 0.7 * n))
  // A gentle, tile-periodic pattern of sheltered and exposed ground.
  const kx = TAU * x / f.wrap
  const kz = TAU * z / f.wrap
  const patch = 1 + 0.15 * Math.sin(kx + seedAngle(f.seed, 4)) * Math.sin(kz + seedAngle(f.seed, 5))
  const speed = mean * heightShare(f, y) * g * patch
  const a = windHeading(f, t, gust)
  out.x = Math.cos(a) * speed
  out.z = Math.sin(a) * speed
  return out
}

/** Wind speed at a place as 0..1 of a strong gale, for the score and other mixers. */
export function windStrength01(f: WindFrame, x: number, y: number, z: number, t: number): number {
  const v = windAt(f, x, y, z, t, scratch)
  return Math.min(1, Math.hypot(v.x, v.z) / FULL_STRENGTH)
}
const scratch = { x: 0, y: 0, z: 0 }

// ---------------------------------------------------------------------------------------
// Frame from the live world
// ---------------------------------------------------------------------------------------

const summitCache = new WeakMap<object, { key: string; top: number }>()
const DEFAULT_TOP = 300

/** The rim height of a terrain's summit, cached per terrain generation. */
function summitTop(terrain: Partial<Terrain> | null | undefined): number {
  if (!terrain?.summit) return DEFAULT_TOP
  const key = `${(terrain as { version?: number }).version ?? 0}:${worldSeed.value}`
  const hit = summitCache.get(terrain)
  if (hit && hit.key === key) return hit.top
  const top = terrain.summit()?.rimHeight ?? DEFAULT_TOP
  summitCache.set(terrain, { key, top })
  return top
}

/**
 * The frame for the current world, from shared sliders and the terrain. Pass `out` to reuse
 * one object per step.
 */
export function currentWindFrame(terrain?: Partial<Terrain> | null, out: WindFrame = {} as WindFrame): WindFrame {
  out.seed = worldSeed.value | 0
  out.wrap = terrain?.wrapSize ?? terrain?.size ?? 2000
  out.sea = worldLavaAltitude.value
  out.top = summitTop(terrain)
  out.storminess = storminess.value
  out.speed = windSpeed.value
  out.gustiness = gustiness.value
  out.direction = windDirection.value
  out.atmosphere = atmosphereValue()
  return out
}

/** Parameter ids the wind reads, for other lanes (audio, score) that mirror it. */
export const WIND_PARAM_IDS = {
  storminess: storminess.def.id,
  speed: windSpeed.def.id,
  gustiness: gustiness.def.id,
  direction: windDirection.def.id,
  atmosphere: 'world.atmosphere',
} as const


// ---------------------------------------------------------------------------------------
// Drift for effects
// ---------------------------------------------------------------------------------------

let driftTerrain: Partial<Terrain> | null = null
const driftFrame = {} as WindFrame
let driftFrameAt = -Infinity

/** The terrain `windDrift` reads the summit height from. The WeatherSystem sets it. */
export function setWindTerrain(terrain: Partial<Terrain> | null): void {
  driftTerrain = terrain
  driftFrameAt = -Infinity
}

/**
 * Wind velocity in m/s at a world position now, for particles, smoke and plumes: add it to
 * their velocity (or a share of it) and they lean and travel downwind with the gusts players
 * feel. Horizontal; y is 0. Cheap enough for every live particle: the sliders are read at
 * most every 50 ms and the rest is a few sines and noise lookups.
 */
export function windDrift<T extends Vec3Like>(x: number, y: number, z: number, out: T): T {
  const t = weatherTime()
  if (Math.abs(t - driftFrameAt) > 0.05) { currentWindFrame(driftTerrain, driftFrame); driftFrameAt = t }
  return windAt(driftFrame, x, y, z, t, out)
}
