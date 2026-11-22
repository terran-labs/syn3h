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
export const impactFlash = defineParam({ id: 'fx.impact.flash', label: 'Impact flash size (m)', group, scope, default: 2, min: 0, max: 6, step: 0.05 })
/** Strength of the light thrown on the ground around an impact; 0 for none. */
export const impactLight = defineParam({ id: 'fx.impact.light', label: 'Impact ground light', group, scope, default: 1, min: 0, max: 3, step: 0.05 })
/** Radius of that light for Plasma Tag, m; Thunder's is three times it. */
export const impactLightRadius = defineParam({ id: 'fx.impact.lightRadius', label: 'Impact light radius (m)', group, scope, default: 3, min: 0.5, max: 12, step: 0.25 })
/** How long a scorch lasts, s; 0 for none. */
export const impactScorch = defineParam({ id: 'fx.impact.scorch', label: 'Impact scorch (s)', group, scope, default: 6, min: 0, max: 30, step: 0.5 })
/** Plasma Thunder's fireworks: the narrowest a star may draw, as a share of its distance (about 3 px at 0.0075), so a burst reads across the map and against a noon sky. */
export const fireworkWidth = defineParam({ id: 'fx.fireworks.width', label: 'Firework star width (share of distance)', group, scope, default: 0.0075, min: 0.002, max: 0.02, step: 0.0005 })
/** Plasma Thunder's fireworks: the size of a burst, as a multiple of its stars' speed. */
export const fireworkSize = defineParam({ id: 'fx.fireworks.size', label: 'Firework size', group, scope, default: 4.9, min: 0.5, max: 8, step: 0.05 })
/** Plasma Thunder's fireworks: how strongly their smoke shows by day (it fades out at night); 0 for none. */
export const fireworkSmoke = defineParam({ id: 'fx.fireworks.smoke', label: 'Firework smoke by day', group, scope, default: 1, min: 0, max: 3, step: 0.05 })
/**
 * Plasma Thunder's fireworks: bursts already alive before a new one is drawn with Low's star and
 * smoke counts, so a sky full of bots' fireworks stays cheap. 0: every burst at Low's counts.
 */
export const fireworkCrowd = defineParam({ id: 'fx.fireworks.crowd', label: 'Firework bursts at full detail', group, scope, default: 2, min: 0, max: 6, step: 1 })
/**
 * Plasma Thunder's fireworks: how much of High's extra stars, glitter, crackle and smoke a burst
 * draws at High, from Low's counts (0) to High's (1). Below 1 it is cheaper without a reload.
 */
export const fireworkHighDetail = defineParam({ id: 'fx.fireworks.highDetail', label: 'Firework detail at High', group, scope, default: 1, min: 0, max: 1, step: 0.05 })
