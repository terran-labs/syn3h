/**
 * How hard each Syn3h hub motor is working, for the rotor/stator glow and sparks. Visual only:
 * it reads the buggy's public state and never feeds back into the physics.
 */
export interface MotorDriveInput {
  /** Smoothed throttle, -1..1 (Syn3hBuggy.inputSmoothed.y). */
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

/** Below this throttle the motor is idle, as Syn3hBuggy's THROTTLE_DEADZONE. */
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
