/**
 * Named sky presets. Plain objects keyed by parameter id, so they can be saved, sent over
 * the network or typed into the console. No renderer imports.
 */
import { params, type ParamSource, type ParamValue } from '../../../shared/params'

export interface SkyPreset {
  'sky.rayleighR': number
  'sky.rayleighG': number
  'sky.rayleighB': number
  'sky.rayleigh': number
  'sky.turbidity': number
  'sky.mieCoefficient': number
  'sky.mieDirectionalG': number
  'sky.nightBrightness': number
  [id: string]: ParamValue
}

export const SKY_PRESETS = {
  /** Butterscotch dust sky: red scattering, so the sunset turns blue. */
  'Mars day': {
    'sky.rayleighR': 24, 'sky.rayleighG': 15, 'sky.rayleighB': 5.5, 'sky.rayleigh': 1,
    'sky.turbidity': 6, 'sky.mieCoefficient': 0.012, 'sky.mieDirectionalG': 0.75,
    'sky.nightBrightness': 1, 'weather.cloudCoverage': 0.15, 'weather.fogDensity': 0.0002,
    'sun.timeOfDay': 10.5,
  },
  /** Preetham's Earth wavelengths. */
  'Earthlike': {
    'sky.rayleighR': 5.8045, 'sky.rayleighG': 13.5629, 'sky.rayleighB': 30.2659, 'sky.rayleigh': 1,
    'sky.turbidity': 2, 'sky.mieCoefficient': 0.005, 'sky.mieDirectionalG': 0.8,
    'sky.nightBrightness': 1, 'weather.cloudCoverage': 0.4, 'weather.fogDensity': 0.0002,
    'sun.timeOfDay': 11,
  },
  /** Green scattering haze with a magenta sunset. */
  'Methane green': {
    'sky.rayleighR': 8, 'sky.rayleighG': 30, 'sky.rayleighB': 11, 'sky.rayleigh': 1.2,
    'sky.turbidity': 4, 'sky.mieCoefficient': 0.006, 'sky.mieDirectionalG': 0.8,
    'sky.nightBrightness': 1.5, 'weather.cloudCoverage': 0.55, 'weather.fogDensity': 0.0003,
    'sun.timeOfDay': 15,
  },
  /** Red and blue scattering with little green, low sun. */
  'Violet dusk': {
    'sky.rayleighR': 20, 'sky.rayleighG': 6, 'sky.rayleighB': 34, 'sky.rayleigh': 1,
    'sky.turbidity': 3, 'sky.mieCoefficient': 0.008, 'sky.mieDirectionalG': 0.85,
    'sky.nightBrightness': 2, 'weather.cloudCoverage': 0.3, 'weather.fogDensity': 0.00025,
    'sun.timeOfDay': 17.4,
  },
} satisfies Record<string, SkyPreset>

export type SkyPresetName = keyof typeof SKY_PRESETS
export const SKY_PRESET_NAMES = Object.keys(SKY_PRESETS) as SkyPresetName[]

/**
 * Apply a preset through the registry, so sliders, listeners and the network all see it.
 * Defaults to 'local' so the change propagates as if the player dragged each slider.
 */
export function applySkyPreset(name: SkyPresetName, source: ParamSource = 'local'): void {
  params.applySnapshot(SKY_PRESETS[name], source)
}
