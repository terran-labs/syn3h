/**
 * Pure sky maths: sun position from time of day, and a CPU copy of the Preetham sky model
 * used by AlienSkyMesh. No renderer imports, so it runs in tests and on the server.
 *
 * The CPU evaluation exists so the sunlight, the hemisphere ambient and the fog can be
 * coloured by exactly the same scattering terms the sky shader draws. Both sides import the
 * constants below, which keeps them from drifting apart.
 */

export type RGB = [number, number, number]
export type Vec3 = [number, number, number]

/** Earth's Rayleigh coefficients for Preetham's primaries (680, 550, 450 nm), in 1e-6 per metre. */
export const EARTH_RAYLEIGH: RGB = [5.804542996261093, 13.562911419845635, 30.265902468824876]
/** Mie constant per primary: pi * (2 pi / lambda)^(v - 2) * K, with v = 4. */
export const MIE_CONST: RGB = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14]
export const RAYLEIGH_ZENITH_LENGTH = 8.4e3
export const MIE_ZENITH_LENGTH = 1.25e3
/** The "earth shadow hack": the sun stops lighting the sky a little below the horizon. */
export const CUTOFF_ANGLE = 1.6110731556870734
export const STEEPNESS = 1.5
export const SUN_E_MAX = 1000
/** Preetham's output is scaled by this before tone mapping, as in Three's SkyMesh. */
export const SKY_SCALE = 0.04
/** A faint blue floor so the sky is never pure black. */
export const SKY_FLOOR: RGB = [0, 0.0003, 0.00075]
const THREE_OVER_SIXTEENPI = 0.05968310365946075
const ONE_OVER_FOURPI = 0.07957747154594767
/** Guards the ratio betaTheta / beta when a user zeroes every scattering channel. */
export const BETA_EPSILON = 1e-12

export interface SkyParams {
  /** Rayleigh scattering per colour channel, 1e-6 per metre. Earth is EARTH_RAYLEIGH. */
  rayleighColor: RGB
  /** Overall Rayleigh multiplier. */
  rayleigh: number
  turbidity: number
  mieCoefficient: number
  mieDirectionalG: number
  /** Brightness of the moonlit night sky, 0 for black. */
  nightBrightness: number
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

const DEG = Math.PI / 180

/**
 * Unit vector from the ground toward the sun. Y is up, -Z is north, +X is east.
 *
 * An observer at latitude `tiltDeg` on a planet with no axial tilt: the sun rises due east
 * at 6, peaks at 90 - tilt degrees at 12 and is straight below the observer's horizon at 0.
 * `azimuthDeg` turns the whole path about Y, so a level designer can put sunset behind a
 * volcano without changing the hour.
 */
export function sunDirection(hour: number, tiltDeg: number, azimuthDeg = 0, out: Vec3 = [0, 0, 0]): Vec3 {
  const h = ((hour - 12) / 24) * Math.PI * 2
  const lat = tiltDeg * DEG
  const up = Math.cos(lat) * Math.cos(h)
  const east = -Math.sin(h)
  const north = -Math.sin(lat) * Math.cos(h)
  // Local frame: east = +X, north = -Z. Then rotate about Y by the azimuth.
  const x0 = east
  const z0 = -north
  const a = azimuthDeg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  out[0] = x0 * c + z0 * s
  out[1] = up
  out[2] = -x0 * s + z0 * c
  return out
}

/** Advance an hour by `dt` real seconds when a full day lasts `dayLength` seconds (0 pauses). */
export function advanceHour(hour: number, dt: number, dayLength: number): number {
  if (!(dayLength > 0) || !Number.isFinite(dt)) return wrapHour(hour)
  return wrapHour(hour + (dt * 24) / dayLength)
}

export function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return 12
  const h = hour % 24
  return h < 0 ? h + 24 : h
}

/** Preetham's sun intensity, including the earth shadow cutoff just below the horizon. */
export function sunE(sunY: number): number {
  const zenithAngle = Math.acos(clamp(sunY, -1, 1))
  return SUN_E_MAX * Math.max(0, 1 - Math.exp(-(CUTOFF_ANGLE - zenithAngle) / STEEPNESS))
}
const SUN_E_NOON = sunE(1)

