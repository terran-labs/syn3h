/**
 * Tuning for gear impacts (ImpactFx.ts). Looks only, so each player's own: nothing here
 * changes where a shot goes or what it does.
 */
import { defineParam } from '../../../shared/params'

const group = 'Gear effects', scope = 'client' as const
/** Sparks from one Plasma Tag impact at High; Low and Minimal draw a share, Thunder about twice as many. */
export const impactSparks = defineParam({ id: 'fx.impact.sparks', label: 'Impact sparks', group, scope, default: 28, min: 0, max: 64, step: 1 })
/** Spark speed off the surface, m/s. */
export const impactSparkSpeed = defineParam({ id: 'fx.impact.sparkSpeed', label: 'Impact spark speed (m/s)', group, scope, default: 22, min: 1, max: 40, step: 0.5 })
/** Size of the flash at the point of impact, m. */
export const impactFlash = defineParam({ id: 'fx.impact.flash', label: 'Impact flash size (m)', group, scope, default: 1.5, min: 0, max: 6, step: 0.05 })
/** Strength of the light thrown on the ground around an impact; 0 for none. */
export const impactLight = defineParam({ id: 'fx.impact.light', label: 'Impact ground light', group, scope, default: 1, min: 0, max: 3, step: 0.05 })
/** Radius of that light for Plasma Tag, m; Thunder's is three times it. */
export const impactLightRadius = defineParam({ id: 'fx.impact.lightRadius', label: 'Impact light radius (m)', group, scope, default: 3, min: 0.5, max: 12, step: 0.25 })
/** How long a scorch lasts, s; 0 for none. */
export const impactScorch = defineParam({ id: 'fx.impact.scorch', label: 'Impact scorch (s)', group, scope, default: 6, min: 0, max: 30, step: 0.5 })
