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
