/**
 * Water sliders. Enabled for normal entry; players and saved rooms can explicitly turn
 * individual features off. Planet recipes retain ownership of water versus lava.
 */
import { defineParam, params } from '../../../shared/params'
import { WAVE_MAX_HEIGHT } from '../../../shared/water/waves'

const P = { group: 'Water', scope: 'world' as const }

/**
 * Which water system draws the liquids: on, the current surface (clipmap sea with waves, lakes
 * and rivers, shoreline foam); off, the classic chunked look. Not a wave height: for calm water
 * set water.waveHeight and water.chop to 0. The id stays water.waves so saved settings load.
 */
export const waterWaves = defineParam({ ...P, id: 'water.waves', label: 'Current water (off: classic look)', default: true })
/** Approximate light attenuation distance through the water column, in metres. */
export const waterClarity = defineParam({
  ...P, id: 'water.clarity', label: 'Water clarity (m)', default: 10, min: 1, max: 50, step: 1,
})
/** Short wind waves that tilt the light: how rough the surface reads. Lighting only. */
export const waterChop = defineParam({
  ...P, id: 'water.chop', label: 'Surface chop', default: 1, min: 0, max: 3, step: 0.05,
})
/**
 * The finest ripples (under about 1.5 m), on top of the chop: where they show at all is set by the
 * gusts, the camera's distance and the pixel footprint. Lighting only.
 */
export const waterRipple = defineParam({
  ...P, id: 'water.ripple', label: 'Fine ripples', default: 1, min: 0, max: 2, step: 0.05,
})
/**
 * Sun glitter: how much of the fine detail stays a sharp facet that can flash the sun. The rest is
 * folded into the surface's roughness (a soft sheen). 0 a satin sea, 1 the default sparkle.
 */
export const waterGlitter = defineParam({
  ...P, id: 'water.glitter', label: 'Sun glitter', default: 0.85, min: 0, max: 1, step: 0.05,
})
/**
 * Calm and rough patches: large slow areas (about 150 m) where the wind's chop and ripples
 * drop away or gather. 0 an even sea, 1 the default patchiness.
 */
export const waterGusts = defineParam({
  ...P, id: 'water.gusts', label: 'Calm and rough patches', default: 1, min: 0, max: 1, step: 0.05,
})
/**
 * The detail layer on the sea and still water: chop, fine ripples and the patches. Owned by
 * the quality level (off at Minimal and Low, which keep the swell and its sheen). Switching it
 * builds nothing: the shader branches on it.
 */
export const waterDetail = defineParam({
  id: 'water.detail', label: 'Water surface detail', group: 'Water', scope: 'client', default: true,
})
/** How strongly the water mirrors the sky. 1 is a true mirror at grazing angles. */
export const waterReflection = defineParam({
  ...P, id: 'water.reflection', label: 'Sky reflection', default: 1, min: 0, max: 2, step: 0.05,
})
/**
 * How much the eye is helped to read the swell: scales the visual-only ripples near the camera
 * (never above 0.15 m at 1) and the light and foam that pick out crests. The physical wave
 * height is water.waveHeight; this never moves anything afloat.
 */
export const waterWaveVisual = defineParam({
  ...P, id: 'water.waveVisual', label: 'Wave visibility', default: 1, min: 0, max: 2, step: 0.05,
})
/** Crest to trough height of the biggest possible swell, metres. */
export const waterWaveHeight = defineParam({
  ...P, id: 'water.waveHeight', label: 'Wave height (m)', default: 2.4, min: 0, max: WAVE_MAX_HEIGHT, step: 0.05,
})
/** Dominant wavelength, metres. Speed follows from it (deep water dispersion). */
export const waterWaveLength = defineParam({
  ...P, id: 'water.waveLength', label: 'Wavelength (m)', default: 36, min: 12, max: 240, step: 1,
})
/** Waves follow the wind sliders' direction; this turns them relative to it, radians. */
export const waterWaveTurn = defineParam({
  ...P, id: 'water.waveTurn', label: 'Wave direction vs wind', default: 0, min: -Math.PI, max: Math.PI, step: 0.01,
})
/**
 * The sea is frozen solid: ground, not liquid (`LiquidBody.frozen` in liquidWaves.ts). The
 * planet that sets it supplies the ice surface's collider.
 */
export const waterSeaFrozen = defineParam<boolean>({ ...P, id: 'world.seaFrozen', label: 'Frozen sea', default: false })
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
