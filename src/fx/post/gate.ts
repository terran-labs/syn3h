/**
 * Which post pipeline a frame gets. Pure, so tests can drive it.
 *
 *   off   plain renderer.render: post effects switched off, or a quality level without
 *         them. Nothing allocated.
 *   base  colour look, vignette and grain only: one full-screen pass. The level that asks
 *         for it, and where every level lands when the governor's post budget reaches 0.
 *   lite  the look plus whichever effects have a strength above 0, sun shafts at half taps.
 *   full  the same with full shaft taps.
 *
 * The quality level (src/core/quality.ts) decides the tier and, through each effect's
 * strength, which effects exist: a strength of 0 removes that effect from the pipeline. The
 * chain does not second-guess it by device class. Inside a level the governor's eased
 * budget only fades strengths; it creates no pipeline until it reaches 0 and the chain
 * falls to base.
 */
export type PostTier = 'off' | 'base' | 'lite' | 'full'

export interface PostGateInput {
  on: boolean
  /** The tier the current quality level allows (quality.postTier). */
  tier: PostTier
  /** 1 minus the governor's post budget: 0 keeps post effects, 1 has shed them. */
  shed: number
}

export function postTier(input: PostGateInput): PostTier {
  if (!input.on || input.tier === 'off') return 'off'
  if (input.tier === 'base' || input.shed >= 1) return 'base'
  return input.tier === 'lite' ? 'lite' : 'full'
}

/** Whether a tier draws effects at all, beyond the colour look. */
export function drawsEffects(tier: PostTier): boolean {
  return tier === 'lite' || tier === 'full'
}

/** Sun shaft march taps per tier. Quarter resolution, so even 32 is cheap. */
export function shaftTaps(tier: PostTier): number {
  return tier === 'full' ? 32 : tier === 'lite' ? 16 : 0
}

/**
 * How visible the sun is for shafts and flare, 0 to 1, from where it lands on screen.
 * `uv` is the sun's position in 0..1 screen space and `inFront` whether it is in front of
 * the camera. Shafts still fan in from a sun just off screen, so the fade runs past the edge.
 */
export function sunScreenFade(u: number, v: number, inFront: boolean): number {
  if (!inFront) return 0
  const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5))
  return 1 - smooth(0.5, 1.1, edge)
}

/**
 * Sun height factor: 0 below the horizon, rising to 1 just above it, then boosted at low
 * sun by `lowSun` (0 none) so golden hour gets the strongest rays.
 */
export function sunHeightFactor(sunY: number, lowSun: number): number {
  return smooth(-0.03, 0.04, sunY) * (1 + lowSun * lowSunAmount(sunY))
}

/** 1 for a sun near the horizon, 0 once it is high (sin of elevation above about 0.55). */
export function lowSunAmount(sunY: number): number {
  return 1 - smooth(0.08, 0.55, sunY)
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
