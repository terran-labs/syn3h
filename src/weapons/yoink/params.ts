/**
 * Yoink settings: grab a vehicle, carry it in front of you, fling it. Gravity gun style.
 * World scope; free of Three.js so the room server can import and check them.
 */
import { defineParam } from '../../../shared/params'

const group = 'Gear: Yoink'

/** Off until the owner has tried it (protocol rule 5). */
export const yoinkAllowed = defineParam({
  id: 'yoink.allowed', label: 'Yoink', group, scope: 'world', default: false,
})

/** How far away a vehicle can be grabbed. */
export const yoinkRange = defineParam({
  id: 'yoink.range', label: 'Grab reach', group, scope: 'world',
  default: 40, min: 5, max: 120, step: 1,
})

/** Half angle of the grab cone around the aim, degrees. Wide is forgiving on phones. */
export const yoinkCone = defineParam({
  id: 'yoink.cone', label: 'Grab cone', group, scope: 'world',
  default: 18, min: 3, max: 60, step: 1,
})

/** Where a held vehicle floats: this far ahead of the holder. */
export const yoinkHoldDistance = defineParam({
  id: 'yoink.holdDistance', label: 'Carry distance', group, scope: 'world',
  default: 8, min: 4, max: 30, step: 0.5,
})

/** ...and this far above it. */
export const yoinkHoldHeight = defineParam({
  id: 'yoink.holdHeight', label: 'Carry height', group, scope: 'world',
  default: 3, min: 0, max: 15, step: 0.5,
})

/** Seconds a vehicle can be carried before it drops. 0 carries until let go. */
export const yoinkHoldTime = defineParam({
  id: 'yoink.holdTime', label: 'Carry for at most (0 = no limit)', group, scope: 'world',
  default: 4, min: 0, max: 30, step: 0.5,
})

/**
 * Speed a let-go vehicle leaves at, m/s, where the holder aims. Capped at 50 so the most any
 * fling can give (this, with the room's allowance for the holder's own speed) stays near the
 * speeds the ground guard is proven at (tests/weapons/fling-ground.test.ts).
 */
export const yoinkFling = defineParam({
  id: 'yoink.fling', label: 'Fling speed', group, scope: 'world',
  default: 28, min: 0, max: 50, step: 1,
})

/** A tap with nothing in the cone: a gust that shoves what is close in front. */
export const yoinkPunt = defineParam({
  id: 'yoink.punt', label: 'Gust strength', group, scope: 'world',
  default: 14, min: 0, max: 30, step: 1,
})

export const yoinkPuntRange = defineParam({
  id: 'yoink.puntRange', label: 'Gust reach', group, scope: 'world',
  default: 18, min: 3, max: 60, step: 1,
})

/** How hard the carry holds on, as a multiple of Earth gravity. Lower lets a driver struggle free. */
export const yoinkGrip = defineParam({
  id: 'yoink.grip', label: 'Carry grip', group, scope: 'world',
  default: 3, min: 1, max: 8, step: 0.1,
})

/** Seconds after a fling or gust before the next. */
export const yoinkCooldown = defineParam({
  id: 'yoink.cooldown', label: 'Yoink recharge', group, scope: 'world',
  default: 0.8, min: 0, max: 5, step: 0.1,
})
