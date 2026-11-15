/**
 * Big Red settings: hold the tag control to charge, let go to send a fat, slow red beam that
 * carries a lot more energy. It tags like a tag beam and shoves whatever it touches, in every
 * mode. World scope; free of Three.js so the room server can import it.
 */
import { defineParam } from '../../shared/params'

const group = 'Gear: Big Red'

/** Off until the owner has tried it (protocol rule 5). */
export const bigRedAllowed = defineParam({
  id: 'bigRed.allowed', label: 'Big Red', group, scope: 'world', default: false,
})

/** Seconds of holding before it is ready. Letting go sooner fizzles. */
export const bigRedCharge = defineParam({
  id: 'bigRed.charge', label: 'Charge time', group, scope: 'world',
  default: 0.8, min: 0.1, max: 3, step: 0.05,
})

export const bigRedSpeed = defineParam({
  id: 'bigRed.speed', label: 'Big Red speed', group, scope: 'world',
  default: 110, min: 20, max: 340, step: 1,
})

/** Velocity change it gives a vehicle it touches, m/s, along the beam with some lift. */
export const bigRedPush = defineParam({
  id: 'bigRed.push', label: 'Big Red shove', group, scope: 'world',
  default: 18, min: 0, max: 60, step: 0.5,
})

/** How far from its centre line it still catches a vehicle, metres. */
export const bigRedRadius = defineParam({
  id: 'bigRed.radius', label: 'Big Red width', group, scope: 'world',
  default: 1.4, min: 0, max: 5, step: 0.1,
})

/** Seconds after one Big Red before the next can charge. */
export const bigRedCooldown = defineParam({
  id: 'bigRed.cooldown', label: 'Big Red recharge', group, scope: 'world',
  default: 2.5, min: 0.3, max: 15, step: 0.1,
})
