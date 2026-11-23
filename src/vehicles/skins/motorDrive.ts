/**
 * How hard each Mira hub motor is working, for the rotor/stator glow and sparks. Visual only:
 * it reads the buggy's public state and never feeds back into the physics.
 */
import { defineParam } from '../../../shared/params'

export interface MotorDriveInput {
  /** Smoothed throttle, -1..1 (MiraBuggy.inputSmoothed.y). */
  throttle: number
  /** Body speed along the nose, m/s, Unity sign (positive forward). */
  forwardSpeed: number
  /** Motor (rim) surface speed, m/s, same sign. */
  motorSpeed: number
  /** Speed at which the classic motor curve runs out of torque (VB 280: buggySpeed * 10). */
  topSpeed: number
  brakes: boolean
  /** Open wings cut motor torque to zero (VB 282). */
  wingsOpen: boolean
  grounded: boolean
  sliding: boolean
}

export interface MotorDrive {
  /** 0 idle or coasting, 1 flat out from rest. */
  effort: number
  /** True while the throttle opposes the motion, so the motor is braking (regeneration). */
  regen: boolean
}

/** Below this throttle the motor is idle, as MiraBuggy's THROTTLE_DEADZONE. */
const DEADZONE = 0.05
/** Throttle against motion only counts as regeneration above walking pace (REVERSE_SPEED). */
const REGEN_SPEED = 0.5

export function motorDrive(s: MotorDriveInput, out: MotorDrive = {effort: 0, regen: false}): MotorDrive {
  out.effort = 0; out.regen = false
  const y = s.throttle
  if (s.brakes || s.wingsOpen || Math.abs(y) < DEADZONE) return out
  if (Math.sign(y) !== Math.sign(s.forwardSpeed) && Math.abs(s.forwardSpeed) > REGEN_SPEED) {
    // Braking load scales with the speed being shed; quiet below a jog.
    out.regen = true
    out.effort = Math.abs(y) * Math.min(1, Math.abs(s.forwardSpeed) / 6)
    return out
  }
  // The classic motor's torque falls linearly to nothing at top speed (VB 280-285), so the
  // hardest work is full throttle from rest. A spinning tyre is the motor straining; an
  // unloaded wheel in the air is not.
  let effort = Math.abs(y) * (1 - Math.min(1, Math.abs(s.motorSpeed) / Math.max(1e-3, s.topSpeed)))
  if (s.sliding) effort += .25
  if (!s.grounded) effort *= .35
  out.effort = Math.min(1, Math.max(0, effort))
  return out
}

/** Quick to light, slower to fade, so the glow reads as heat rather than flicker. */
export function smoothEffort(previous: number, target: number, dt: number): number {
  const rate = target > previous ? 14 : 4
  return previous + (target - previous) * Math.min(1, dt * rate)
}

/**
 * Sparks fly only when a hub motor is at its hardest work (the owner, 17 November 2026): a
 * launch from rest or a steep climb, where speed is low for the throttle given, with the wheel
 * loaded on the ground. Not cruising, coasting, braking, regenerating, in the air or afloat.
 */
export const motorSparkLoad = defineParam({
  id: 'buggy.sparkLoad', label: 'Motor sparks from load', group: 'Buggy', scope: 'client',
  default: 0.75, min: 0.3, max: 1, step: 0.01,
})
/** Multiplies how many sparks a motor at full load throws. 0 turns them off. */
export const motorSparkAmount = defineParam({
  id: 'buggy.sparkAmount', label: 'Motor spark amount', group: 'Buggy', scope: 'client',
  default: 1, min: 0, max: 3, step: 0.05,
})

export interface MotorLoadInput {
  /** Throttle as pressed, -1..1, forward positive: a stamp on the pedal sparks at once. */
  throttle: number
  /** Body speed along the nose, m/s, forward positive. */
  forwardSpeed: number
  /** The buggy's flat-out speed on level ground at full throttle, m/s (buggy.speed). */
  topSpeed: number
  brakes: boolean
  wingsOpen: boolean
  /** This wheel is on the ground. */
  grounded: boolean
  /** The buggy is floating in water or lava. */
  afloat: boolean
}

/**
 * How close the motor is to its peak effort, 0..1: the throttle less the share of top speed
 * already reached in the throttle's direction. Full throttle from rest, or held while a climb
 * drags the buggy to a crawl or backwards, is 1; cruising near top speed is near 0, and a part
 * throttle can never reach more than itself. Computed from what every copy of a buggy has,
 * local, bot or remote (throttle and brakes are networked, speed comes from the body).
 */
export function motorLoad(s: MotorLoadInput): number {
  const y = s.throttle
  if (s.brakes || s.wingsOpen || !s.grounded || s.afloat || Math.abs(y) < DEADZONE) return 0
  // The reverse key while rolling forward regenerates: braking, not driving.
  if (y < 0 && s.forwardSpeed > REGEN_SPEED) return 0
  return Math.min(1, Math.max(0, Math.abs(y) - (s.forwardSpeed * Math.sign(y)) / Math.max(1e-3, s.topSpeed)))
}

/**
 * Spark level 0..1 for a motor at `load`, given the threshold: nothing below it, rising
 * smoothly to full over the rest of the range, so a load hovering at the threshold does not
 * flicker sparks on and off.
 */
export function sparkLevel(load: number, threshold: number): number {
  const top = Math.min(1, threshold + Math.max(.05, (1 - threshold) * .6))
  const t = Math.min(1, Math.max(0, (load - threshold) / Math.max(1e-3, top - threshold)))
  return t * t * (3 - 2 * t)
}

/** Sparks build within a tenth of a second and die over about a third. */
export function smoothSparks(previous: number, target: number, dt: number): number {
  const rate = target > previous ? 14 : 3
  return previous + (target - previous) * Math.min(1, dt * rate)
}
