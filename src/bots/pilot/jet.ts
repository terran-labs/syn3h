/**
 * Jet pilot: flies the jet in hover mode (input.special false) by writing its InputState.
 *
 * Control signs in hover mode, measured in tests/bots/pilot/signs.test.ts:
 *   input.y > 0   pitches the nose down, so the lift vector leans forward and it accelerates
 *                 toward its nose (-Z when unturned).
 *   input.x > 0   rolls right and also yaws right: it slides to its right.
 *   input.w > 0   yaws right only. The jet sums x + w for yaw, so roll without yaw is
 *                 x = r, w = -r.
 *   input.z       lift along the craft's own up axis at 2 * weight * z. 0.5 balances weight
 *                 when level. Exactly 0 hands control to the jet's built in altitude hold,
 *                 which this pilot never does: it always writes a small positive value instead.
 *
 * The pilot is a cascade, all in world space:
 *   position error  -> wanted velocity (cruise speed, or a stopping profile near the goal)
 *   velocity error  -> wanted acceleration, plus feed forward for the jet's quadratic drag
 *   acceleration    -> wanted up vector (lean toward the acceleration) and lift (input.z)
 *   attitude error  -> torque, converted to input.y and input.x through the jet's known
 *                      torque per unit input, with its self righting torque cancelled
 * Heading is controlled separately on input.w: the nose follows the wanted direction of travel.
 */
import * as THREE from 'three/webgpu'
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'
import type { DriveGoal, NavProfile, Pilot, PilotStatus } from './types'

/** Tuning, shared by every jet pilot. Values a lead might put on sliders. */
export const jetPilotTuning = {
  /** Default cruise height above ground or liquid, metres (body origin). */
  cruiseAltitude: 12,
  /** Steepest lean the pilot will command, degrees. More is faster but less gentle. */
  maxTilt: 22,
  /** Horizontal acceleration available for stopping, m/s^2; shapes the arrival profile. */
  stopAccel: 1.8,
  /** Seconds of travel subtracted from the remaining distance when slowing to a stop. */
  stopLead: .8,
  /** Seconds the commanded lean takes to follow a change; higher is gentler. */
  leanTime: .35,
  /** How hard velocity error turns into acceleration, per second. */
  velocityGain: 1.1,
  /** Attitude loop natural frequency, rad/s, and damping ratio. */
  attitudeFrequency: 3,
  attitudeDamping: 1.1,
  /** Climb and sink limits, m/s, and the height error to vertical speed gain, per second. */
  maxClimb: 9,
  maxSink: 6,
  heightGain: 1.1,
  /** Seconds of travel ahead along the velocity scanned for rising ground. */
  lookAheadTime: 4,
  /** Seconds ahead the followed surface is read, to cancel the climb lag. */
  leadTime: .6,
  /**
   * Fastest commanded turn, rad/s, and heading error to turn rate gain, per second. Full yaw
   * input only reaches about 0.64 rad/s against the jet's hover angular drag; asking for more
   * keeps the input saturated for the whole of a big turn, which turns round fastest.
   */
  maxYawRate: 1.2,
  headingGain: 2,
  /** Forward flight (goal.special): cruise speed, m/s, and the least height above the surface. */
  flightSpeed: 40,
  flightAltitude: 30,
  /** Hand back to hover this far from the goal, metres, or sooner at speed (4 s of travel). */
  returnDistance: 150,
  /** Steepest commanded bank in forward flight, degrees, and the fastest turn, rad/s. */
  maxBank: 30,
  maxTurnRate: .4,
  /** Forward flight hands back to hover to make a turn sharper than this, degrees. */
  flightMaxTurn: 50,
  /** Forward flight: wanted climb rate per metre of height error, per second. */
  flightHeightGain: .5,
}

/** Jet torque per unit input in hover mode: terra.jet.prefab hoverSteerFactor 4 times mass. */
const STEER_PER_MASS = 4
/** Jet self righting torque per degree of tilt, per kilogram (Jet.ts hover mode). */
const RIGHTING_PER_MASS = 0.2
/** Jet angular drag in hover mode, per second; the attitude loop already gets this damping. */
const HOVER_ANGULAR_DRAG = 2
/** Forward flight torque per unit input at full authority (Jet.ts: steer 20, control response .3). */
const FLIGHT_PITCH_TORQUE = 200 * 20 * .2 * .3
const FLIGHT_ROLL_TORQUE = 200 * 20 * .75 * .3
/** Lift per (m/s)^2 per unit of angle of attack near sea level: jet.lift .5 * 1.225 * 15. */
const LIFT_PER_V2 = .5 * 1.225 * 15
/** Body origin height when resting on the deployed landing gear. */
const GEAR_HEIGHT = 1.3
const DEG = Math.PI / 180
const clamp = THREE.MathUtils.clamp

