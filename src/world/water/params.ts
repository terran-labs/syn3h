/**
 * Water sliders. Enabled for normal entry; players and saved rooms can explicitly turn
 * individual features off. Planet recipes retain ownership of water versus lava.
 */
import { defineParam, params } from '../../../shared/params'
import { WAVE_MAX_HEIGHT } from '../../../shared/water/waves'

const P = { group: 'Water', scope: 'world' as const }

/** Master switch for the new sea surface: waves, shoreline foam lines, the new water look. */
export const waterWaves = defineParam({ ...P, id: 'water.waves', label: 'Sea waves', default: true })
/** Approximate light attenuation distance through the water column, in metres. */
export const waterClarity = defineParam({
  ...P, id: 'water.clarity', label: 'Water clarity (m)', default: 10, min: 1, max: 50, step: 1,
})
/** Crest to trough height of the biggest possible swell, metres. */
export const waterWaveHeight = defineParam({
  ...P, id: 'water.waveHeight', label: 'Wave height (m)', default: 0.8, min: 0, max: WAVE_MAX_HEIGHT, step: 0.05,
})
/** Dominant wavelength, metres. Speed follows from it (deep water dispersion). */
export const waterWaveLength = defineParam({
  ...P, id: 'water.waveLength', label: 'Wavelength (m)', default: 60, min: 12, max: 240, step: 1,
})
/** Waves follow the wind sliders' direction; this turns them relative to it, radians. */
export const waterWaveTurn = defineParam({
  ...P, id: 'water.waveTurn', label: 'Wave direction vs wind', default: 0, min: -Math.PI, max: Math.PI, step: 0.01,
})
/** Fastest a river may run, m/s. Manning's formula sets the speed below this. */
export const waterRiverMaxSpeed = defineParam({
  ...P, id: 'water.riverMaxSpeed', label: 'River speed cap (m/s)', default: 6, min: 0, max: 15, step: 0.1,
})

/**
 * `?water=1` in the page address turns on everything the Water Lab built, for previews:
 * a water sea, rivers that ford roads and reach the sea, waves, sinking, the underwater camera, ripples and spray. Set as local
 * slider changes, so a host shares them with the room as any slider change would.
 */
export function applyWaterQuery(search: string = typeof location === 'undefined' ? '' : location.search): void {
  if (new URLSearchParams(search).get('water') !== '1') return
  for (const [id, value] of Object.entries({
    'world.seaKind': 1, 'terrain.fords': 1, 'water.waves': true, 'water.sinking': true, 'water.underwater': true, 'water.ripples': true, 'water.spray': true,
  })) params.set(id, value, 'local')
}
