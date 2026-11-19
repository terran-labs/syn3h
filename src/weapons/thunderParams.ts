/**
 * Plasma Thunder as a flare and an anti-air bolt (the owner's rule, 18 November 2026, "Build
 * it as proposed"): it skips off the ground a few times, goes off on contact with a vehicle or
 * when it passes close to one, and ends in a firework high enough to be seen across the world.
 * World scope, so the room shares them and the host can tune them live; free of Three.js so the
 * room server can import them (it checks arming).
 */
import { defineParam } from '../../shared/params'

const group = 'Gear: Plasma Thunder', scope = 'world' as const

/** Skips off the ground before the next contact detonates it. */
export const thunderSkips = defineParam({ id: 'thunder.skips', label: 'Skips off the ground', group, scope, default: 3, min: 0, max: 6, step: 1 })
/** It skips only off ground met at less than this angle (degrees from the surface); steeper detonates. */
export const thunderSkipAngle = defineParam({ id: 'thunder.skipAngle', label: 'Steepest skip (°)', group, scope, default: 35, min: 5, max: 85, step: 1 })
/** Share of its speed along the ground kept at each skip. */
export const thunderSkipKeep = defineParam({ id: 'thunder.skipKeep', label: 'Speed kept along the ground per skip', group, scope, default: 0.85, min: 0.3, max: 1, step: 0.01 })
/** Share of its speed off the ground (the bounce) kept at each skip. */
export const thunderSkipBounce = defineParam({ id: 'thunder.skipBounce', label: 'Bounce per skip', group, scope, default: 0.5, min: 0.1, max: 1, step: 0.01 })
/** Gravity on the bolt after its first skip, m/s². Before it, it flies flat. */
export const thunderSkipGravity = defineParam({ id: 'thunder.skipGravity', label: 'Gravity after the first skip (m/s²)', group, scope, default: 9.8, min: 0, max: 30, step: 0.1 })
/** Each skip's push, as a share of the detonation's. */
export const thunderSkipPush = defineParam({ id: 'thunder.skipPush', label: 'Push at each skip (share)', group, scope, default: 0.33, min: 0, max: 1, step: 0.01 })
/** Proximity fuse radius against a vehicle on the ground, m. */
export const thunderFuseGround = defineParam({ id: 'thunder.fuseGround', label: 'Fuse radius, ground (m)', group, scope, default: 3, min: 0, max: 12, step: 0.25 })
/** Proximity fuse radius against a vehicle in the air, m. */
export const thunderFuseAir = defineParam({ id: 'thunder.fuseAir', label: 'Fuse radius, air (m)', group, scope, default: 8, min: 0, max: 20, step: 0.25 })
/** A vehicle this high above the ground, m, counts as in the air for the fuse. */
export const thunderFuseAirHeight = defineParam({ id: 'thunder.fuseAirHeight', label: 'In the air above (m)', group, scope, default: 5, min: 0, max: 30, step: 0.5 })
/** Seconds of flight before the fuse arms. Contact with a vehicle detonates it before then too. */
export const thunderFuseArm = defineParam({ id: 'thunder.fuseArm', label: 'Fuse arms after (s)', group, scope, default: 0.25, min: 0, max: 2, step: 0.05 })
/** How high above a ground detonation the star shell bursts, m. */
export const thunderFlareHeight = defineParam({ id: 'thunder.flareHeight', label: 'Flare height (m)', group, scope, default: 40, min: 0, max: 150, step: 1 })
/** Seconds a flare shows on the minimap; 0 for none. */
export const thunderMapPing = defineParam({ id: 'thunder.mapPing', label: 'Minimap ping (s)', group, scope, default: 8, min: 0, max: 30, step: 0.5 })