/** Positive means turn right. Forward is -Z; positive rotation about +Y turns left. */
function headingError(fx: number, fz: number, dx: number, dz: number): number {
  return Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz)
}

export function createJetPilot(vehicle: Vehicle, terrain: Terrain): Pilot {
  const profile: NavProfile = { maxGrade: Infinity, liquid: 'ignored', flies: true, roadCost: 1, cruiseAltitude: jetPilotTuning.cruiseAltitude }
  const status: PilotStatus = { stuckFor: 0, airborne: false, flipped: false }
  // Scratch space, reused every step.
  const q = new THREE.Quaternion(), inv = new THREE.Quaternion()
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), angvel = new THREE.Vector3()
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), wantUp = new THREE.Vector3()
  const error = new THREE.Vector3(), torque = new THREE.Vector3(), righting = new THREE.Vector3()
  const worldUp = new THREE.Vector3(0, 1, 0)
  const inertia = new THREE.Vector3()
  // Progress tracking for stuckFor.
  let best = Infinity, goalX = NaN, goalZ = NaN
  let heldHeading = NaN
  let leanX = 0, leanZ = 0
  // Forward flight state. 'launch' is hover mode building speed and height before the wings open.
  let mode: 'hover' | 'launch' | 'flight' = 'hover'
  let gammaIntegral = 0
  const hoverGoal: DriveGoal = { x: 0, z: 0, speed: 0 }
  const fd = new THREE.Vector3(), fu = new THREE.Vector3(), fr = new THREE.Vector3(), fNose = new THREE.Vector3(), fUp = new THREE.Vector3()
  const basis = new THREE.Matrix4(), qWant = new THREE.Quaternion(), localSpin = new THREE.Vector3()

  const surface = (x: number, z: number) => Math.max(terrain.heightAt(x, z), terrain.liquidHeightAt?.(x, z) ?? -Infinity)

  /**
   * Height to fly at: the surface a little ahead (to cancel lag) plus the altitude, raised
   * where the ground further along the velocity would otherwise come within `floor` metres
   * before the jet could climb over it at its climb limit.
   */
  let surfaceRate = 0
  function targetHeight(altitude: number): number {
    const tune = jetPilotTuning
    const here = surface(pos.x, pos.z)
    const lead = tune.leadTime
    const near = surface(pos.x + vel.x * lead, pos.z + vel.z * lead)
    let target = Math.max(here, near) + altitude
    // Surface rate of change under the jet, for feed forward on the climb.
    surfaceRate = (near - here) / lead
    const floor = altitude * .6
    for (let i = 1; i <= 10; i++) {
      const t = tune.lookAheadTime * i / 10
      const x = pos.x + vel.x * t, z = pos.z + vel.z * t
      const h = Math.max(surface(x, z), surface(x - vel.z * .2, z + vel.x * .2), surface(x + vel.z * .2, z - vel.x * .2))
      // Height needed now so that climbing at 70 percent of the limit still clears h + floor at time t.
      target = Math.max(target, h + floor - tune.maxClimb * .7 * t)
    }
    return target
  }

  function drive(goal: DriveGoal, input: InputState, dt: number): PilotStatus {
    const body = vehicle.body
    q.copy(body.rotation()); inv.copy(q).invert()
    pos.copy(body.translation()); vel.copy(body.linvel()); angvel.copy(body.angvel())
    up.set(0, 1, 0).applyQuaternion(q)
    forward.set(0, 0, -1).applyQuaternion(q)
    inertia.copy(body.principalInertia())
    input.brakes = false
    input.fire = false

    const height = pos.y - surface(pos.x, pos.z)
    status.airborne = height > GEAR_HEIGHT + .4
    status.flipped = up.y < .3
    const dx = goal.x - pos.x, dz = goal.z - pos.z, dist = Math.hypot(dx, dz)

    // Forward flight only far from the goal; hover does the take off and the arrival.
    const tune = jetPilotTuning
    const speedNow = vel.length()
    const altitude = goal.altitude ?? tune.cruiseAltitude
    const flightAltitude = Math.max(altitude, tune.flightAltitude)
    const far = dist > Math.max(tune.returnDistance, speedNow * 4)
    if (!goal.special || !far) mode = 'hover'
    else if (mode === 'hover') mode = 'launch'
    else {
      // Heading error of the velocity: big turns are made in hover, where the jet turns on
      // the spot. Pitch authority in forward flight is too weak to hold a steep bank.
      const hs = Math.hypot(vel.x, vel.z)
      const turn = hs > 1 ? Math.abs(headingError(vel.x / hs, vel.z / hs, dx / dist, dz / dist)) : Math.PI
      if (mode === 'launch' && hs > 17 && turn < .3 && height > flightAltitude * .7 && up.y > .8) { mode = 'flight'; gammaIntegral = 0 }
      else if (mode === 'flight' && (speedNow < 21 || height < 10 || up.y < .3 || turn > tune.flightMaxTurn * DEG)) mode = 'launch'
    }
    input.special = mode === 'flight'

    if (mode === 'flight') flightControl(goal, input, dt, dist, flightAltitude)
    else if (mode === 'launch') {
      // Hover flat out toward the goal and climb, so the wings open above stall speed.
      hoverGoal.x = goal.x; hoverGoal.z = goal.z; hoverGoal.speed = 30; hoverGoal.altitude = flightAltitude; hoverGoal.stopWithin = undefined
      hoverControl(hoverGoal, input, dt, dist, height)
    } else hoverControl(goal, input, dt, dist, height)

    // Progress: seconds without getting a metre closer, reset when the goal moves or it arrives.
    if (Math.hypot(goal.x - goalX, goal.z - goalZ) > 5) { goalX = goal.x; goalZ = goal.z; best = dist; status.stuckFor = 0 }
    const arrived = goal.stopWithin !== undefined && dist <= goal.stopWithin
    // A flying jet cannot be blocked by terrain, so moving (climbing included) counts as progress.
    if (arrived || dist < best - 1 || dist < 4 || vel.length() > 2) { best = Math.min(best, dist); status.stuckFor = 0 }
    else status.stuckFor += dt
    return status
  }

  /** Hover mode: the cascade described at the top of this file. */
  function hoverControl(goal: DriveGoal, input: InputState, dt: number, dist: number, height: number): void {
    const mass = vehicle.body.mass(), g = 9.81
    const tune = jetPilotTuning
    const dx = goal.x - pos.x, dz = goal.z - pos.z
    const ux = dist > 1e-3 ? dx / dist : 0, uz = dist > 1e-3 ? dz / dist : 0
    let speed = Math.max(0, goal.speed)
    if (goal.stopWithin !== undefined) {
      // Aim for the centre; the stopping profile brings it to rest well inside the radius.
      // Lead the distance by the speed loop's lag so it arrives slow instead of entering hot.
      const ahead = Math.max(0, dist - Math.hypot(vel.x, vel.z) * tune.stopLead)
      speed = Math.min(speed, Math.sqrt(2 * tune.stopAccel * ahead), ahead * .6)
    }
    let vxWant = ux * speed, vzWant = uz * speed
    const recovering = up.y < .6
    // On the ground (or nearly), climb first: leaning on the gear just scrapes.
    const lowFactor = clamp((height - GEAR_HEIGHT - 1) / 2.5, 0, 1)
    let ax = (vxWant - vel.x) * tune.velocityGain, az = (vzWant - vel.z) * tune.velocityGain
    // Jet hover drag scales velocity by (1 - k |v| dt); feed forward the same to hold speed.
    const hSpeed = Math.hypot(vel.x, vel.z), dragK = .01 * hSpeed
    ax += dragK * vel.x; az += dragK * vel.z
    const aMax = g * Math.tan(tune.maxTilt * DEG) * (recovering ? 0 : lowFactor)
    const aMag = Math.hypot(ax, az)
    if (aMag > aMax) { const s = aMax / Math.max(aMag, 1e-6); ax *= s; az *= s }
    // Ease the commanded lean in and out so the craft never snaps between attitudes.
    const ease = Math.min(1, dt / tune.leanTime)
    leanX += (ax - leanX) * ease; leanZ += (az - leanZ) * ease
    ax = leanX; az = leanZ

    // Vertical plan: hold altitude above the highest surface ahead.
    const altitude = goal.altitude ?? tune.cruiseAltitude
    const target = targetHeight(altitude)
    let vyWant = clamp((target - pos.y) * tune.heightGain + clamp(surfaceRate, -tune.maxSink, tune.maxClimb), -tune.maxSink, tune.maxClimb)
    // Never sink fast near the surface.
    if (height < 5) vyWant = Math.max(vyWant, -1)
    const ay = clamp((vyWant - vel.y) * 2.5, -6, 9)

    // Wanted up vector leans toward the horizontal acceleration.
    wantUp.set(ax, g + Math.max(ay, -g * .5), az).normalize()
    // Lift: enough along the current up to produce the wanted vertical acceleration.
    const lift = (g + ay) / (2 * g * Math.max(up.y, .35))
    input.z = up.y > .2 ? clamp(lift, .001, 1) : .001

    // Attitude: rotate up toward wantUp. Error as axis times angle, world space.
    error.crossVectors(up, wantUp)
    const sin = error.length(), cos = up.dot(wantUp)
    const angle = Math.atan2(sin, cos)
    if (sin > 1e-6) error.multiplyScalar(angle / sin)
    else if (cos < 0) error.copy(forward).multiplyScalar(Math.PI)
    else error.set(0, 0, 0)
    const wn = tune.attitudeFrequency, kp = wn * wn, kd = Math.max(0, 2 * tune.attitudeDamping * wn - HOVER_ANGULAR_DRAG)
    // Wanted angular acceleration (world), tilt axes only; yaw is handled below.
    torque.copy(error).multiplyScalar(kp).addScaledVector(angvel, -kd)
    // Cancel the jet's own self righting torque, which pulls up toward world up.
    righting.crossVectors(up, worldUp)
    const tilt = up.angleTo(worldUp) / DEG
    // Jet.ts uses the unnormalised cross product: magnitude sin(tilt) times tilt in degrees.
    righting.multiplyScalar(tilt * RIGHTING_PER_MASS * mass)
    torque.applyQuaternion(inv)
    righting.applyQuaternion(inv)
    const authority = mass * STEER_PER_MASS
    // Local torque from inputs (Jet.ts hover mode): x axis -y*A, y axis -(x+w)*A, z axis -x*A.
    const tx = torque.x * inertia.x - righting.x, tz = torque.z * inertia.z - righting.z
    const y = clamp(-tx / authority, -1, 1)
    const x = clamp(-tz / authority, -1, 1)

    // Heading: face the wanted direction of travel; hold the last heading when nearly still.
    const wantSpeed = Math.hypot(vxWant, vzWant)
    const fLen = Math.hypot(forward.x, forward.z)
    let yawRate = 0
    if (fLen > .2) {
      const fx = forward.x / fLen, fz = forward.z / fLen
      // Near a stop point the wanted velocity can swing round; keep the heading it arrived with.
      const settling = goal.stopWithin !== undefined && dist < goal.stopWithin + 12
      if (wantSpeed > 2 && lowFactor > .5 && !recovering && !settling) heldHeading = Math.atan2(-vxWant, -vzWant)
      else if (Number.isNaN(heldHeading)) heldHeading = Math.atan2(-fx, -fz)
      const err = headingError(fx, fz, -Math.sin(heldHeading), -Math.cos(heldHeading))
      // Positive error turns right, which is a negative rotation about +Y.
      // A hard yaw while tilted consumes the same coupled controls that level the hull.
      // Give the attitude loop priority before a sharp turn can roll a hovering jet over.
      const yawLimit = tune.maxYawRate * clamp((up.y - .6) / .35, 0, 1)
      yawRate = -clamp(err * tune.headingGain, -yawLimit, yawLimit)
    }
    // Spin about the craft's own up axis.
    const localYawRate = angvel.dot(up)
    const ty = (yawRate - localYawRate) * 6 * inertia.y
    const sum = clamp(-ty / authority, -1, 1)
    input.x = x
    input.y = y
    input.w = clamp(sum - x, -1, 1)
  }

  /**
   * Forward flight (wings, input.special true). Bank to turn, angle of attack for lift and
   * climb, throttle for speed. The wanted attitude is built as a full orientation: nose along
   * the wanted flight path raised by the angle of attack, up tilted by the bank.
   */
  function flightControl(goal: DriveGoal, input: InputState, dt: number, dist: number, altitude: number): void {
    const tune = jetPilotTuning, g = 9.81, mass = vehicle.body.mass()
    const speed = Math.max(vel.length(), 1)
    const hs = Math.max(Math.hypot(vel.x, vel.z), .1), hx = vel.x / hs, hz = vel.z / hs
    // Height: the highest surface over the next five seconds of travel, plus the altitude.
    let ground = surface(pos.x, pos.z)
    for (let i = 1; i <= 10; i++) { const t = i * .5; ground = Math.max(ground, surface(pos.x + vel.x * t, pos.z + vel.z * t)) }
    const gamma = Math.asin(clamp(vel.y / speed, -1, 1))
    const gammaWant = clamp((ground + altitude - pos.y) * tune.flightHeightGain / speed, -.2, .3)
    const gammaError = gammaWant - gamma
    gammaIntegral = clamp(gammaIntegral + gammaError * dt * .5, -.1, .1)
    // Turn: bank for a turn rate proportional to the heading error of the velocity.
    const ux = (goal.x - pos.x) / Math.max(dist, 1e-3), uz = (goal.z - pos.z) / Math.max(dist, 1e-3)
    const err = headingError(hx, hz, ux, uz)
    const turnRate = clamp(err * .6, -tune.maxTurnRate, tune.maxTurnRate)
    const bank = clamp(Math.atan(speed * turnRate / g), -tune.maxBank * DEG, tune.maxBank * DEG)
    // Angle of attack that carries the weight in this bank, plus the climb correction.
    const need = Math.asin(Math.min(.3, mass * g / (Math.cos(bank) * LIFT_PER_V2 * speed * speed)))
    const alpha = clamp(need + gammaError * .8 + gammaIntegral, -.1, .3)
    // Wanted flight path, its unbanked up and right, then bank and angle of attack.
    fd.set(hx * Math.cos(gammaWant), Math.sin(gammaWant), hz * Math.cos(gammaWant))
    fu.set(0, 1, 0).addScaledVector(fd, -fd.y).normalize()
    fr.crossVectors(fd, fu)
    fUp.copy(fu).multiplyScalar(Math.cos(bank)).addScaledVector(fr, Math.sin(bank))
    fNose.copy(fd).multiplyScalar(Math.cos(alpha)).addScaledVector(fUp, Math.sin(alpha))
    fUp.multiplyScalar(Math.cos(alpha)).addScaledVector(fd, -Math.sin(alpha))
    fr.crossVectors(fNose, fUp)
    basis.makeBasis(fr, fUp, fd.copy(fNose).negate())
    qWant.setFromRotationMatrix(basis)
    // Orientation error in the craft's own frame, as axis times angle (small angle form).
    const e = qWant.premultiply(inv)
    if (e.w < 0) { e.x = -e.x; e.y = -e.y; e.z = -e.z; e.w = -e.w }
    localSpin.copy(angvel).applyQuaternion(inv)
    const authority = clamp(speed / 20 * .7, .05, 1)
    // Local torque from inputs (Jet.ts flight): x axis -y * pitch torque, z axis -x * roll torque.
    const tx = (2 * e.x * 3 - localSpin.x * 1.5) * inertia.x
    const tz = (2 * e.z * 5 - localSpin.z * 1.5) * inertia.z
    input.y = clamp(-tx / (FLIGHT_PITCH_TORQUE * authority), -1, 1)
    input.x = clamp(-tz / (FLIGHT_ROLL_TORQUE * authority), -1, 1)
    // Yaw only through thrust vectoring: a little, to keep the nose on the flight path.
    input.w = clamp(-(2 * e.y - localSpin.y) * 2, -1, 1)
    const cruise = Math.max(goal.speed, tune.flightSpeed)
    input.z = clamp(.15 + (cruise - speed) * .08 + .5 * Math.sin(gammaWant), .02, 1)
  }

  function reset(): void {
    best = Infinity; goalX = NaN; goalZ = NaN; heldHeading = NaN; leanX = 0; leanZ = 0; mode = 'hover'; gammaIntegral = 0
    status.stuckFor = 0; status.airborne = false; status.flipped = false
  }

  return { profile, drive, reset }
}
