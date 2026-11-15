/**
 * Buggy parameters, shared by the Syn3h buggy and the classic Mars Explorer buggy. Both games
 * used the same settings names and defaults (Mars Explorer Settings.js 92-105, Syn3h
 * CoreSettings.cs 38-50); slider ranges from Settings.js 926-991.
 */
import { defineParam } from '../../shared/params'

export const buggyPower = defineParam({
  id: 'buggy.power', label: 'Power', group: 'Buggy', scope: 'world',
  default: 1, min: 0.5, max: 1.5, step: 0.01,
})
export const buggySpeed = defineParam({
  id: 'buggy.speed', label: 'Speed', group: 'Buggy', scope: 'world',
  default: 30, min: 5, max: 55, step: 0.5,
})
export const buggyTraction = defineParam({
  id: 'buggy.traction', label: 'Traction', group: 'Buggy', scope: 'world',
  default: 1, min: 0.1, max: 1.9, step: 0.01,
})
export const buggyShocks = defineParam({
  id: 'buggy.shocks', label: 'Shocks', group: 'Buggy', scope: 'world',
  default: 70, min: 20, max: 120, step: 1,
})
/** Defined and synced like the original, but its slider was commented out and nothing reads it. */
export const buggySlip = defineParam({
  id: 'buggy.slip', label: 'Slip', group: 'Buggy', scope: 'world',
  default: 50, min: 20, max: 80, step: 1,
})
/** Labelled "Stability" in the original. The slider runs high to low (Settings.js 944). */
export const buggyCG = defineParam({
  id: 'buggy.cg', label: 'Stability (CG)', group: 'Buggy', scope: 'world',
  default: -0.4, min: -0.1, max: -0.7, step: 0.01,
})
/** Only the unused "new physics" path reads this (Buggy.js 337). Kept for parity. */
export const buggyAWD = defineParam({
  id: 'buggy.awd', label: 'All wheel drive', group: 'Buggy', scope: 'world',
  default: true,
})
export const buggySmartSuspension = defineParam({
  id: 'buggy.smartSuspension', label: 'Smart suspension', group: 'Buggy', scope: 'world',
  default: true,
})
export const buggyFlightDrag = defineParam({
  id: 'buggy.flightDrag', label: 'Flight drag', group: 'Buggy', scope: 'world',
  default: 300, min: 50, max: 550, step: 1,
})
export const buggyFlightAgility = defineParam({
  id: 'buggy.flightAgility', label: 'Flight agility', group: 'Buggy', scope: 'world',
  default: 1, min: 0.5, max: 1.5, step: 0.01,
})
/** "Stall blending": keep some sideslip in flight instead of snapping velocity to the nose. */
export const buggyFlightSlip = defineParam({
  id: 'buggy.flightSlip', label: 'Stall blending', group: 'Buggy', scope: 'world',
  default: false,
})
/** "Powered loops": the nose speed boost also applies at full stick. */
export const buggyFlightLooPower = defineParam({
  id: 'buggy.flightLooPower', label: 'Powered loops', group: 'Buggy', scope: 'world',
  default: false,
})
/**
 * Syn3h VhiclMe.cs auto brake: with no input at all and speed under 1 m/s, brakes engage, which
 * parks the buggy through the brake drag state. Off gives Mars Explorer's free rolling.
 */
export const buggyIdleHold = defineParam({
  id: 'buggy.idleHold', label: 'Idle hold', group: 'Buggy', scope: 'world',
  default: true,
})

// ---- Next-gen tyre model (Syn3h buggy only; new, not from either original) ----------------

/**
 * Next-gen physics: each wheel holds with static friction up to grip x load, and gives up a
 * fifth of that once it is sliding. Off restores the classic Syn3h wheel equations
 * (VhiclBuggy.cs 280-332), whose friction is a pure damper on slip speed.
 */
