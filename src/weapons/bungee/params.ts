/**
 * Bungee settings. World scope: the host sets them for the room. Kept free of Three.js so
 * the room server can import and validate them. Players see "gear"; ids keep "bungee".
 */
import { defineParam } from '../../../shared/params'

const group = 'Gear: Grapple'

/** Available on the normal entry; the host can still turn it off for the room. */
export const bungeeAllowed = defineParam({
  id: 'bungee.allowed', label: 'Grapple', group, scope: 'world', default: true,
})

/** Longest the cord may be, and the hook's reach. */
export const bungeeLength = defineParam({
  id: 'bungee.length', label: 'Cord length', group, scope: 'world',
  default: 120, min: 10, max: 300, step: 1,
})

/** Shortest a cord reels in to, so two vehicles on one cord stay apart. */
export const bungeeMinLength = defineParam({
  id: 'bungee.minLength', label: 'Shortest cord', group, scope: 'world',
  default: 4, min: 1, max: 30, step: 0.5,
})

export const bungeeHookSpeed = defineParam({
  id: 'bungee.hookSpeed', label: 'Hook speed', group, scope: 'world',
  default: 160, min: 40, max: 340, step: 1,
})

/**
 * Natural frequency of the stretched cord, rad/s. Soft by design: the period at the default
 * is about 4.5 s, long against network lag. The range is what tests/weapons/rope.test.ts
 * proves stable at 250 ms of lag.
 */
export const bungeeStiffness = defineParam({
  id: 'bungee.stiffness', label: 'Cord stiffness', group, scope: 'world',
  default: 1.4, min: 0.5, max: 3, step: 0.05,
})

/** Damping ratio along the cord. 1 stops the bounce at once; low values boing. */
export const bungeeDamping = defineParam({
  id: 'bungee.damping', label: 'Cord damping', group, scope: 'world',
  default: 0.7, min: 0.3, max: 2, step: 0.05,
})

/**
 * Most pull the cord gives, in multiples of Earth gravity. Above 1 a cord can lift a vehicle.
 * Between two vehicles each end gets about half (the pair's reduced mass), so the default is
 * high enough that a tow still beats a parked vehicle's tyre grip.
 */
export const bungeeMaxPull = defineParam({
  id: 'bungee.maxPull', label: 'Cord strength', group, scope: 'world',
  default: 4, min: 0.5, max: 6, step: 0.1,
})

export const bungeeReelSpeed = defineParam({
  id: 'bungee.reelSpeed', label: 'Reel speed', group, scope: 'world',
  default: 14, min: 1, max: 40, step: 0.5,
})

/** Seconds a cord stays attached. 0 keeps it until the player lets go. */
export const bungeeTimeout = defineParam({
  id: 'bungee.timeout', label: 'Cord lets go after (0 = never)', group, scope: 'world',
  default: 0, min: 0, max: 30, step: 0.5,
})

/** Seconds after letting go before the next hook. */
export const bungeeCooldown = defineParam({
  id: 'bungee.cooldown', label: 'Hook recharge', group, scope: 'world',
  default: 0.4, min: 0, max: 5, step: 0.1,
})

/** A cord stretched past this many times its length lets go by itself. */
export const bungeeSnap = defineParam({
  id: 'bungee.snap', label: 'Cord gives way at stretch', group, scope: 'world',
  default: 2, min: 1.2, max: 5, step: 0.1,
})

/** Whether a hook may catch other vehicles, or only the ground. */
export const bungeeVehicles = defineParam({
  id: 'bungee.vehicles', label: 'Hook catches vehicles', group, scope: 'world', default: true,
})

/**
 * Looks only, each player's own: how long a let-go cord takes to whip back and fade, in
 * seconds (0 for none), and how long a hook that missed takes to sail away with its cord.
 */
export const grappleReleaseTime = defineParam({
  id: 'fx.grapple.release', label: 'Let-go cord fades over (s)', group, scope: 'world',
  default: 0.7, min: 0, max: 3, step: 0.05,
})
export const grappleSailTime = defineParam({
  id: 'fx.grapple.sail', label: 'Missed hook sails for (s)', group, scope: 'world',
  default: 1.2, min: 0, max: 4, step: 0.05,
})