/** 0 by day, 1 in full night. Twilight runs from the horizon to about 11 degrees below. */
export function nightAmount(sunY: number): number {
  return 1 - smoothstep(-0.2, 0.0, sunY)
}

export function betaR(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, p.rayleighColor[i]) * 1e-6 * Math.max(0, p.rayleigh)
  return out
}

export function betaM(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  const c = 0.2 * p.turbidity * 10e-18
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, 0.434 * c * MIE_CONST[i] * p.mieCoefficient)
  return out
}

/** Optical air mass toward a direction (Preetham's approximation), clamped at the horizon. */
export function opticalInverse(dirY: number): number {
  const zenithAngle = Math.acos(clamp(dirY, 0, 1))
  return 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - zenithAngle / DEG, -1.253))
}

/**
 * Night sky tint: moonlight scattered by the same atmosphere, so it takes the colour of the
 * scattering coefficients. Normalised so the brightest channel is 1.
 */
export function nightTint(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  const r = p.rayleighColor
  const m = Math.max(r[0], r[1], r[2], BETA_EPSILON)
  for (let i = 0; i < 3; i++) out[i] = 0.25 + 0.75 * Math.max(0, r[i]) / m
  return out
}
/** Night sky radiance at the zenith when nightBrightness is 1. */
export const NIGHT_LEVEL = 0.02

/** Twilight glow at the horizon when nothing else lights the sky. */
export const TWILIGHT_LEVEL = 0.25

/**
 * How much twilight glow to add. Preetham's sky goes dark about two degrees after sunset;
 * real twilight lasts until the sun is roughly twelve degrees down. Peaks just as the
 * Preetham glow fades so the two hand over smoothly.
 */
export function twilightAmount(sunY: number): number {
  return smoothstep(-0.2, -0.03, sunY) * (1 - smoothstep(-0.03, 0.06, sunY))
}

/** Shape of the twilight glow: hugs the horizon, strongest toward the sun. Shared with the shader. */
export function twilightShape(dir: Vec3, sun: Vec3): number {
  const c = (dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]) * 0.5 + 0.5
  return c * c * c * Math.exp(-Math.max(dir[1], 0) * 6)
}

/** Twilight colour: the horizon below a just-risen sun, normalised so the brightest channel is 1. */
export function twilightTint(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  skyRadianceBase([0.9995, 0.03, 0], [0.99875, 0.05, 0], p, out)
  const m = Math.max(out[0], out[1], out[2], BETA_EPSILON)
  for (let i = 0; i < 3; i++) out[i] = Number.isFinite(out[i]) ? out[i] / m : 0
  return out
}

/** Preetham single scattering only, no night or twilight. */
export function skyRadianceBase(dir: Vec3, sun: Vec3, p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  const bR = betaR(p, _bR)
  const bM = betaM(p, _bM)
  const E = sunE(sun[1])
  const inv = opticalInverse(dir[1])
  const sR = RAYLEIGH_ZENITH_LENGTH * inv
  const sM = MIE_ZENITH_LENGTH * inv
  const cosTheta = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]
  const c = cosTheta * 0.5 + 0.5
  const rPhase = THREE_OVER_SIXTEENPI * (1 + c * c)
  const g = clamp(p.mieDirectionalG, 0, 0.9999)
  const g2 = g * g
  const mPhase = ONE_OVER_FOURPI * (1 - g2) / Math.pow(Math.max(1e-6, 1 - 2 * g * cosTheta + g2), 1.5)
  const horizonBlend = clamp(Math.pow(Math.max(0, 1 - sun[1]), 5), 0, 1)
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(bR[i] * sR + bM[i] * sM))
    const ratio = (bR[i] * rPhase + bM[i] * mPhase) / Math.max(bR[i] + bM[i], BETA_EPSILON)
    let lin = Math.pow(E * ratio * (1 - fex), 1.5)
    lin *= 1 + (Math.sqrt(E * ratio * fex) - 1) * horizonBlend
    const l0 = 0.1 * fex
    out[i] = (lin + l0) * SKY_SCALE + SKY_FLOOR[i]
  }
  return out
}

/**
 * Sky radiance (linear, before tone mapping) toward `dir`, without the sun disc, stars or
 * clouds. Mirrors AlienSkyMesh's colour node.
 */
