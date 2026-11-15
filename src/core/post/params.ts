/**
 * Post-processing parameters. Every strength defaults to 0, which is off: with all of them at
 * 0 the game renders with plain `renderer.render(scene, camera)` and no post pipeline exists.
 * Client scope, Graphics group: a player's own choice, never shared with the room.
 */
import { defineParam, params } from '../../../shared/params'
import { postOverrides } from '../renderOptions'

const strength = (id: string, label: string) => defineParam({ id, label, group: 'Graphics', scope: 'client', default: 0, min: 0, max: 1, step: 0.05 })

/** Glow round lava, vents, thruster and wing glows, tag beams, lamps and the sun. */
export const bloomStrength = strength('gfx.bloom', 'Bloom strength (0 off; desktop at graphics 2 only)')
export const bloomThreshold = defineParam({ id: 'gfx.bloomThreshold', label: 'Bloom threshold (on-screen brightness)', group: 'Graphics', scope: 'client', default: 3, min: 0, max: 6, step: 0.05 })
export const bloomRadius = defineParam({ id: 'gfx.bloomRadius', label: 'Bloom radius', group: 'Graphics', scope: 'client', default: 0.4, min: 0, max: 1, step: 0.05 })
/** Light shafts from the sun past terrain, strongest when the sun is low. */
export const shaftsStrength = strength('gfx.shafts', 'Sun shafts strength (0 off)')
/** A gentle filmic grade: contrast, saturation and a warm and cool split. */
export const gradeStrength = strength('gfx.grade', 'Film grade strength (0 off)')
/** Darkened corners. */
export const vignetteStrength = strength('gfx.vignette', 'Vignette strength (0 off)')

/** URL overrides for one page load: ?bloom=0.5&shafts=0.6&grade=0.5&vignette=0.4 */
if (typeof location !== 'undefined') {
  const ids: Record<string, string> = { bloom: bloomStrength.def.id, shafts: shaftsStrength.def.id, grade: gradeStrength.def.id, vignette: vignetteStrength.def.id }
  for (const [key, value] of Object.entries(postOverrides(location.search))) params.set(ids[key], value)
}
