/**
 * Which post pipeline a frame gets. Pure, so tests can drive it.
 *
 *   off   plain renderer.render: post effects switched off, graphics level 0, or a phone or
 *         tablet (device class below desktop) that has not been opted in. Nothing allocated.
 *   base  colour look, vignette and grain only: one full-screen pass. Used when the frame
 *         governor's post budget has reached 0.
 *   lite  base plus sun shafts with half the taps. Graphics level 1.
 *   full  everything: glow, sun shafts, lens streak and ghosts, look, vignette, grain.
 *
 * Between full or lite and base, strengths fade with the governor's eased budget, so the
 * costly passes are faded out before they are removed and faded in after they return.
 * The frame governor in src/core/quality.ts is the only in-game quality authority; the
 * lobby's ladder is not fed from the game loop.
 */
export type PostTier = 'off' | 'base' | 'lite' | 'full'

export interface PostGateInput {
  on: boolean
  /** gfx.level now (the governor may lower it during a session). */
  level: number
  /** The level the device was classified as at load; 2 is desktop class. */
  deviceLevel: number
  /** The player chose to allow post effects on phones and tablets. */
  tablets: boolean
  /** 1 minus the governor's post budget: 0 keeps post effects, 1 has shed them. */
  shed: number
}

export function postTier(input: PostGateInput): PostTier {
  if (!input.on || !(input.level >= 1)) return 'off'
  if (input.deviceLevel < 2 && !input.tablets) return 'off'
  if (input.shed >= 1) return 'base'
  return input.level >= 2 ? 'full' : 'lite'
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
  const up = smooth(-0.03, 0.04, sunY)
  const low = 1 - smooth(0.08, 0.55, sunY)
  return up * (1 + lowSun * low)
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
