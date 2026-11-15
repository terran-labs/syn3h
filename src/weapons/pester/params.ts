/**
 * Pesters: slow, wobbly plasma orbs that chase another player and tag them if they catch up.
 * World scope; free of Three.js so the room server can import and check them.
 */
import { defineParam } from '../../../shared/params'

const group = 'Gear: Chaser'

/** Available on the normal entry; the host can still turn it off for the room. */
export const pesterAllowed = defineParam({
  id: 'pester.allowed', label: 'Chaser', group, scope: 'world', default: true,
})

/** Top speed, m/s. Below a buggy's, so a good driver can outrun one. */
export const pesterSpeed = defineParam({
  id: 'pester.speed', label: 'Chaser speed', group, scope: 'world',
  default: 24, min: 5, max: 60, step: 1,
})

/** How quickly it turns toward its target, 1/s. Low values swing wide and can be dodged. */
export const pesterTurn = defineParam({
  id: 'pester.turn', label: 'Chaser agility', group, scope: 'world',
  default: 1.6, min: 0.2, max: 6, step: 0.1,
})

/** Seconds a Pester chases before it pops. */
export const pesterLife = defineParam({
  id: 'pester.life', label: 'Chaser stamina', group, scope: 'world',
  default: 8, min: 2, max: 12, step: 0.5,
})

/** How far away a target can be chosen. */
export const pesterRange = defineParam({
  id: 'pester.range', label: 'Chaser range', group, scope: 'world',
  default: 150, min: 20, max: 400, step: 5,
})

/** Most Pesters one player may have out at once. */
export const pesterMax = defineParam({
  id: 'pester.max', label: 'Chasers at once', group, scope: 'world',
  default: 3, min: 1, max: 6, step: 1,
})

/** Seconds between launches. */
export const pesterCooldown = defineParam({
  id: 'pester.cooldown', label: 'Chaser recharge', group, scope: 'world',
  default: 1.2, min: 0.3, max: 10, step: 0.1,
})

/** How close counts as caught, metres from the vehicle's centre. */
export const pesterRadius = defineParam({
  id: 'pester.radius', label: 'Chaser reach', group, scope: 'world',
  default: 2.4, min: 1, max: 5, step: 0.1,
})

/** Bump a caught vehicle gets, m/s. Capped by the caught player's own client. */
export const pesterBump = defineParam({
  id: 'pester.bump', label: 'Chaser bump', group, scope: 'world',
  default: 5, min: 0, max: 15, step: 0.5,
})

/** The cloud's colour, as a hue in degrees: 200 is light blue. Shared by the room. */
export const pesterHue = defineParam({
  id: 'pester.hue', label: 'Chaser colour', group, scope: 'world',
  default: 200, min: 0, max: 360, step: 1,
})

/** How big the cloud is, metres from its centre to the edge of the swarm. Looks only. */
export const pesterSize = defineParam({
  id: 'pester.size', label: 'Chaser size', group, scope: 'world',
  default: 1.5, min: 0.4, max: 3, step: 0.05,
})

/** How bright the cloud glows. */
export const pesterGlow = defineParam({
  id: 'pester.glow', label: 'Chaser glow', group, scope: 'world',
  default: 1, min: 0.2, max: 3, step: 0.05,
})
