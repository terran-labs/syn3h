/**
 * Every sky, sun and weather constant, declared once. No renderer imports, so the server can
 * import this to validate values. Defaults are the 'Mars day' preset.
 *
 * The default hour and azimuth are the first thing a new player sees, so they are chosen
 * from spawn pad 0, which looks along +Z at the volcano: a late afternoon sun low on the
 * right and slightly behind the camera. That lights the near flank from the side, throws
 * long shadows across the road and keeps the sun's glare out of frame. With the azimuth at
 * 20 the same hour put the sun behind the volcano and the face toward the pad went dark.
 * The day runs by default, at a pace set by the planet's orbit (dayCycle.ts); a recipe's hour
 * is where each visit to that planet starts.
 */
import { defineParam } from '../../../shared/params'
import type { SkyParams } from './skyMath'

const w = 'world' as const

// Sky ----------------------------------------------------------------------------------
export const skyRayleighR = defineParam({ id: 'sky.rayleighR', label: 'Scatter red', group: 'Sky', scope: w, default: 24, min: 0, max: 60, step: 0.1 })
export const skyRayleighG = defineParam({ id: 'sky.rayleighG', label: 'Scatter green', group: 'Sky', scope: w, default: 15, min: 0, max: 60, step: 0.1 })
export const skyRayleighB = defineParam({ id: 'sky.rayleighB', label: 'Scatter blue', group: 'Sky', scope: w, default: 5.5, min: 0, max: 60, step: 0.1 })
export const skyRayleigh = defineParam({ id: 'sky.rayleigh', label: 'Rayleigh strength', group: 'Sky', scope: w, default: 1, min: 0, max: 4, step: 0.01 })
export const skyTurbidity = defineParam({ id: 'sky.turbidity', label: 'Turbidity', group: 'Sky', scope: w, default: 6, min: 0, max: 20, step: 0.1 })
export const skyMieCoefficient = defineParam({ id: 'sky.mieCoefficient', label: 'Mie coefficient', group: 'Sky', scope: w, default: 0.012, min: 0, max: 0.1, step: 0.001 })
export const skyMieDirectionalG = defineParam({ id: 'sky.mieDirectionalG', label: 'Mie directional g', group: 'Sky', scope: w, default: 0.75, min: 0, max: 0.999, step: 0.001 })
export const skySunDisc = defineParam({ id: 'sky.sunDisc', label: 'Sun disc', group: 'Sky', scope: w, default: true })
export const skyExposure = defineParam({ id: 'sky.exposure', label: 'Exposure', group: 'Sky', scope: w, default: 0.3, min: 0.05, max: 3, step: 0.01 })
/** 0 fixed exposure, 1 strong eye adaptation, so dusk and night stay readable. */
export const skyAutoExposure = defineParam({ id: 'sky.autoExposure', label: 'Auto exposure', group: 'Sky', scope: w, default: 0.8, min: 0, max: 1, step: 0.01 })
export const skyNightBrightness = defineParam({ id: 'sky.nightBrightness', label: 'Night sky', group: 'Sky', scope: w, default: 1, min: 0, max: 5, step: 0.01 })
export const skyStars = defineParam({ id: 'sky.stars', label: 'Stars', group: 'Sky', scope: w, default: 1, min: 0, max: 3, step: 0.01 })

// Sun ----------------------------------------------------------------------------------
/**
 * The hour at the room clock time `sun.dayEpoch`. The hour now runs on from it at the day's
 * pace, the same on every client: read it with `currentHour()` (dayCycle.ts), not from here.
 */
