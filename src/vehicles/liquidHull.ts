/**
 * Buggy liquid hull: forces only, never a velocity write, so the buggy's own wheels, suspension
 * and wings keep working in lava and water and everything they do adds up with the liquid.
 *
 * The hull is four corner columns. Each one, independently:
 *  - floats: buoyancy in proportion to how much of its column is under the surface there, so the
 *    body pitches and rolls on the liquid and on its waves. The force follows the submergence
 *    with a small lag (`porpoise`), which is what turns a steady push into a rhythmic pitch: the
 *    bow digs in, lift arrives a moment late and throws it up, and it slaps back down.
 *  - drags: linear plus quadratic in its speed through the liquid, horizontally and (more
 *    gently) vertically, so a bob decays but still bounces.
 *  - paddles: a spinning wheel in the liquid pushes the hull forward (and a little upward)
 *    by how much of the wheel is wet and how much faster it turns than the hull moves. The left
 *    and right wheels bite alternately (`waddle`), a gait driven by the wheels' own spin, so at
 *    full throttle the buggy walks from side to side; off throttle the paddling stops and the
 *    rhythm fades with it.
 *  - planes: at speed the bow rides up on dynamic lift, so a fast entry skims and throws its
 *    nose before it settles.
 *
 * Wheels that reach the bed still grip it through the controller, softened by the buoyancy that
 * unloads them, so shallows give purchase and deep liquid leaves only the paddles. A gentle
 * righting torque keeps a flipped hull from staying flipped.
 */
import * as THREE from 'three/webgpu'
import type { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'

export interface HullProfile {
  /** Buoyancy at full submergence over weight. Above 1 floats; 2 rides half in. */
  buoyancy: number
  /** Scales every drag term. */
  thickness: number
  /** Horizontal drag: linear (1/s) and quadratic (1/m) at thickness 1, per fully wet column. */
  linear: number
  quadratic: number
  /** Vertical drag (1/s): how quickly a bob dies. Not scaled by thickness, so thick goo still bounces. */
  heave: number
  /** Paddle thrust at full throttle, m/s² of the whole buggy when every wheel is wet. */
  paddle: number
  /** Speed (m/s) at which paddling stops adding thrust: the wheels' grip on the liquid. */
  paddleSpeed: number
  /** 0..1: lag in the buoyancy and the bow's dynamic lift, which make it porpoise. */
  porpoise: number
  /** 0..1: how unevenly the left and right wheels bite, which make it waddle. */
  waddle: number
  /** Gait frequency (Hz) at full throttle. */
  gait: number
  /** Speed (m/s) at which the bow's dynamic lift carries a quarter of the weight. */
  planing: number
  /** Horizontal drag multiplier while planing (skimming wets less hull). */
  skim: number
  /** Dynamic lift on the whole hull at planing speed, over weight: how it rides up and skips. */
  planeLift: number
}

export interface HullState {
  /** Lagged submergence of each corner. */
  wet: Float32Array
  /** Gait phase, radians. */
  phase: number
  /** Liquid this state last saw, so a change of liquid resets the lag. */
  liquid: string
  /** Mean wetness of the drier axle's two columns after the last step. */
  axle: number
}

export const createHullState = (): HullState => ({ wet: new Float32Array(4), phase: 0, liquid: '', axle: 0 })

/** Corner columns in the body frame: x half width, z half length, bottom and height. */
/** Shape constants of the model, shared by both liquids. Settings scale these. */
export const HULL_TUNING = { lagBase: 0.02, lagScale: 0.12, bowLift: 0.5, waddleLift: 0.6, pitchLift: 0.8 }

export const HULL = { x: 1.0, z: 1.5, bottom: -0.35, height: 0.85 }

const corner = new THREE.Vector3(), q = new THREE.Quaternion(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), torque = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0), com = new THREE.Vector3()
const flow = { x: 0, z: 0 }
const f = { x: 0, y: 0, z: 0 }

export interface HullInput {
  /** Throttle, -1..1. */
  throttle: number
  /** Wheel surface speed along the nose, m/s (the motor speed). */
  wheelSpeed: number
}

/**
 * Apply the liquid's forces to a buggy body. Returns the wetness of its drier axle (0 when
 * either pair of wheels is clear), which is zero, with no force applied, when no column is wet.
 */
