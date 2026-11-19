/**
 * The haze field: one model of the air's haze that everything reads, so the fog on terrain,
 * the sky's horizon band and (later) the sun shafts and headlight cones agree on where the
 * haze is and what colour it is.
 *
 * Density, per metre, at a point h metres above the sea:
 *
 *   sigma(h) = d * exp(-h / H)  +  a * exp(-h / Ha)
 *
 * the planet's height haze (weather.hazeDensity d, weather.hazeHeight H, src/world/weather/fog.ts)
 * and the thin aerial layer (a, Ha). Terrain takes it through the scene fog (fog.ts, closed form
 * along each view ray). The sky takes it here, as a band at the horizon: a sky ray grazing the
 * small curved planet passes through the lowest, densest air for a long way, so near the
 * horizon the sky fades into the same haze colour that distant land and sea fade into. Without
 * it the land took the haze while the sky above it did not, and the planet's edge was a hard
 * line (the owner, 18 November 2026: "blend the horizons of our little marble planets").
 *
 * Colour: the sky's own directional horizon colours (toward the sun, beside it, away from it;
 * Environment), shifted toward the planet's haze tint at constant brightness. One function
 * for the fog node and the sky band, so the two can never drift apart.
 */
import { defineParam } from '../../../shared/params'
import { dot, exp, float, max, mix, pow, vec2, vec3 } from 'three/tsl'

type N = any // TSL node

/**
 * How strongly the sky takes the haze at its horizon. 1 is the haze the sky ray really
 * crosses; 0 the sky as it was (a hard edge where the land's haze stops).
 */
export const horizonHaze = defineParam({ id: 'weather.horizonHaze', label: 'Haze at the sky\'s horizon', group: 'Weather', scope: 'world', default: 1, min: 0, max: 2, step: 0.05 })

/** Rec. 709 luminance weights. */
const LUM = [0.2126, 0.7152, 0.0722] as const

/** The directional haze colour's inputs, as nodes: the sky's horizon colours and the sun's bearing. */
export interface HazeColourInputs {
  toward: N; side: N; away: N
  /** Unit vector of the sun's bearing on the ground plane. */
  sunXZ: N
  /** Power of the glow toward the sun (narrow at a low sun). */
  lobe: N
  /** Share of the sun-ward glow the air at this pixel takes (1 open air; see Environment). */
  lit?: N
}

/**
 * The haze colour toward a unit view direction, before the tint. The horizontal part of the
 * view is used as it is, not normalised: a view looking down at the ground near the camera
 * points nowhere near the sun and takes the neutral side colour.
 */
export function hazeDirectionalColour(view: N, u: HazeColourInputs): N {
  const cosA = vec2(view.x, view.z).dot(u.sunXZ) as N
  let towardW = pow(max(cosA, 0.0), u.lobe) as N
  if (u.lit) towardW = towardW.mul(u.lit)
  const awayW = max(cosA.negate(), 0.0)
  return u.side.add(u.toward.sub(u.side).mul(towardW)).add(u.away.sub(u.side).mul(awayW))
}

/** Shift `color` toward `tint`'s hue at `amount`, keeping its brightness. */
export function hazeTinted(color: N, tint: N, amount: N): N {
  const w = vec3(...LUM)
  const lum = dot(color, w) as N
  const tinted = tint.mul(lum.div(max(dot(tint, w), 0.05)))
  return mix(color, tinted, amount)
}

/** The haze numbers a sky ray needs, as nodes (Environment writes them each frame). */
export interface SkyHazeInputs {
  /** Height haze at sea level (per metre) and its scale height. */
  density: N; height: N
  /** Aerial layer at sea level (per metre) and its scale height. */
  aerialDensity: N; aerialHeight: N
  /** The camera's height above the sea. */
  camAbove: N
  /** 1 / the drawn planet radius (0 for a flat world). */
  invR: N
}

/** Sky directions (sine of elevation) above which the band is faded to nothing. */
export const SKY_HAZE_TOP = 0.3

/** Steps of the sky ray's haze integral, and the longest ray it follows (m). */
export const SKY_HAZE_STEPS = 8
export const SKY_HAZE_REACH = 20000

/**
 * Optical depth of the haze along a sky ray from the camera, over the curved planet: at
 * distance s along a ray that climbs dy per metre, the ground falls away by s^2 / 2R, so the
 * ray's height above the sea is camAbove + s dy + s^2 / 2R. Integrated with the midpoint rule
 * over steps that grow with distance (the near air matters most). A ray that dips into the
 * planet would hit land, which hides the sky there anyway; its heights are clamped at the sea.
 */
export function skyHazeDepth(dir: N, u: SkyHazeInputs): N {
  // Far enough that the ray has climbed out of the aerial layer, at most SKY_HAZE_REACH.
  const reach = float(SKY_HAZE_REACH)
  const tau = float(0).toVar() as N
  let prev = 0
  for (let i = 1; i <= SKY_HAZE_STEPS; i++) {
    // Quadratic spacing: fractions 1/64 .. 1 of the reach.
    const f0 = prev, f1 = (i / SKY_HAZE_STEPS) ** 2
    prev = f1
    const s = reach.mul((f0 + f1) / 2), ds = reach.mul(f1 - f0)
    const h = max(u.camAbove.add(s.mul(dir.y)).add(s.mul(s).mul(u.invR).mul(0.5)), 0.0) as N
    const sigma = u.density.mul(exp(h.div(u.height).negate())).add(u.aerialDensity.mul(exp(h.div(u.aerialHeight).negate())))
    tau.addAssign(sigma.mul(ds))
  }
  return tau
}

/** CPU twin of skyHazeDepth, for tests. */
export function skyHazeDepthCpu(dirY: number, u: { density: number; height: number; aerialDensity: number; aerialHeight: number; camAbove: number; invR: number }): number {
  let tau = 0, prev = 0
  for (let i = 1; i <= SKY_HAZE_STEPS; i++) {
    const f0 = prev, f1 = (i / SKY_HAZE_STEPS) ** 2
    prev = f1
    const s = SKY_HAZE_REACH * (f0 + f1) / 2, ds = SKY_HAZE_REACH * (f1 - f0)
    const h = Math.max(u.camAbove + s * dirY + s * s * u.invR * 0.5, 0)
    tau += (u.density * Math.exp(-h / u.height) + u.aerialDensity * Math.exp(-h / u.aerialHeight)) * ds
  }
  return tau
}

/** The share of a sky ray's colour the haze replaces: 1 - exp(-tau), scaled by weather.horizonHaze. */
export function skyHazeAmount(tau: N, strength: N): N {
  return float(1).sub(exp(tau.mul(strength).negate()))
}
