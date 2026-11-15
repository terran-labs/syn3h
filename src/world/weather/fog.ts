/**
 * Height fog: haze that is densest at sea level and thins with altitude, so valleys and the
 * shore are veiled while a summit stands clear above it.
 *
 * The haze's extinction falls off exponentially with height, sigma(y) = d * exp(-(y - sea) / H).
 * Its optical depth along the straight view ray from the camera to a pixel has a closed form,
 * the ray length times the mean of that exponential between the two heights:
 *
 *   tau = d * L * (exp(-a_c) - exp(-a_p)) / (a_p - a_c),   a = (y - sea) / H
 *
 * which is exp(-a_c) when the heights are equal. The scene's existing uniform fog
 * (`weather.fogDensity`, squared exponential) is kept and added to it, and the pixel is mixed
 * toward the fog colour by 1 - exp(-tau).
 *
 * Cost per pixel, both layers together: one atan and two square roots to undo the planet
 * curve, two exps for the pixel's height, one vec3 exp for the factor, and a few multiplies
 * for the sun lobe. Everything that depends only on the camera (its scaled height in each
 * layer and the exp of it) is worked out once per render on the CPU and sent as a uniform.
 *
 * The round planet bends what is drawn (src/world/curve.ts), and in the fragment stage
 * `positionWorld` arrives already bent: at the default roundness a volcano 500 m away is
 * drawn about 150 m lower, and the haze treated it as low ground. So the shader undoes the
 * bend before using the height. The curve maps flat ground distance d and height h, round a
 * planet of radius R centred below the camera, to a = (R + h) sin(d / R) along and
 * u = (R + h) cos(d / R) - R up. Its exact inverse is h = sqrt(a^2 + (R + u)^2) - R and
 * d = R atan(a, R + u).
 *
 * Each planet has its own character through three sliders the recipes set: density at sea
 * level, scale height and a tint. An airless world (world.atmosphere 0) has none at all.
 * Storminess thickens it a little and lifts it a little.
 */
