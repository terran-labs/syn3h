/**
 * Water Lab sliders. Every switch that changes behaviour defaults off, so with them off the
 * game is exactly as it was (ops/PROTOCOL.md rule 5).
 */
import { defineParam } from '../../../shared/params'
import { WAVE_MAX_HEIGHT } from '../../../shared/water/waves'

const P = { group: 'Water', scope: 'world' as const }

/** Master switch for the new sea surface: waves, shoreline foam lines, the new water look. */
export const waterWaves = defineParam({ ...P, id: 'water.waves', label: 'Sea waves', default: false })
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
