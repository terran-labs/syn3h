/**
 * Pilot for anything that steers with x and drives with y on the ground: both buggies and
 * the tank. It holds a speed, slows into corners, comes to rest when asked, and backs out
 * when it stops making progress. It never touches the rigid body; it only writes controls.
 */
import { Quaternion, Vector3 } from 'three/webgpu'
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { DriveGoal, NavProfile, Pilot, PilotStatus } from './types'

export const GROUND_PROFILE: NavProfile = { maxGrade: 0.45, liquid: 'blocked', flies: false, roadCost: 0.35, cruiseAltitude: 0 }

const clamp = (x: number, max = 1) => Math.max(-max, Math.min(max, x))
/** Heading error that asks for full lock, radians (the originals used 20 degrees). */
const FULL_LOCK = 0.35
/** Seconds between progress checks, and metres that count as progress (VhiclBot.cs 63-74). */
const CHECK = 1.5
const PROGRESS = 1

/** Turning radius the buggy holds at full lock and low speed, metres: curvature times this is the wheel. */
const TURN_RADIUS = 7
/** Move `value` toward `target` by at most `step`. */
const approach = (value: number, target: number, step: number) => value + Math.max(-step, Math.min(step, target - value))

/** Positive means the target is to the right. Forward is -Z; positive input.x turns right. */
export function headingError(forward: { x: number; z: number }, delta: { x: number; z: number }): number {
  return Math.atan2(forward.x * delta.z - forward.z * delta.x, forward.x * delta.x + forward.z * delta.z)
}

export function createGroundPilot(vehicle: Vehicle): Pilot {
  const q = new Quaternion(), forward = new Vector3(), up = new Vector3()
  const status: PilotStatus = { stuckFor: 0, airborne: false, flipped: false }
  let checkTime = 0, reverseTime = 0, brakeTime = 0, lastX = NaN, lastZ = NaN
  // What the driver's hands and feet are doing now; controls move toward what is wanted.
  let steer = 0, throttle = 0, braking = false
  return {
    profile: GROUND_PROFILE,
    reset() { status.stuckFor = 0; checkTime = reverseTime = brakeTime = 0; lastX = lastZ = NaN; steer = throttle = 0; braking = false },
    drive(goal: DriveGoal, input: InputState, dt: number): PilotStatus {
      const here = vehicle.body.translation(), v = vehicle.body.linvel()
      q.copy(vehicle.body.rotation())
      forward.set(0, 0, -1).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q)
      const flat = Math.hypot(forward.x, forward.z) || 1
      const forwardSpeed = (v.x * forward.x + v.z * forward.z) / flat, speed = Math.hypot(v.x, v.z)
      const dx = goal.x - here.x, dz = goal.z - here.z, distance = Math.hypot(dx, dz)
      const error = headingError(forward, { x: dx, z: dz })
      status.flipped = up.y < 0.2
      status.airborne = vehicle.wheelsGrounded === 0
      input.x = input.y = input.z = input.w = 0
      input.brakes = input.fire = false
      input.special = Boolean(goal.special)
      if (Number.isNaN(lastX)) { lastX = here.x; lastZ = here.z }

      if (goal.stopWithin !== undefined && distance <= goal.stopWithin) {
        // Arrived: hold still. Standing here on purpose is not being stuck.
        input.brakes = true
        status.stuckFor = 0; checkTime = 0; reverseTime = 0; lastX = here.x; lastZ = here.z
        return status
      }

      // Corners cost speed, but keep steerage way: a crawling buggy cannot turn at all.
      let target = Math.max(0, goal.speed) * (1 - 0.6 * Math.min(1, Math.abs(error)))
      target = Math.max(target, Math.min(goal.speed, 4))
      // Shed speed early enough to stop inside the radius (about 3 m/s^2 of braking).
      if (goal.stopWithin !== undefined) target = Math.min(target, Math.sqrt(6 * Math.max(0.5, distance - goal.stopWithin * 0.5)))

      checkTime += dt
      if (checkTime >= CHECK) {
        const moved = Math.hypot(here.x - lastX, here.z - lastZ)
        if (moved < PROGRESS && !status.flipped) {
          status.stuckFor += checkTime
          // Back out with the wheels turned the other way, braking first so the drivetrain
          // is not asked to reverse against spinning wheels.
          if (reverseTime <= 0 && !goal.noReverse) { reverseTime = CHECK; brakeTime = 0.35 }
        } else if (reverseTime <= 0) status.stuckFor = 0
        checkTime = 0; lastX = here.x; lastZ = here.z
      }
      // Told mid manoeuvre that there is nothing safe behind: stop backing up at once.
      if (goal.noReverse) reverseTime = 0
      if (reverseTime > 0) {
        reverseTime -= dt
        steer = approach(steer, clamp(-error / FULL_LOCK), 3 * dt); throttle = 0
        input.y = -0.8; input.x = steer
        if (brakeTime > 0) { brakeTime -= dt; input.brakes = true }
        return status
      }

      if (status.airborne) { input.y = throttle = 0.3; input.x = steer = approach(steer, 0, 2 * dt); return status }
      // Steer the way a driver does: by the arc that reaches the aim point (pure pursuit),
      // not by the heading error itself. The curvature of that arc is 2 sin(error) / distance,
      // so a far aim point asks for a little wheel and a near one for a lot, and the wheel
      // comes off smoothly as the car lines up instead of snapping across centre.
      // The arc is drawn to a point a look ahead distance along the bearing, never to a far
      // destination itself: the arc that reaches something 150 m away barely turns at all,
      // and the car would drift wide of its line for the whole way there.
      const reach = Math.max(6, Math.min(distance, Math.max(10, speed * 1.2)))
      const curvature = Math.abs(error) > Math.PI / 2 ? Math.sign(error) / TURN_RADIUS : 2 * Math.sin(error) / reach
      // Less lock at speed: full lock at 20 m/s spins the buggy.
      const lock = speed < 8 ? 1 : Math.max(0.35, 8 / speed)
      const wanted = Math.abs(error) < 0.02 ? 0 : clamp(curvature * TURN_RADIUS, lock)
      // Hands move at a finite rate, slower at speed: about a third of a second lock to
      // centre when parking, most of a second at 20 m/s.
      steer = approach(steer, wanted, (speed < 20 ? 3.2 - speed * 0.085 : 1.5) * dt)
      input.x = steer
      // Feet too: squeeze the throttle on, come off it a little quicker.
      const delta = target - forwardSpeed
      const pedal = delta > 0 ? Math.min(1, 0.15 + delta * 0.4) : 0
      throttle = approach(throttle, pedal, (pedal > throttle ? 2.5 : 5) * dt)
      input.y = throttle
      // Brake with some hysteresis, so it does not flutter on and off around the target speed.
      braking = braking ? delta < -1 : delta < -2.5
      input.brakes = braking
      return status
    },
  }
}