import * as THREE from 'three/webgpu'
import { Fn, abs, atan, cameraPosition, dot, exp, float, length, max, mix, normalize, output, positionWorld, renderGroup, select, sqrt, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { defineParam, params, worldLavaAltitude } from '../../../shared/params'
import { curveFactor } from '../curve'
import { atmosphereValue, storminess } from './params'

type N = any // TSL node

const w = 'world' as const
const group = 'Weather'

/** Defaults are the volcanic world's ash haze, the default world. */
/** Extinction per metre at sea level. 0.001 hides about two thirds of a hill 1 km away at the shore. */
export const hazeDensity = defineParam({
  id: 'weather.hazeDensity', label: 'Haze at sea level', group, scope: w,
  default: 0.0024, min: 0, max: 0.006, step: 0.00001,
})
/** Metres over which the haze thins to a third. Low for valley mist, high for a dust storm. */
export const hazeHeight = defineParam({
  id: 'weather.hazeHeight', label: 'Haze height (m)', group, scope: w,
  default: 40, min: 5, max: 400, step: 1,
})
/** Haze colour as a hue shift of the sky's own fog colour, so night stays dark. */
export const hazeTintR = defineParam({ id: 'weather.hazeTintR', label: 'Haze tint red', group, scope: w, default: 0.72, min: 0, max: 1, step: 0.01 })
export const hazeTintG = defineParam({ id: 'weather.hazeTintG', label: 'Haze tint green', group, scope: w, default: 0.62, min: 0, max: 1, step: 0.01 })
export const hazeTintB = defineParam({ id: 'weather.hazeTintB', label: 'Haze tint blue', group, scope: w, default: 0.56, min: 0, max: 1, step: 0.01 })
/** 0 the sky's colour, 1 the tint's hue at the sky's brightness. */
export const hazeTintAmount = defineParam({ id: 'weather.hazeTintAmount', label: 'Haze tint amount', group, scope: w, default: 0.35, min: 0, max: 1, step: 0.01 })

/**
 * Aerial perspective: a second, thin, high layer that makes distant ridges separate into
 * layers and shift toward the sky's own hue. 0 leaves the picture exactly as it was. Asked
 * for by the Post Effects lane for the owner's cinematic look. Enabled at unit strength
 * for ordinary play; the slider still allows players to turn it off.
 */
export const aerial = defineParam({ id: 'weather.aerial', label: 'Aerial perspective', group, scope: w, default: 1, min: 0, max: 3, step: 0.01 })
/** Extinction per metre at sea level of the aerial layer at weather.aerial 1, and its scale height. */
export const AERIAL_DENSITY = 0.0001
export const AERIAL_HEIGHT = 1600
/** Strength of the aerial layer's forward glow around the sun. */
export const AERIAL_SUN_GLOW = 0.25

/**
 * Per channel weights for the aerial layer: the sky's Rayleigh scattering (sky.rayleighR, G
 * and B over their mean), pulled halfway to grey so far terrain does not all turn one hue.
 */
export function aerialWeights(out = new THREE.Vector3()): THREE.Vector3 {
  const r = Number(params.get('sky.rayleighR')?.value ?? 1), g = Number(params.get('sky.rayleighG')?.value ?? 1), b = Number(params.get('sky.rayleighB')?.value ?? 1)
  const mean = (r + g + b) / 3 || 1
  return out.set(0.5 + 0.5 * r / mean, 0.5 + 0.5 * g / mean, 0.5 + 0.5 * b / mean)
}

/** How much a gale (storminess 1) thickens and lifts the haze, beyond the calm values. */
export const STORM_THICKEN = 0.6
export const STORM_LIFT = 0.3

/** The haze numbers the shader uses now, from the sliders, storminess and the atmosphere. */
export function hazeNow(out = { density: 0, height: 70, sea: 0 }): { density: number; height: number; sea: number } {
  const air = Math.max(0, Math.min(1, atmosphereValue()))
  const s = storminess.value
  out.density = air > 0 ? hazeDensity.value * air * (1 + STORM_THICKEN * s) : 0
  out.height = hazeHeight.value * (1 + STORM_LIFT * s)
  out.sea = worldLavaAltitude.value
  return out
}

/**
 * Optical depth of the haze between two points, for tests and for anything on the CPU that
 * wants to know how hidden something is. Same formula as the shader.
 */
export function hazeDepth(h: { density: number; height: number; sea: number }, from: THREE.Vector3Like, to: THREE.Vector3Like): number {
  const L = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  const ac = Math.max(from.y - h.sea, -5) / h.height
  const ap = Math.max(to.y - h.sea, -5) / h.height
  const d = ap - ac
  const mean = Math.abs(d) < 1e-3 ? Math.exp(-ac) * (1 - d / 2) : (Math.exp(-ac) - Math.exp(-ap)) / d
  return h.density * L * mean
}

/** The sun as the aerial layer's glow needs it, read at render time. */
export interface FogSun {
  direction: () => THREE.Vector3
  color: () => THREE.Color
}

/**
 * Mean of exp(-a) between two scaled heights, the closed form shared by both layers. `ec` is
 * exp(-ac): the camera's term, the same for every pixel, so it arrives as a uniform.
 */
function meanExp(ac: N, ec: N, ap: N): N {
  const d = ap.sub(ac) as N
  return select(abs(d).lessThan(1e-3), ec.mul(float(1).sub(d.mul(0.5))), ec.sub(exp(ap.negate())).div(d))
}

/**
 * The scene fog node for a colour and a per channel factor. three's own `fog()` takes one
 * factor for all channels; the aerial layer needs three.
 */
export const weatherFogNode = Fn(([color, factor]: [N, N]) => vec4(mix((output as N).rgb, color, factor), (output as N).a))

/**
 * Fog colour and per channel factor for `weatherFogNode`: `color` (the sky's directional fog
 * colour) and `uniformDensity` (the existing `weather.fogDensity` uniform) come from
 * Environment, and `sun` for the aerial layer's glow. Uniforms update once per render from
 * the sliders; dragging one never recompiles.
 */
export function heightFog(color: N, uniformDensity: N, sun?: FogSun): { color: N; factor: N } {
  const state = hazeNow()
  const tint = new THREE.Vector3(1, 1, 1)
  let tintAmount = 0
  const live = <T,>(initial: T, read: (frame?: { camera?: THREE.Camera | null }) => T) => (uniform(initial as never) as N).setGroup(renderGroup).onRenderUpdate(read)
  const density = live(state.density, () => { hazeNow(state); return state.density })
  const height = live(state.height, () => state.height)
  const sea = live(state.sea, () => state.sea)
  const tintU = live(tint, () => tint.set(hazeTintR.value, hazeTintG.value, hazeTintB.value))
  const tintAmountU = live(tintAmount, () => (tintAmount = hazeTintAmount.value))

  // Undo the planet curve: the true height and ground distance of this pixel.
  const invR = live(0, () => curveFactor())
  const bent = positionWorld as N
  const cam = cameraPosition as N
  const along = length(vec2(bent.x, bent.z).sub(vec2(cam.x, cam.z))) as N
  const R = float(1).div(max(invR, 1e-9)) as N
  const round = (invR as N).greaterThan(0)
  const ground = select(round, R.mul(atan(along, R.add(bent.y))), along) as N
  const y = select(round, sqrt(along.mul(along).add(R.add(bent.y).mul(R.add(bent.y)))).sub(R), bent.y) as N
  const rise = y.sub(cam.y) as N
  const L = sqrt(ground.mul(ground).add(rise.mul(rise))) as N
  // The camera's scaled height in each layer and its exp, once per render rather than per
  // pixel: (haze a_c, exp(-a_c), aerial a_c, exp(-a_c)). Same camera as `cameraPosition`.
  const camTerms = new THREE.Vector4(0, 1, 0, 1)
  const camWorld = new THREE.Vector3()
  const camU = live(camTerms, (frame?: { camera?: THREE.Camera | null }) => {
    const h = hazeNow(camState)
    const above = Math.max((frame?.camera ? camWorld.setFromMatrixPosition(frame.camera.matrixWorld).y : 0) - h.sea, -5)
    const a = above / h.height, b = above / AERIAL_HEIGHT
    return camTerms.set(a, Math.exp(-a), b, Math.exp(-b))
  })
  const above = max(y.sub(sea), -5.0) as N
  const ap = above.div(height) as N
  const dist = L.mul(uniformDensity) as N
  const tau = (density as N).mul(L).mul(meanExp(camU.x, camU.y, ap)).add(dist.mul(dist)) as N

  // The aerial layer, per channel. Zero when weather.aerial is 0 or there is no air.
  const aerialDensity = live(0, () => AERIAL_DENSITY * aerial.value * Math.max(0, Math.min(1, atmosphereValue())))
  const weights = live(new THREE.Vector3(1, 1, 1), () => aerialWeights(weightsValue))
  const ah = float(1 / AERIAL_HEIGHT)
  const tauA = (aerialDensity as N).mul(L).mul(meanExp(camU.z, camU.w, above.mul(ah))) as N
  const tauRGB = vec3(tau, tau, tau).add((weights as N).mul(tauA)) as N
  const factor = vec3(1, 1, 1).sub(exp(tauRGB.negate()))

  // Shift the hue toward the tint and keep the sky colour's brightness.
  const lumW = vec3(0.2126, 0.7152, 0.0722)
  const lum = dot(color, lumW) as N
  const tinted = (tintU as N).mul(lum.div(max(dot(tintU, lumW), 0.05)))
  let fogged = mix(color, tinted, tintAmountU) as N
  if (sun) {
    // A low sun fills the far air: a forward lobe, in the aerial layer's share of the fog only.
    const sunDir = live(new THREE.Vector3(0, 1, 0), sun.direction)
    const sunColor = live(new THREE.Color(), sun.color)
    const view = normalize(bent.sub(cam)) as N
    // The eighth power as three squarings: pow costs a log and an exp per pixel.
    const c1 = max(dot(view, sunDir), 0.0) as N
    const c2 = c1.mul(c1) as N
    const c4 = c2.mul(c2) as N
    const lobe = c4.mul(c4) as N
    const share = tauA.div(tau.add(tauA).add(1e-6)) as N
    fogged = fogged.add(vec3(sunColor as N).mul(lobe.mul(share).mul(AERIAL_SUN_GLOW)))
  }
  return { color: fogged, factor }
}
const weightsValue = new THREE.Vector3()
const camState = { density: 0, height: 70, sea: 0 }
