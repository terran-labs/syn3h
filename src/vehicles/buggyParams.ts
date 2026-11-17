/**
 * Buggy parameters, shared by the Syn3h buggy and the classic Mars Explorer buggy. Both games
 * used the same settings names and defaults (Mars Explorer Settings.js 92-105, Syn3h
 * CoreSettings.cs 38-50); slider ranges from Settings.js 926-991.
 */
import { defineParam } from '../../shared/params'
import { definePresets } from '../../shared/presets'

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
/**
 * Labelled "Stability" in the original: how low the centre of gravity sits. The stored value
 * is the original's (-0.1 high to -0.7 low, default -0.4, unchanged on the wire and in saved
 * rooms). The settings show it as -0.3 to +0.3 with 0 at the default and higher meaning more
 * stable, by the owner's request of 16 November 2026. "(weight)" keeps it apart from the
 * separate Stability assist.
 */
export const buggyCG = defineParam({
  id: 'buggy.cg', label: 'Stability (weight)', group: 'Buggy', scope: 'world',
  default: -0.4, min: -0.1, max: -0.7, step: 0.01, display: { offset: -0.4, scale: -1 },
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
/**
 * How the wings turn the buggy's motion toward its nose (the label lists the choices; the
 * settings panel shows them as buttons).
 * 0 Classic: Syn3h. From the first instant the wings are open, all of the buggy's speed points
 *   along its nose, whichever way it was moving.
 * 1 Catch: for the first second and a half after the wings open, the motion swings round to
 *   the nose at a rate that starts gentle and builds, so a buggy that was falling or sliding
 *   sweeps into flight instead of snapping. After that it is Classic.
 * 2 Glide: the wings always turn the motion at a rate that grows with speed, as lift does, so
 *   the buggy carves and slips through turns, loses speed climbing and gains it diving.
 */
export const buggyFlightModel = defineParam<number>({
  id: 'buggy.flightModel', label: 'Wing flight: 0 Classic, 1 Catch, 2 Glide', group: 'Buggy', scope: 'world',
  default: 1, min: 0, max: 2, step: 1,
})
/** "Stall blending": keep some sideslip in flight instead of snapping velocity to the nose. */
export const buggyFlightSlip = defineParam({
  id: 'buggy.flightSlip', label: 'Stall blending', group: 'Buggy', scope: 'world',
  default: true,
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
  default: 3.3, min: 0.2, max: 4, step: 0.01,
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
  default: 2.75, min: 0.5, max: 4, step: 0.05,
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
/**
 * Next-gen counter-steer assist. Steering range shrinks with speed so full lock cannot spin
 * the buggy, which also meant that once the body had slid a few degrees off its direction of
 * travel the front wheels could no longer be pointed back along it, and holding full
 * counter-steer held the slide. With this at 1 the front wheels swing toward the direction of
 * travel once the buggy slides more than a few degrees, and the driver's steering is added to
 * that. Normal cornering is unchanged. 0 is the old behaviour.
 */
export const buggySteerFollow = defineParam({
  id: 'buggy.steerFollow', label: 'Counter-steer assist', group: 'Buggy', scope: 'world',
  default: 0, min: 0, max: 1, step: 0.01,
})
/**
 * Next-gen rear steering at speed, as a fraction of the Syn3h rear angle. Syn3h steers the
 * rear wheels against the fronts at every speed (1), which tightens slow turns but makes the
 * tail step out at speed. 0 holds the rear wheels straight by the grip fade speed; negative
 * values steer them with the fronts there, as road cars with four wheel steering do.
 */
export const buggyRearSteerFast = defineParam({
  id: 'buggy.rearSteerFast', label: 'Rear steering at speed', group: 'Buggy', scope: 'world',
  default: 1, min: -1, max: 1, step: 0.05,
})
/**
 * Next-gen: the least grip a broadside tyre keeps, as a fraction of its grip at that speed,
 * except just after a landing. A buggy that lands sideways still slides and tumbles on
 * (buggy.sideGrip), but a slide that starts on the ground can be caught. 0 is the old
 * behaviour: any broadside tyre falls to buggy.sideGrip.
 */
export const buggySideHold = defineParam({
  id: 'buggy.sideHold', label: 'Grip kept in a slide', group: 'Buggy', scope: 'world',
  default: 0.5, min: 0, max: 1, step: 0.05,
})
/**
 * Next-gen aerodynamic downforce with the wheels down, in g at 40 m/s. It grows with speed
 * squared. Off by default: grip at speed is already three times the grip at rest, and with
 * the tail fin on, 0.3 g of it pressed the buggy onto its bump stops hard enough to flip it
 * over a 0.4 m bump at 42 m/s, where the owner wants a clean launch.
 */
export const buggyDownforce = defineParam({
  id: 'buggy.downforce', label: 'Downforce at speed (g)', group: 'Buggy', scope: 'world',
  default: 0, min: 0, max: 1, step: 0.05,
})
/**
 * Next-gen tail fin: a side force at the tail that grows with speed and turns the buggy to
 * point where it is going, on the ground and in the air. 0 is none.
 */
export const buggyFin = defineParam({
  id: 'buggy.fin', label: 'Tail fin', group: 'Buggy', scope: 'world',
  default: 0, min: 0, max: 3, step: 0.05,
})
/**
 * Whether the tail fin also acts with no wheel on the ground. On, it turns a buggy thrown into
 * the air toward its direction of travel (Sunday 15 November's behaviour), which the owner
 * found disturbing after a crash; off, the fin only helps catch a slide on the ground.
 */
export const buggyFinAir = defineParam({
  id: 'buggy.finAir', label: 'Tail fin in the air', group: 'Buggy', scope: 'world',
  default: false,
})
/**
 * Next-gen stability assist: damps the buggy's turning (per second) at speed while the
 * steering is let go and the wheels are down. Off by default: it also damps a drift the
 * driver wanted.
 */
export const buggyStability = defineParam({
  id: 'buggy.stability', label: 'Stability assist', group: 'Buggy', scope: 'world',
  default: 1, min: 0, max: 5, step: 0.1,
})

/**
 * Handling presets (the Handling dropdown in the Buggy settings). Each sets the same settings;
 * the defaults above are Balanced. Measured in the handling report (tools/handling-report.ts),
 * 16 November 2026. "Course change" is in one second at full lock.
 */
export const BUGGY_PRESETS = definePresets('Buggy', [
  {
    name: 'Balanced',
    description: 'Turns in sharper than it did before the assists, settles itself when you let go of the steering, and nothing acts on it in the air.',
    values: { 'buggy.steerFollow': 0, 'buggy.rearSteerFast': 1, 'buggy.sideHold': 0.5, 'buggy.fin': 0, 'buggy.finAir': false, 'buggy.stability': 1, 'buggy.steerLimit': 2.75, 'buggy.slide': 3.3, 'buggy.downforce': 0, 'buggy.flightSlip': true, 'buggy.flightModel': 1 },
  },
  {
    name: 'Planted',
    description: 'Easy to turn at speed and the wheels never steer themselves; a small fin on the ground helps catch a slide, and nothing acts in the air.',
    values: { 'buggy.steerFollow': 0, 'buggy.rearSteerFast': 0.6, 'buggy.sideHold': 0.7, 'buggy.fin': 0.4, 'buggy.finAir': false, 'buggy.stability': 0, 'buggy.steerLimit': 2.5, 'buggy.slide': 3.3, 'buggy.downforce': 0, 'buggy.flightSlip': true, 'buggy.flightModel': 1 },
  },
  {
    name: 'Classic',
    description: 'How it drove before the assists (Saturday 14 November): the tail steps out in a turn, and a slide is caught by letting go, not by counter-steering.',
    values: { 'buggy.steerFollow': 0, 'buggy.rearSteerFast': 1, 'buggy.sideHold': 0, 'buggy.fin': 0, 'buggy.finAir': false, 'buggy.stability': 0, 'buggy.steerLimit': 2, 'buggy.slide': 3, 'buggy.downforce': 0, 'buggy.flightSlip': false, 'buggy.flightModel': 0 },
  },
  {
    name: 'Direct',
    description: 'No assists at all: the wheels do only what you say and nothing acts in the air. On the ground it drives as Classic does; the wings use stall blending.',
    values: { 'buggy.steerFollow': 0, 'buggy.rearSteerFast': 1, 'buggy.sideHold': 0, 'buggy.fin': 0, 'buggy.finAir': false, 'buggy.stability': 0, 'buggy.steerLimit': 2, 'buggy.slide': 3, 'buggy.downforce': 0, 'buggy.flightSlip': true, 'buggy.flightModel': 1 },
  },
  {
    name: 'Assisted',
    description: 'Sunday 15 November: a tail fin and counter-steer assist catch any slide, but it is heavy to turn at speed, the wheels steer themselves, and it straightens in the air.',
    values: { 'buggy.steerFollow': 1, 'buggy.rearSteerFast': 0, 'buggy.sideHold': 0.5, 'buggy.fin': 1, 'buggy.finAir': true, 'buggy.stability': 0, 'buggy.steerLimit': 2, 'buggy.slide': 3, 'buggy.downforce': 0, 'buggy.flightSlip': false, 'buggy.flightModel': 1 },
  },
])
