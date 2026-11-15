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
 * toward the fog colour by 1 - exp(-tau). One extra exp per pixel in the fog pass already
 * running: nothing measurable on a phone.
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
import { abs, atan, cameraPosition, dot, exp, float, length, max, mix, positionWorld, renderGroup, select, sqrt, uniform, vec2, vec3 } from 'three/tsl'
import { defineParam, worldLavaAltitude } from '../../../shared/params'
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

/**
 * Fog colour and factor for the scene's `fog(color, factor)` node: `color` (the sky's directional fog colour) and `uniformDensity` (the
 * existing `weather.fogDensity` uniform) come from Environment. Uniforms update once per
 * render from the sliders; dragging one never recompiles.
 */
export function heightFog(color: N, uniformDensity: N): { color: N; factor: N } {
  const state = hazeNow()
  const tint = new THREE.Vector3(1, 1, 1)
  let tintAmount = 0
  const live = <T,>(initial: T, read: () => T) => (uniform(initial as never) as N).setGroup(renderGroup).onRenderUpdate(read)
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
  const ac = max(cam.y.sub(sea), -5.0).div(height) as N
  const ap = max(y.sub(sea), -5.0).div(height) as N
  const d = ap.sub(ac) as N
  const ec = exp(ac.negate()) as N
  const mean = select(abs(d).lessThan(1e-3), ec.mul(float(1).sub(d.mul(0.5))), ec.sub(exp(ap.negate())).div(d)) as N
  const dist = L.mul(uniformDensity) as N
  const tau = (density as N).mul(L).mul(mean).add(dist.mul(dist)) as N
  const factor = float(1).sub(exp(tau.negate()))

  // Shift the hue toward the tint and keep the sky colour's brightness.
  const lumW = vec3(0.2126, 0.7152, 0.0722)
  const lum = dot(color, lumW) as N
  const tinted = (tintU as N).mul(lum.div(max(dot(tintU, lumW), 0.05)))
  return { color: mix(color, tinted, tintAmountU), factor }
}
