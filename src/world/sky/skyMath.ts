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

/**
 * Twilight colour, normalised so the brightest channel is 1. Mostly warm, then the colour the
 * air scatters (violet under a violet sky), with a little of the horizon below a just-risen
 * sun. That horizon alone takes the colour the air passes, not scatters: a green twilight
 * ringing the whole horizon of a violet world.
 */
export function twilightTint(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  skyRadianceBase([0.9995, 0.03, 0], [0.99875, 0.05, 0], p, out)
  const scatter = nightTint(p, _scatter)
  const rawLum = Math.max(luminance(out), BETA_EPSILON), scatterLum = Math.max(luminance(scatter), BETA_EPSILON)
  for (let i = 0; i < 3; i++) {
    const raw = Number.isFinite(out[i]) ? out[i] / rawLum : 0
    out[i] = TWILIGHT_MIX[0] * TWILIGHT_WARM[i] + TWILIGHT_MIX[1] * scatter[i] / scatterLum + TWILIGHT_MIX[2] * raw
  }
  const m = Math.max(out[0], out[1], out[2], BETA_EPSILON)
  for (let i = 0; i < 3; i++) out[i] /= m
  return out
}
/** Twilight's share of warm orange, the air's scattering colour and the raw horizon. */
const TWILIGHT_WARM: RGB = [1.62, 0.89, 0.49]
const TWILIGHT_MIX = [0.5, 0.3, 0.2]
const _scatter: RGB = [0, 0, 0]

// ---------------------------------------------------------------------------------------
// Low sun grade
// ---------------------------------------------------------------------------------------
// Preetham's horizon toward a low sun is hundreds of times brighter than the sky overhead,
// and on an alien atmosphere it takes the colour the air does not scatter: green under a
// violet sky, blue under a butterscotch one. Eye adaptation follows the darker sky, so that
// glow became a white wall with a single-hue band where the fog met it, and the sunlight it
// passed coloured every surface the same hue. With days of a few minutes it is on screen
// every few minutes. The grade gives it a shoulder and warms its brightest part, and leaves
// direct sunlight its brightness but most of its colour warm. It fades out as the sun climbs,
// so the day sky is unchanged. AlienSkyMesh applies the same grade, so sky and fog agree.

/**
 * Sky luminance (linear) above which the low-sun glow is compressed, and the power it is
 * compressed by with the sun on the horizon. A power keeps the glow's falloff, so the sun is
 * a bright core fading out over about fifteen degrees, the shape an Earth sky already has,
 * rather than a flat plateau of white.
 */
export const GLOW_KNEE = 1.5, GLOW_POWER = 0.55
/** Warm white, luminance 1: what the brightest glow and low sunlight lean toward. */
export const GLOW_WARM: RGB = [1.229, 0.958, 0.737]
/** How far the brightest glow leans to GLOW_WARM; dim sky keeps its own colour. */
export const GLOW_DESAT = 0.8
/** How far direct sunlight leans to GLOW_WARM at a low sun. */
export const SUN_DESAT = 0.9
/** 1 with the sun at or below the horizon, 0 from about 27 degrees up. */
export function lowSunGrade(sunY: number): number {
  return 1 - smoothstep(0.02, 0.45, sunY)
}
/** How far a strongly single-hue part of the low-sun sky leans to the glow tint. */
export const SAT_LEAN = 0.85
/**
 * The colour a low sun's glow leans toward, luminance 1: mostly warm orange, then the colour
 * the air scatters, so a violet world's sunrise is rose and a butterscotch one's amber.
 */
export function glowTint(p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  const scatter = nightTint(p, _scatter)
  const sl = Math.max(luminance(scatter), BETA_EPSILON)
  for (let i = 0; i < 3; i++) out[i] = 0.6 * TWILIGHT_WARM[i] + 0.4 * scatter[i] / sl
  const l = Math.max(luminance(out), BETA_EPSILON)
  for (let i = 0; i < 3; i++) out[i] /= l
  return out
}
/**
 * 0 for a warm colour (red its strongest channel), rising to 1 as green or blue outweighs red
 * by a quarter. A low sun's own warm colours are left alone; only the cold transmitted hues
 * (green under a violet sky, blue under a butterscotch one) are leaned.
 */
export function coolness(c: RGB): number {
  const hi = Math.max(c[0], c[1], c[2])
  return hi > 0 ? smoothstep(0, 0.25, (Math.max(c[1], c[2]) - c[0]) / hi) : 0
}
/** Apply the grade to a sky radiance in place. `w` from lowSunGrade; `tint` from glowTint. */
export function gradeGlow(c: RGB, w: number, tint: RGB = GLOW_WARM): RGB {
  if (!(w > 0)) return c
  const L = luminance(c)
  if (!(L > 1e-9) || !Number.isFinite(L)) return c
  const above = Math.max(1, L / GLOW_KNEE)
  const graded = GLOW_KNEE * Math.min(1, L / GLOW_KNEE) * Math.pow(above, 1 - w * (1 - GLOW_POWER))
  const hi = Math.max(c[0], c[1], c[2]), lo = Math.min(c[0], c[1], c[2])
  const sat = hi > 0 ? (hi - lo) / hi : 0
  const lean = Math.min(1, 1.5 * w) * Math.max(GLOW_DESAT * smoothstep(GLOW_KNEE, 6 * GLOW_KNEE, L), SAT_LEAN * smoothstep(0.15, 0.6, sat) * coolness(c))
  for (let i = 0; i < 3; i++) c[i] = ((c[i] / L) * (1 - lean) + tint[i] * lean) * graded
  return c
}