export const sunTimeOfDay = defineParam({ id: 'sun.timeOfDay', label: 'Time of day (h)', group: 'Sun', scope: w, default: 16.5, min: 0, max: 24, step: 0.01 })
// Day length and the day clock's anchor live in dayParams.ts, which the room server imports.
export { sunDayEpoch, sunDayLength } from './dayParams'
/** Latitude style tilt: the noon sun stands at 90 minus this many degrees. */
export const sunTilt = defineParam({ id: 'sun.tilt', label: 'Tilt (latitude)', group: 'Sun', scope: w, default: 30, min: 0, max: 80, step: 0.5 })
export const sunAzimuth = defineParam({ id: 'sun.azimuth', label: 'Azimuth', group: 'Sun', scope: w, default: 335, min: 0, max: 360, step: 1 })
export const sunIntensity = defineParam({ id: 'sun.intensity', label: 'Sunlight', group: 'Sun', scope: w, default: 12, min: 0, max: 20, step: 0.05 })
export const sunAmbient = defineParam({ id: 'sun.ambient', label: 'Sky ambient', group: 'Sun', scope: w, default: 0.6, min: 0, max: 4, step: 0.01 })
export const sunMoonIntensity = defineParam({ id: 'sun.moonIntensity', label: 'Moonlight', group: 'Sun', scope: w, default: 0.6, min: 0, max: 3, step: 0.01 })

// Weather ------------------------------------------------------------------------------
export const cloudCoverage = defineParam({ id: 'weather.cloudCoverage', label: 'Cloud coverage', group: 'Weather', scope: w, default: 0.15, min: 0, max: 1, step: 0.01 })
export const cloudDensity = defineParam({ id: 'weather.cloudDensity', label: 'Cloud density', group: 'Weather', scope: w, default: 0.4, min: 0, max: 1, step: 0.01 })
export const cloudScale = defineParam({ id: 'weather.cloudScale', label: 'Cloud scale', group: 'Weather', scope: w, default: 0.0002, min: 0.00002, max: 0.001, step: 0.00001 })
export const cloudSpeed = defineParam({ id: 'weather.cloudSpeed', label: 'Cloud speed', group: 'Weather', scope: w, default: 0.00002, min: 0, max: 0.0002, step: 0.000001 })
export const cloudElevation = defineParam({ id: 'weather.cloudElevation', label: 'Cloud elevation', group: 'Weather', scope: w, default: 0.5, min: 0, max: 1, step: 0.01 })
export const fogDensity = defineParam({ id: 'weather.fogDensity', label: 'Fog density', group: 'Weather', scope: w, default: 0.0002, min: 0, max: 0.005, step: 0.00001 })

// Client -------------------------------------------------------------------------------
const touch = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
/**
 * 0 no shadows, 1 two 1024 cascades, 2 three 2048 cascades, 3 four 2048 cascades.
 * Phones start at 1. Rebuilding the light recompiles materials, so it applies on release.
 */
export const shadowQuality = defineParam({
  id: 'gfx.shadowQuality', label: 'Shadow quality', group: 'Graphics', scope: 'client',
  default: touch ? 1 : 2, min: 0, max: 3, step: 1, deferred: true,
})
/** UI action: 1 to 4 applies a preset from presets.ts, 0 does nothing. Personal, never sent. */
export const skyPresetPicker = defineParam({
  id: 'sky.preset', label: 'Preset 1 Mars 2 Earth 3 Green 4 Violet', group: 'Sky', scope: 'client',
  default: 0, min: 0, max: 4, step: 1, deferred: true,
})

const _sky: SkyParams = {
  rayleighColor: [0, 0, 0], rayleigh: 1, turbidity: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8, nightBrightness: 1,
}
/** Current scattering parameters as one object. Reuses storage, so copy if you keep it. */
export function currentSkyParams(): SkyParams {
  _sky.rayleighColor[0] = skyRayleighR.value
  _sky.rayleighColor[1] = skyRayleighG.value
  _sky.rayleighColor[2] = skyRayleighB.value
  _sky.rayleigh = skyRayleigh.value
  _sky.turbidity = skyTurbidity.value
  _sky.mieCoefficient = skyMieCoefficient.value
  _sky.mieDirectionalG = skyMieDirectionalG.value
  _sky.nightBrightness = skyNightBrightness.value
  return _sky
}
