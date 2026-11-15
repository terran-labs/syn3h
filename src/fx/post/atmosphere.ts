/**
 * Aerial perspective and height fog, applied to the rendered frame from its depth buffer.
 *
 * The materials' own distance fog fades everything toward one horizon colour at one rate.
 * This adds what makes outdoor air read as deep, after Unreal's exponential height fog and
 * Hillaire's aerial perspective (2020), simplified to closed forms:
 *
 *   - Density falls off exponentially with height, so valleys and the sea hold haze and the
 *     volcano's flanks rise out of it. The optical depth along a view ray has a closed form
 *     (the integral of a e^{-b y} along the ray), so there is no ray march.
 *   - Extinction is per colour channel, in the planet's own Rayleigh scattering ratios
 *     (sky.rayleighR/G/B), so distant ridges shift toward the sky's hue and separate into
 *     layers: blue on an Earth-like sky, rust under the volcanic one.
 *   - In-scattered light is the horizon colour plus a forward lobe of sunlight around the
 *     sun (a Henyey-Greenstein-like phase), so a low sun fills the air between you and it.
 *
 * Open sky (depth at the far plane) is left alone: the sky shader already is the atmosphere.
 * All values are linear radiance, ahead of tone mapping, like the scene itself.
 */
import { Fn, clamp, dot, exp, float, getViewPosition, max, mix, normalize, pow, select, smoothstep, step, vec3, vec4 } from 'three/tsl'

type N = any // TSL node

export interface HazeUniforms {
  /** Inverse of the scene camera's projection matrix. */
  projInv: N
  /** The scene camera's world matrix (camera to world). */
  camWorld: N
  /** Camera position in world space (y is its height). */
  camPos: N
  /** Unit vector toward the sun, world space. */
  sunDir: N
  /** Linear sun colour times intensity, and the horizon sky colour (linear). */
  sunColor: N
  horizon: N
  /** Per-channel extinction weights (sum normalised to 3), from the sky's Rayleigh terms. */
  tint: N
  /** Base density at height `base`, falloff per metre, and the base height. */
  density: N
  falloff: N
  base: N
  /** Strength of the sun's forward glow in the haze. */
  sunGlow: N
}

/**
 * Returns colour with haze applied. `color` is the linear scene colour, `depth` its depth
 * sample and `uvN` the screen uv (top-left origin).
 */
export function applyHaze(color: N, depth: N, uvN: N, u: HazeUniforms): N {
  return Fn(() => {
    const sky = step(0.99995, depth)
    const view = getViewPosition(uvN, depth, u.projInv)
    const world = u.camWorld.mul(vec4(view, 1)).xyz
    const ray = world.sub(u.camPos)
    const dist = ray.length()
    const dir = ray.div(max(dist, 1e-3))
    // Optical depth: the integral of density * exp(-falloff * (y - base)) along the ray, which
    // is density * e^{-falloff y0} * dist * (1 - e^{-k}) / k with k = falloff * dir.y * dist.
    // k is clamped (a ray straight down a cliff into dense lowland just saturates), and near
    // 0 (level rays) the ratio is its limit 1 - k/2.
    const y0 = u.camPos.y.sub(u.base)
    const k = clamp(u.falloff.mul(dir.y).mul(dist), -30, 30)
    const safeK = select(k.abs().lessThan(1e-3), float(1e-3), k)
    const ratio = select(k.abs().lessThan(1e-3), float(1).sub(k.mul(0.5)), float(1).sub(exp(k.negate())).div(safeK))
    const tau = u.density.mul(exp(clamp(u.falloff.mul(y0).negate(), -30, 30))).mul(dist).mul(ratio)
    const trans = exp(u.tint.mul(tau).negate())
    // In-scatter: horizon colour plus a forward sun lobe.
    const cosT = max(dot(dir, normalize(u.sunDir)), 0)
    const lobe = pow(cosT, 12).mul(0.7).add(pow(cosT, 3).mul(0.3))
    const sunUp = smoothstep(-0.08, 0.05, u.sunDir.y)
    const inscatter = u.horizon.add(u.sunColor.mul(lobe).mul(u.sunGlow).mul(sunUp).mul(0.08))
    const hazed = color.mul(trans).add(inscatter.mul(vec3(1).sub(trans)))
    return mix(hazed, color, sky)
  })()
}
