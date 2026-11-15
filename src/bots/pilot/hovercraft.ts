/**
 * Hovercraft pilot: drives the hovercraft by writing its InputState.
 *
 * Control signs with glide assistance on (hover.assist 1), measured in
 * tests/bots/pilot/signs.test.ts:
 *   input.y 0..1  thrust toward the nose. There is no reverse.
 *   input.x > 0   turns right: it sets a yaw rate, full input is hover.turnRate (70 deg/s).
 *   brakes        decay all horizontal speed (90 percent in hover.brakeTime), and while held
 *                 there is no thrust and no sideways grip.
 * Sideways grip is weak (hover.grip, 1.5 per second), so the craft slides like a puck.
 *
 * Steering therefore aims the nose at 2 * wanted velocity - current velocity: when the craft
 * drifts to one side of its track the nose leans the other way, so thrust cancels the drift
 * instead of the craft orbiting the point. Speed is capped by distance and by how sharp the
 * turn to the point is, so it can always turn inside the remaining distance, and it brakes
 * when it is much too fast. Inside `stopWithin` it brakes to rest and holds with small nudges.
 * Pushing into a slope it cannot climb, it backs off downhill and around, and counts
 * stuckFor so the mind can choose another route.
 */
import * as THREE from 'three/webgpu'
import type { InputState } from '../../core/Input'
import { hoverAssist, hoverThrust, hoverTurnRate } from '../../vehicles/Hovercraft'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'
import type { DriveGoal, NavProfile, Pilot, PilotStatus } from './types'

/** Tuning, shared by every hovercraft pilot. Values a lead might put on sliders. */
export const hovercraftPilotTuning = {
  /** Heading error, radians, that asks for full steering. Smaller is sharper but twitchier. */
  fullSteerAngle: .45,
  /** Fraction of the full turn rate the speed cap assumes is available for corners. */
  cornerTurnShare: .7,
  /** Slowest speed the corner cap allows, m/s. */
  minCornerSpeed: 4,
  /** Wanted speed per metre of remaining distance when stopping, per second. */
  stopGain: .7,
  /** Brake when this many m/s faster than wanted. */
  brakeMargin: 3,
  /** Velocity error to thrust gain, per second. */
  speedGain: 1.2,
  /** Seconds without getting a metre closer before backing off. */
  stuckBackOff: 1.5,
  /** Seconds spent backing off before trying again. */
  backOffTime: 2.5,
  /** Extra seconds a retry gets to turn back toward the goal before it counts as stuck. */
  retryGrace: 3,
}

const clamp = THREE.MathUtils.clamp
/** Positive means turn right. Forward is -Z; positive rotation about +Y turns left. */
const headingError = (fx: number, fz: number, dx: number, dz: number) => Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz)