export const buggyNextGen = defineParam({
  id: 'buggy.nextGen', label: 'Next-gen physics', group: 'Buggy', scope: 'world',
  default: true,
})
/** Friction coefficient at low speed: how hard a tyre holds before it lets go. */
export const buggyGrip = defineParam({
  id: 'buggy.grip', label: 'Grip at low speed', group: 'Buggy', scope: 'world',
  default: 1.2, min: 0.3, max: 2, step: 0.01,
})
/**
 * Friction coefficient at the grip fade speed and above. Classic Syn3h friction had no ceiling,
 * so it could change direction at speed far harder than a real tyre; this is what lets next-gen
 * do the same. (The id is from when this was the sliding coefficient.)
 */
export const buggySlide = defineParam({
  id: 'buggy.slide', label: 'Grip at high speed', group: 'Buggy', scope: 'world',
  default: 3, min: 0.2, max: 4, step: 0.01,
})
/** Speed (m/s) by which grip has gone from its low speed to its high speed value. */
export const buggyGripFade = defineParam({
  id: 'buggy.gripFade', label: 'High speed from (m/s)', group: 'Buggy', scope: 'world',
  default: 30, min: 5, max: 80, step: 1,
})
/**
 * Next-gen steering limit at speed, as a multiple of what the tyres can hold. Up to half the
 * grip fade speed full lock asks for 1.1 times the grip, so it corners without sliding. From
 * there to the fade speed that loosens to this value: 1 grips, higher breaks into a drift. The
 * classic Syn3h angles are always the ceiling.
 */
export const buggySteerLimit = defineParam({
  id: 'buggy.steerLimit', label: 'Steering at speed (x grip)', group: 'Buggy', scope: 'world',
  default: 2, min: 0.5, max: 4, step: 0.05,
})
/** Next-gen regen braking on the reverse key while rolling forward, in g at full key. */
export const buggyRegen = defineParam({
  id: 'buggy.regen', label: 'Regen braking (g)', group: 'Buggy', scope: 'world',
  default: 0.6, min: 0.1, max: 1.2, step: 0.01,
})
/** Next-gen drivetrain drag when coasting off throttle, per second of motor speed. */
export const buggyCoastDrag = defineParam({
  id: 'buggy.coastDrag', label: 'Coast drag', group: 'Buggy', scope: 'world',
  default: 0.2, min: 0, max: 2, step: 0.01,
})
/**
 * Next-gen ride height at speed: the suspension travel (m) the smart suspension lowers to at
 * buggy.speed. Syn3h used 0.1, which leaves little room before the body hits the ground.
 */
export const buggyRideHeight = defineParam({
  id: 'buggy.rideHeight', label: 'Ride height at speed', group: 'Buggy', scope: 'world',
  // 0.1 is the Syn3h value: little travel at speed, so hills and bumps throw the buggy into the
  // air. The owner asked for that back on 14 November 2026; 0.25 soaks bumps up instead.
  default: 0.1, min: 0.1, max: 0.4, step: 0.01,
})
/**
 * Next-gen progressive bump stop: extra spring and damping over the last 0.2 m before the body
 * would hit the ground, in multiples of the main spring at full compression. 0 turns it off.
 */
export const buggyBumpStop = defineParam({
  id: 'buggy.bumpStop', label: 'Bump stop', group: 'Buggy', scope: 'world',
  // Soft enough to let a bump launch the buggy, firm enough to catch a landing.
  default: 0.7, min: 0, max: 2.5, step: 0.05,
})
/**
 * Next-gen rebound damping, as a multiple of the compression damping set by Shocks. Higher
 * values stop the springs throwing the buggy upward after a bump; 1 is the Syn3h damper.
 */
export const buggyRebound = defineParam({
  id: 'buggy.rebound', label: 'Rebound damping', group: 'Buggy', scope: 'world',
  // 1 lets the springs throw the buggy upward off a crest, as Syn3h did. 3 keeps it planted.
  default: 1, min: 1, max: 4, step: 0.1,
})
/**
 * Next-gen friction coefficient for a tyre travelling broadside at speed (slip angle past about
 * 70 degrees). Low values let the buggy slide and tumble on when it lands or spins sideways;
 * set it to the high speed grip to make broadside tyres bite as hard as steering ones.
 */
export const buggySideGrip = defineParam({
  id: 'buggy.sideGrip', label: 'Grip when sideways', group: 'Buggy', scope: 'world',
  default: 0.6, min: 0.1, max: 4, step: 0.05,
})
