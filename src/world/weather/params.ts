/**
 * Weather sliders. All world scope: wind changes physics, so every client in a room must
 * hold the same values.
 *
 * `weather.storminess` is the master control, calm (0) to gale (1). It scales the wind speed
 * and the gustiness below, which stay available for people who want to tune them apart.
 * Air itself is Terrain Lab's `world.atmosphere` (0 vacuum to 1, set by each planet recipe),
 * read through `atmosphereValue`: 0 turns off wind, its sound and fog together.
 */
import { defineParam, params } from '../../../shared/params'

const w = 'world' as const
const group = 'Weather'

/**
 * Storminess at which the wind speed slider is the summit's mean wind exactly. Above it the
 * wind is stronger, below it calmer, linearly: a gale at 1 is twice the slider.
 */
export const STORMINESS_REFERENCE = 0.5

/**
 * The value the owner is asked to try. The slider default stays 0 until he has felt it
 * (ops/PROTOCOL.md rule 5: land dark); `?weather=` or the slider turns it on.
 */
export const RECOMMENDED_STORMINESS = 0.5

export const storminess = defineParam({
  id: 'weather.storminess', label: 'Storminess (calm to gale)', group, scope: w,
  default: 0, min: 0, max: 1, step: 0.01,
})

/** Mean wind at the summit, m/s, at the reference storminess. */
export const windSpeed = defineParam({
  id: 'weather.windSpeed', label: 'Summit wind (m/s)', group, scope: w,
  default: 16, min: 0, max: 40, step: 0.5,
})

/** 0 steady, 1 very gusty. Scaled up a little by storminess. */
export const gustiness = defineParam({
  id: 'weather.gustiness', label: 'Gustiness', group, scope: w,
  default: 0.5, min: 0, max: 1, step: 0.01,
})

/** Degrees added to the seed's prevailing direction, which also drifts slowly by itself. */
export const windDirection = defineParam({
  id: 'weather.windDirection', label: 'Wind direction (degrees)', group, scope: w,
  default: 0, min: 0, max: 360, step: 1,
})

/**
 * The planet's air, 0 vacuum to 1. Terrain Lab registers `world.atmosphere`; until that is
 * on trunk this reads as 1, Earthlike.
 */
export function atmosphereValue(): number {
  const v = params.get('world.atmosphere')?.value
  return typeof v === 'number' ? v : 1
}