export function applyHull(body: RAPIER.RigidBody, world: RAPIER.World, terrain: Terrain, liquid: 'lava' | 'water', p: HullProfile, s: HullState, input: HullInput, dt: number): number {
  if (body.isKinematic()) return 0
  if (s.liquid !== liquid) { s.wet.fill(0); s.liquid = liquid }
  const pos = body.translation(), r = body.rotation()
  q.set(r.x, r.y, r.z, r.w)
  fwd.set(0, 0, -1).applyQuaternion(q)
  up.set(0, 1, 0).applyQuaternion(q)
  side.set(1, 0, 0).applyQuaternion(q)
  const c = body.localCom(); com.set(c.x, 0, c.z)
  const m = body.mass(), g = -world.gravity.y, share = m / 4
  const lin = body.linvel()
  const forward = lin.x * fwd.x + lin.y * fwd.y + lin.z * fwd.z
  // Lag time constant for buoyancy: a slower answer is a livelier porpoise.
  const lag = 1 - Math.exp(-dt / (HULL_TUNING.lagBase + HULL_TUNING.lagScale * p.porpoise))
  const throttle = THREE.MathUtils.clamp(input.throttle, -1, 1)
  // Gait: the wheels' own spin sets the rhythm, so it fades as they stop.
  const effort = Math.abs(throttle)
  s.phase = (s.phase + 2 * Math.PI * p.gait * effort * dt) % (2 * Math.PI)
  // Left and right bite in turn (sway); front and rear a quarter cycle later (pitch), so
  // the hull walks in a slow circle of roll and pitch, as a swimmer does.
  const sway = Math.sin(s.phase), surge = Math.cos(s.phase)
  // Paddles push by the wheels' slip through the liquid, never past their grip speed.
  // Thrust fades to nothing as the hull reaches the paddles' own speed through the liquid.
  const slip = THREE.MathUtils.clamp(throttle - forward / Math.max(1, p.paddleSpeed), -1, 1)
  // Bow dynamic lift: planing in water, the nose riding up on thick lava.
  const plane = THREE.MathUtils.clamp((forward / p.planing) ** 2, 0, 1) * Math.sign(forward)
  let total = 0
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1, front = i < 2
    corner.set(com.x + sx * HULL.x, HULL.bottom, com.z + (front ? -HULL.z : HULL.z)).applyQuaternion(q)
    const bx = pos.x + corner.x, bz = pos.z + corner.z, bottom = pos.y + corner.y
    const surface = terrain.liquidHeightAt?.(bx, bz) ?? -Infinity
    const kind = terrain.liquidKindAt ? terrain.liquidKindAt(bx, bz) : 'lava'
    // Column extent: bottom corner to the body's top along the current up.
    const top = bottom + up.y * HULL.height
    const lo = Math.min(bottom, top), hi = Math.max(bottom, top)
    const sub = kind === liquid && Number.isFinite(surface) ? THREE.MathUtils.clamp((surface - lo) / Math.max(0.2, hi - lo), 0, 1) : 0
    s.wet[i] += (sub - s.wet[i]) * lag
    if (sub <= 0 && s.wet[i] < 0.01) { s.wet[i] = 0; continue }
    total += sub
    // Force at the column's centre of buoyancy, half way up its wet part.
    const cx = bx, cy = lo + Math.min(sub, 1) * (hi - lo) * 0.5, cz = bz
    const v = body.velocityAtPoint({ x: cx, y: cy, z: cz })
    flow.x = 0; flow.z = 0
    terrain.liquidFlowAt?.(cx, cz, flow)
    const vx = v.x - flow.x, vz = v.z - flow.z, vh = Math.hypot(vx, vz)
    const skim = 1 - (1 - p.skim) * Math.min(1, Math.abs(plane))
    const drag = Math.min(0.9 / dt, p.thickness * (p.linear + p.quadratic * vh) * sub * skim)
    const heave = Math.min(0.9 / dt, p.heave * sub)
    f.x = -vx * drag * share
    f.z = -vz * drag * share
    const rise = terrain.liquidVerticalSpeedAt?.(cx, cz) ?? 0
    f.y = p.buoyancy * g * share * s.wet[i] - (v.y - (Number.isFinite(rise) ? rise : 0)) * heave * share
    // Bow dynamic lift on the front columns only, carried by their lagged wetness.
    if (front && forward > 0) f.y += p.porpoise * HULL_TUNING.bowLift * g * share * plane * Math.min(1, s.wet[i] * 2)
    // Planing: the whole hull rides up on its speed, wetting less and so lifting less: a skip.
    if (forward > 0) f.y += p.planeLift * g * share * plane * Math.min(1, sub * 3)
    // Paddle: rear and front wheels alike, alternating left and right bite.
    if (effort > 0) {
      const bite = 1 + p.waddle * sway * sx
      const push = p.paddle * share * slip * Math.min(1, sub * 1.5) * bite
      f.x += fwd.x * push
      f.z += fwd.z * push
      // The wheel throws liquid back and down: a little lift on the side that bites.
      f.y += Math.abs(push) * HULL_TUNING.waddleLift * p.waddle * (1 + sway * sx)
      // Front and rear strokes alternate too: the porpoise, in time with the wheels.
      f.y += p.porpoise * HULL_TUNING.pitchLift * g * share * effort * surge * (front ? 1 : -1) * Math.min(1, sub * 2)
    }
    // Buoyancy and paddling act at the column; drag at the body's own height, so a hard stop
    // slows the hull without tipping it end over end.
    body.addForceAtPoint({ x: 0, y: f.y, z: 0 }, { x: cx, y: cy, z: cz }, true)
    body.addForceAtPoint({ x: f.x, y: 0, z: f.z }, { x: cx, y: pos.y, z: cz }, true)
  }
  if (total <= 0) return 0
  // Report the drier axle's wetness: once either pair of wheels is on the bank, it may climb.
  s.axle = Math.min(s.wet[0] + s.wet[1], s.wet[2] + s.wet[3]) / 2
  // Righting: a buoyant hull floats right way up. Weak, so it rocks; enough to undo a flip.
  const mean = total / 4
  torque.copy(up).cross(worldUp).multiplyScalar(m * 6 * mean * (up.y < 0.3 ? 3 : 1))
  const w = body.angvel()
  body.addTorque({ x: torque.x - w.x * m * 1.2 * mean, y: -w.y * m * 0.3 * mean * Math.min(2, p.thickness), z: torque.z - w.z * m * 1.2 * mean }, true)
  return s.axle
}