export function createHovercraftPilot(vehicle: Vehicle, terrain: Terrain): Pilot {
  const profile: NavProfile = { maxGrade: .55, liquid: 'surface', flies: false, roadCost: .6, cruiseAltitude: 0 }
  const status: PilotStatus = { stuckFor: 0, airborne: false, flipped: false }
  const q = new THREE.Quaternion(), forward = new THREE.Vector3(), up = new THREE.Vector3(), normal = new THREE.Vector3()
  let best = Infinity, goalX = NaN, goalZ = NaN
  let holding = false
  // Back off state. `tryBest` and `tryTime` measure the current attempt only, so a retry that
  // starts further away than the best ever distance still gets a fair try.
  let backOff = 0, backOffX = 0, backOffZ = 0, tryBest = Infinity, tryTime = 0

  const surface = (x: number, z: number) => Math.max(terrain.heightAt(x, z), terrain.liquidHeightAt?.(x, z) ?? -Infinity)

  function drive(goal: DriveGoal, input: InputState, dt: number): PilotStatus {
    const tune = hovercraftPilotTuning
    const body = vehicle.body
    const p = body.translation(), v = body.linvel()
    q.copy(body.rotation())
    forward.set(0, 0, -1).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q)
    const fLen = Math.hypot(forward.x, forward.z) || 1
    const fx = forward.x / fLen, fz = forward.z / fLen
    const vx = v.x, vz = v.z, speedNow = Math.hypot(vx, vz)
    input.special = false; input.fire = false; input.z = 0; input.w = 0
    input.x = 0; input.y = 0; input.brakes = false

    const assisted = hoverAssist.value > 0
    status.flipped = up.y < .3
    status.airborne = assisted ? vehicle.wheelsGrounded === 0 : p.y - surface(p.x, p.z) > 30

    const dx = goal.x - p.x, dz = goal.z - p.z, dist = Math.hypot(dx, dz)
    const ux = dist > 1e-3 ? dx / dist : fx, uz = dist > 1e-3 ? dz / dist : fz
    const accel = hoverThrust.value / body.mass()
    const turnRate = hoverTurnRate.value * Math.PI / 180

    // Progress bookkeeping first: the back off below depends on it.
    if (!(Math.hypot(goal.x - goalX, goal.z - goalZ) <= 5)) { goalX = goal.x; goalZ = goal.z; best = dist; status.stuckFor = 0; holding = false; tryBest = dist; tryTime = 0; backOff = 0 }
    const stop = goal.stopWithin
    if (stop !== undefined) {
      // Hysteresis: settle once well inside, go back only when drifting near the edge.
      if (dist < stop * .7) holding = true
      else if (dist > stop * .95) holding = false
    } else holding = false
    // Within a few metres of a pass-through point it has arrived; that is not being stuck.
    // Closing on the goal at walking pace or better is progress even between whole metres.
    // So is swinging round to face it: there is no reverse, so a big turn comes first.
    const facingErr = headingError(fx, fz, ux, uz)
    const closing = vx * ux + vz * uz > .5 || (Math.abs(facingErr) > .6 && -Math.sign(facingErr) * body.angvel().y > .3)
    if (holding || closing || dist < best - 1 || dist < 4) { best = Math.min(best, dist); status.stuckFor = 0 }
    else status.stuckFor += dt
    if (holding || closing || dist < tryBest - 1 || dist < 4) { tryBest = Math.min(tryBest, dist); tryTime = 0 }
    else if (backOff <= 0) tryTime += dt

    if (holding) {
      // At rest inside the radius: brake off any motion, keep the heading.
      input.brakes = speedNow > .3
      return status
    }

    if (backOff <= 0 && tryTime > tune.stuckBackOff) {
      // Back off downhill and to one side of the goal, so the retry comes in on a new line.
      const n = terrain.normalAt(p.x, p.z, normal)
      let ax = n.x, az = n.z
      const len = Math.hypot(ax, az)
      if (len < .05) { ax = -ux; az = -uz } else { ax /= len; az /= len }
      // Pick the side of the goal line the craft already leans to; fall back to the right.
      const side = Math.sign(fx * uz - fz * ux) || 1
      backOffX = ax * .7 + uz * side * .7; backOffZ = az * .7 - ux * side * .7
      backOff = tune.backOffTime
    }

    let wantX: number, wantZ: number
    if (backOff > 0) {
      backOff -= dt
      // The next attempt is judged from wherever it starts.
      // It cannot reverse, so it needs time to turn back toward the goal: start the clock negative.
      if (backOff <= 0) { tryBest = dist; tryTime = -tune.retryGrace }
      wantX = backOffX * 8; wantZ = backOffZ * 8
    } else {
      // Speed: the goal's, capped for the stop and for the turn still to make.
      let speed = Math.max(0, goal.speed)
      if (stop !== undefined) speed = Math.min(speed, Math.max(1.5, (dist - stop * .3) * tune.stopGain))
      const ref = speedNow > 2 ? headingError(vx / speedNow, vz / speedNow, ux, uz) : headingError(fx, fz, ux, uz)
      const turn = Math.abs(ref)
      // Turning through `turn` at rate w covers an arc of radius speed / w; keep it inside dist.
      const corner = turnRate * tune.cornerTurnShare * dist / Math.max(.3, 2 * Math.sin(Math.min(turn, Math.PI / 2)))
      speed = Math.min(speed, Math.max(tune.minCornerSpeed, corner))
      wantX = ux * speed; wantZ = uz * speed
    }

    // Aim at 2 * wanted - current: leans against drift, so thrust cancels it.
    // Slow (a stop, or the start of a turn) it simply faces the point, or the lean against
    // drift would swing the nose round while it brakes.
    const slow = Math.hypot(wantX, wantZ) < 3
    const aimX = slow ? ux : 2 * wantX - vx, aimZ = slow ? uz : 2 * wantZ - vz
    const aimLen = Math.hypot(aimX, aimZ)
    const err = aimLen > .2 ? headingError(fx, fz, aimX / aimLen, aimZ / aimLen) : 0
    input.x = clamp(err / tune.fullSteerAngle, -1, 1)

    // Thrust along the nose toward the wanted velocity, plus drag feed forward; less when misaligned.
    const along = (wantX - vx) * fx + (wantZ - vz) * fz
    const wantSpeed = Math.hypot(wantX, wantZ)
    const align = Math.max(0, Math.cos(err))
    input.y = clamp((along * tune.speedGain + .2 * wantSpeed) / accel * align * align, 0, 1)
    // Much too fast for what is wanted (a sharp corner or the stop): brake.
    const fastBy = (vx * ux + vz * uz) - wantSpeed
    input.brakes = backOff <= 0 && (fastBy > tune.brakeMargin || (speedNow > wantSpeed + tune.brakeMargin && Math.abs(err) > 1.2))
    if (input.brakes) input.y = 0
    return status
  }

  function reset(): void {
    best = Infinity; goalX = NaN; goalZ = NaN; holding = false; backOff = 0; tryBest = Infinity; tryTime = 0
    status.stuckFor = 0; status.airborne = false; status.flipped = false
  }

  return { profile, drive, reset }
}