export function skyRadiance(dir: Vec3, sun: Vec3, p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  skyRadianceBase(dir, sun, p, out)
  const night = nightAmount(sun[1]) * Math.max(0, p.nightBrightness) * NIGHT_LEVEL
  const tint = nightTint(p, _tint)
  // Brighter toward the horizon, as a moonlit sky is.
  const nightShape = 0.6 + 0.4 * (1 - clamp(dir[1], 0, 1))
  const tw = twilightAmount(sun[1]) * TWILIGHT_LEVEL * twilightShape(dir, sun)
  const twTint = tw > 0 ? twilightTint(p, _twTint) : _twTint
  for (let i = 0; i < 3; i++) out[i] += night * tint[i] * nightShape + tw * twTint[i]
  return out
}
const _twTint: RGB = [0, 0, 0]
const _bR: RGB = [0, 0, 0]
const _bM: RGB = [0, 0, 0]
const _tint: RGB = [0, 0, 0]

/**
 * Colour of direct sunlight at the ground: the atmosphere's transmittance along the sun ray
 * times Preetham's intensity falloff, normalised so a zenith sun in a clear sky is about 1.
 * Reaches 0 shortly after the sun sets.
 */
export function sunlightColor(sun: Vec3, p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  const bR = betaR(p, _bR)
  const bM = betaM(p, _bM)
  const inv = opticalInverse(sun[1])
  const sR = RAYLEIGH_ZENITH_LENGTH * inv
  const sM = MIE_ZENITH_LENGTH * inv
  const fade = sunE(sun[1]) / SUN_E_NOON
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-(bR[i] * sR + bM[i] * sM)) * fade
  return out
}

/** Weight of moonlight, 0 by day. Starts once the sun has stopped lighting the sky. */
export function moonAmount(sunY: number): number {
  return smoothstep(-0.04, -0.2, sunY)
}

export interface HorizonColors {
  /** Horizon below the sun. */
  toward: RGB
  /** Horizon opposite the sun. */
  away: RGB
  /** Horizon at right angles to the sun. */
  side: RGB
  /** Average of the four compass points, for systems that want one colour. */
  mean: RGB
  zenith: RGB
}

/** Elevation of the sample just above the horizon, where Preetham's formula is well behaved. */
const HORIZON_Y = 0.03

/** Sample the sky at the horizon and zenith. The fog node interpolates between these. */
export function horizonColors(sun: Vec3, p: SkyParams, out?: HorizonColors): HorizonColors {
  const o = out ?? { toward: [0, 0, 0], away: [0, 0, 0], side: [0, 0, 0], mean: [0, 0, 0], zenith: [0, 0, 0] }
  let hx = sun[0]
  let hz = sun[2]
  const len = Math.hypot(hx, hz)
  if (len < 1e-6) { hx = 1; hz = 0 } else { hx /= len; hz /= len }
  const k = Math.sqrt(1 - HORIZON_Y * HORIZON_Y)
  skyRadiance([hx * k, HORIZON_Y, hz * k], sun, p, o.toward)
  skyRadiance([-hx * k, HORIZON_Y, -hz * k], sun, p, o.away)
  skyRadiance([-hz * k, HORIZON_Y, hx * k], sun, p, o.side)
  skyRadiance([0, 1, 0], sun, p, o.zenith)
  for (let i = 0; i < 3; i++) o.mean[i] = (o.toward[i] + o.away[i] + 2 * o.side[i]) / 4
  return o
}

/** Rec. 709 luminance of a linear colour. */
export function luminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Sky luminance at which auto exposure leaves the exposure slider unchanged: a clear noon. */
export const EXPOSURE_REFERENCE = 4

/**
 * Exposure multiplier that mimics eye adaptation: partial, so night still looks darker than
 * day. `strength` 0 turns it off.
 */
export function autoExposure(skyLuminance: number, strength: number): number {
  if (!(strength > 0) || !(skyLuminance > 0)) return 1
  const k = Math.pow(EXPOSURE_REFERENCE / skyLuminance, 0.45 * strength)
  return clamp(k, 0.25, 10)
}

/** Replace non finite channels with 0 and clamp to [0, max]. Keeps GPU uniforms sane. */
export function sanitizeRGB(c: RGB, max = 1e3): RGB {
  for (let i = 0; i < 3; i++) c[i] = Number.isFinite(c[i]) ? clamp(c[i], 0, max) : 0
  return c
}