/** Preetham single scattering only, no night or twilight, with the low sun grade. */
export function skyRadianceBase(dir: Vec3, sun: Vec3, p: SkyParams, out: RGB = [0, 0, 0]): RGB {
  return scatterGraded(dir, sun, p, 1, out)
}

/**
 * The low sun's forward glow is the sky's Mie lobe above its value this many degrees from
 * the sun. Most of a lobe with g near 0.8 lies inside it.
 */
export const GLOW_CAP_DEG = 45
export const GLOW_CAP_COS = Math.cos(GLOW_CAP_DEG * DEG)
/** Sun heights (sine of elevation) over which the forward glow fades out as the sun climbs. */
export const GLOW_SHARE_FROM = 0.1, GLOW_SHARE_TO = 0.45
/** 1 for a sun on the horizon, 0 once it is up about 27 degrees or set. */
export function lowSunGlowShare(sunY: number): number {
  return rayGlowShare(sunY, 0)
}
/**
 * The share of the forward glow the sun rays carry (src/fx/post/PostChain.ts): 1 for a sun
 * on the horizon, easing to `high` once it is up about 27 degrees, 0 once it has set. With
 * `high` 0 this is lowSunGlowShare, the sunrise-only rays of v26.11.1611.
 */
export function rayGlowShare(sunY: number, high: number): number {
  const low = 1 - smoothstep(GLOW_SHARE_FROM, GLOW_SHARE_TO, sunY)
  return (high + (1 - high) * low) * smoothstep(-0.03, 0.02, sunY)
}

/**
 * The part of the graded sky toward `dir` that the Mie forward lobe adds near a low sun:
 * the sky minus the same sky with the Mie phase held at its GLOW_CAP_DEG value. The sun
 * shafts draw this light through the gaps between occluders instead of the sky shader
 * drawing it everywhere (AlienSkyMesh.skyScatter is the shader copy). Non-negative; 0 beyond
 * the cap angle and for a set sun. `share` defaults to the low sun's (0 for a high sun); the
 * rays pass rayGlowShare, which keeps some of the glow at any height.
 */
export function forwardGlow(dir: Vec3, sun: Vec3, p: SkyParams, out: RGB = [0, 0, 0], share = lowSunGlowShare(sun[1])): RGB {
  const cosTheta = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]
  out[0] = out[1] = out[2] = 0
  if (!(cosTheta > GLOW_CAP_COS) || !(share > 0)) return out
  scatterGraded(dir, sun, p, 1, out)
  const capped = scatterGraded(dir, sun, p, GLOW_CAP_COS, _capped)
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, out[i] - capped[i]) * share
  return out
}
const _capped: RGB = [0, 0, 0]

/** Preetham with the low sun grade; the Mie phase is read at min(cos theta, mieCapCos). */
function scatterGraded(dir: Vec3, sun: Vec3, p: SkyParams, mieCapCos: number, out: RGB): RGB {
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
  const mPhase = ONE_OVER_FOURPI * (1 - g2) / Math.pow(Math.max(1e-6, 1 - 2 * g * Math.min(cosTheta, mieCapCos) + g2), 1.5)
  const horizonBlend = clamp(Math.pow(Math.max(0, 1 - sun[1]), 5), 0, 1)
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(bR[i] * sR + bM[i] * sM))
    const ratio = (bR[i] * rPhase + bM[i] * mPhase) / Math.max(bR[i] + bM[i], BETA_EPSILON)
    let lin = Math.pow(E * ratio * (1 - fex), 1.5)
    lin *= 1 + (Math.sqrt(E * ratio * fex) - 1) * horizonBlend
    const l0 = 0.1 * fex
    out[i] = (lin + l0) * SKY_SCALE + SKY_FLOOR[i]
  }
  return gradeGlow(out, lowSunGrade(sun[1]), glowTint(p, _glow))
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
const _glow: RGB = [0, 0, 0]
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
  // Low sun: keep the light's brightness, give most of its colour to the planet's glow tint.
  const w = lowSunGrade(sun[1]) * SUN_DESAT * coolness(out), L = luminance(out)
  if (w > 0 && L > 1e-9) {
    const tint = glowTint(p, _glow)
    for (let i = 0; i < 3; i++) out[i] = out[i] * (1 - w) + tint[i] * L * w
  }
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
