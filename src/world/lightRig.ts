/**
 * The outdoor light rig's ambient half: what lights the faces the sun does not reach.
 *
 * Outdoors there are three lights (Inigo Quilez, "outdoor lighting"): the sun; the sky, a
 * cool fill from above; and the ground, a warm bounce from below in the ground's own colour,
 * opposite the sun. Environment already has the first two. Its hemisphere light's ground
 * half was the horizon sky at half strength, so every shadowed face got the same dull
 * sky-tinted wash. `light.bounce` adds the real bounce: the ground's albedo, from the
 * terrain palette, lit by the sun at its current height, so shadow sides glow rust on the
 * volcanic world, gold on the desert and green on the alpine one, and it dims with the sun.
 *
 * `light.skyReflection` is the strength of the sky's reflection in every surface
 * (scene.environmentIntensity), until now fixed at 0.15.
 *
 * Ground bounce is enabled by default. Setting bounce to 0 restores the old ground colour;
 * the reflection default remains 0.15.
 * Shadow softness and strength control the existing cascades without rebuilding shaders.
 */
import * as THREE from 'three/webgpu'
import { defineParam, params } from '../../shared/params'
import { paletteFor } from './terrain/palettes'

const g = 'Light'
const c = 'client' as const

export const lightBounce = defineParam({ id: 'light.bounce', label: 'Ground bounce light (warm fill from below)', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.05 })
export const lightSkyReflection = defineParam({ id: 'light.skyReflection', label: 'Sky reflection strength', group: g, scope: c, default: 0.15, min: 0, max: 1, step: 0.01 })
export const shadowSoftness = defineParam({ id: 'light.shadowSoftness', label: 'Sun shadow softness', group: g, scope: c, default: 2, min: 1, max: 4, step: 0.1 })
export const shadowStrength = defineParam({ id: 'light.shadowStrength', label: 'Sun shadow strength', group: g, scope: c, default: 0.85, min: 0, max: 1, step: 0.01 })

const albedo = new THREE.Color()
const dark = new THREE.Color()

/**
 * Sets `ground` (the hemisphere light's ground colour) from the old value `skyGround` and the
 * bounce off the terrain. `sunColor` is the direct light's linear colour times intensity and
 * `sunY` the sine of its elevation (the moon's light, at night, bounces the same way).
 */
export function applyBounce(ground: THREE.Color, skyGround: THREE.Color, sunColor: THREE.Color, sunY: number): void {
  const bounce = lightBounce.value
  ground.copy(skyGround)
  if (!(bounce > 0)) return
  const pal = paletteFor(Number(params.get('terrain.look')?.value ?? 0))
  // The ground's mean albedo: halfway between its light and dark tones, in linear colour.
  albedo.setHex(pal.groundLight, THREE.SRGBColorSpace)
  dark.setHex(pal.groundDark, THREE.SRGBColorSpace)
  albedo.lerp(dark, 0.5)
  // Irradiance on flat ground from the sun is its colour times the sine of its height; the
  // ground reflects albedo of it back up. The old sky term fades as the bounce takes over.
  const irradiance = Math.max(0, sunY)
  ground.multiplyScalar(1 - 0.5 * Math.min(1, bounce))
  ground.r += albedo.r * sunColor.r * irradiance * bounce
  ground.g += albedo.g * sunColor.g * irradiance * bounce
  ground.b += albedo.b * sunColor.b * irradiance * bounce
}
