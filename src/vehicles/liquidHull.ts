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
  /** Extra vertical drag (1/s) once a column is wholly under: how slowly a sunk hull rises. */
  deep: number
  /** Steering: how far the front paddles turn with the wheels (1 about 30 degrees at full lock). */
  steer: number
  /**
   * Lift from effort (water): when set, the hull only floats while it works to. Buoyancy over
   * weight falls from `buoyancy` to `sink` as the buggy stops and the throttle is released.
   */
  sink?: number
  /** Speed (m/s) below which lift from motion is lost. */
  liftSpeed?: number
  /** Extra drag (1/s, growing with speed) when not paddling: water wins once you stop trying. */
  coast?: number
  /**
   * Vertical drag (1/s) on a column wholly under, in place of `heave` (water). Lower lets a sunk
   * hull fall at a believable rate; the bob and the skip at the surface keep `heave`. Unset, a
   * column under keeps `heave`, as lava's does.
   */
  sunkHeave?: number
  /**
   * Tyres skimming the surface (water): lift over weight and forward pull (m/s²) at full effect,
   * per wheel whose tyre is at the surface (part wet, neither dry nor under), at full throttle,
   * with the hull and the wheels both past `tyreSpeed` (m/s). A slow or sinking hull gets none.
   */
  tyreLift?: number
  tyrePull?: number
  tyreSpeed?: number
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
  /** Vortex shedding phase of each wing. */
  shed: Float32Array
  /** Mean wetness of all four columns after the last step. */
  mean: number
  /** Lift from effort and motion, 0..1, lagged: what keeps a water hull up. */
  lift: number
}

export const createHullState = (): HullState => ({ wet: new Float32Array(4), phase: 0, liquid: '', axle: 0, shed: Float32Array.of(0, 2.1), mean: 0, lift: 1 })

/** Corner columns in the body frame: x half width, z half length, bottom and height. */
/**
 * Steering in a liquid: front paddle angle at full lock (radians, at steer setting 1), how much
 * harder the outside wheels bite, and the steered wheels' rudder effect (per second).
 */
export const STEER = { angle: 0.5, differential: 0.35, rudder: 1 }

/** Shape constants of the model, shared by both liquids. Settings scale these. */
export const HULL_TUNING = { lagBase: 0.02, lagScale: 0.12, bowLift: 0.5, waddleLift: 0.6, pitchLift: 0.8, plough: 0.35 }

export const HULL = { x: 1.0, z: 1.5, bottom: -0.35, height: 0.85 }

/**
 * The righting moment of a capsized hull: below `below` (the up axis's height) the liquid's lift
 * acts `arm` metres off the centre of mass, rolling it back over. See applyHull.
 */
export const CAPSIZE = { below: 0.3, arm: 0.6 }

const corner = new THREE.Vector3(), q = new THREE.Quaternion(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), torque = new THREE.Vector3(), roll = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0), com = new THREE.Vector3()
const flow = { x: 0, z: 0 }
const f = { x: 0, y: 0, z: 0 }

export interface HullInput {
  /** Throttle, -1..1. */
  throttle: number
  /** Wheel surface speed along the nose, m/s (the motor speed). */
  wheelSpeed: number
  /** Live wheel geometry (buggy.tyreSize): hub half track and half wheelbase, and tyre radius, m. */
  wheel?: { x: number; z: number; radius: number }
  /** Steering input, -1 full left to 1 full right. */
  steer?: number
  /** Brakes held: the coasting drag bites harder. */
  brakes?: boolean
  /**
   * 0..1, default 1: how much of the hull's drag, plough, heave damping, bow lift and tyre skim
   * act. Planing on the
   * water (skip.ts) carries the hull on its lift, wetting little of it: they give way by the
   * lift's share of the support, as the zorb's bulk drag does.
   */
  bulk?: number
  /**
   * 0..1, default `bulk`: how much of the coasting plough acts. It is the drag of a hull that has
   * stopped trying, so it stays off while the planing lift still carries the hull (skip.ts
   * `ploughGiveWay`): without that, a coasting skip dug in on its second touchdown.
   */
  plough?: number
}
/** Body-frame height of the buggy hull's lowest point in a liquid: its tyres, reaching down with their size (as the columns do). */
export function hullBottom(wheel?: { radius: number }): number {
  return HULL.bottom - 1.2 * Math.max(0, (wheel?.radius ?? STANDARD_WHEEL.radius) - STANDARD_WHEEL.radius)
}
/** The standard tyre the HULL columns were drawn around. */
const STANDARD_WHEEL = { x: 1.1, z: 1.3, radius: 0.5 }

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
  // Lift from effort: paddling, or still moving fast, holds the hull up; stopped, it sinks.
  // Only at the surface: once wholly under, paddles and speed no longer lift it, so it drives
  // along the bed (open wings float it up).
  let buoyancy = p.buoyancy, coasting = 0, lifted = 1
  if (p.sink !== undefined) {
    const ls = Math.max(0.5, p.liftSpeed ?? 3)
    const moving = THREE.MathUtils.smoothstep(Math.hypot(lin.x, lin.z), 0.4 * ls, ls)
    const atSurface = 1 - THREE.MathUtils.smoothstep(s.mean, 0.92, 1)
    // Part throttle holds most of the lift: easing off settles lower; letting go sinks.
    s.lift += (Math.max(Math.sqrt(effort), moving) * atSurface - s.lift) * (1 - Math.exp(-dt / 0.3))
    lifted = s.lift
    buoyancy = p.sink + (p.buoyancy - p.sink) * lifted
    // Coasting drag stops a hull moving through the water, sinking or not, but not one resting
    // on the bed: a sunk buggy dragged along by a tow feels the bed and the water, not a plough.
    // (Gating it on the surface instead let a coasting buggy that had just gone under glide on.)
    const reachDown = HULL.bottom - 1.2 * Math.max(0, (input.wheel?.radius ?? 0.5) - 0.5)
    const clearance = pos.y + reachDown - terrain.heightAt(pos.x, pos.z)
    const onBed = 1 - THREE.MathUtils.smoothstep(clearance, 0.6, 1.2)
    coasting = (p.coast ?? 0) * (1 - effort) * (input.brakes ? 2.5 : 1) * (1 - onBed)
  }
  // Big tyres are big floats and big paddles: the columns spread with the hubs and reach down
  // with the tyres, and the paddles push in proportion to the tyre's reach.
  const wheel = input.wheel ?? STANDARD_WHEEL
  const hx = HULL.x + Math.max(0, wheel.x - STANDARD_WHEEL.x), hz = HULL.z + Math.max(0, wheel.z - STANDARD_WHEEL.z)
  const extra = Math.max(0, wheel.radius - STANDARD_WHEEL.radius)
  const colBottom = HULL.bottom - 1.2 * extra, colHeight = HULL.height + 1.2 * extra
  const reach = Math.sqrt(Math.max(0.5, wheel.radius / STANDARD_WHEEL.radius))
  const steer = THREE.MathUtils.clamp(input.steer ?? 0, -1, 1)
  const angle = STEER.angle * p.steer * steer
  const steerCos = Math.cos(angle), steerSin = Math.sin(angle)
  let total = 0
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1, front = i < 2
    corner.set(com.x + sx * hx, colBottom, com.z + (front ? -hz : hz)).applyQuaternion(q)
    const bx = pos.x + corner.x, bz = pos.z + corner.z, bottom = pos.y + corner.y
    const surface = terrain.liquidHeightAt?.(bx, bz) ?? -Infinity
    const kind = terrain.liquidKindAt ? terrain.liquidKindAt(bx, bz) : 'lava'
    // Column extent: bottom corner to the body's top along the current up.
    const top = bottom + up.y * colHeight
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
    // Planing wets less hull, but only under power: coasting, the bow ploughs in.
    const skim = 1 - (1 - p.skim) * Math.min(1, Math.abs(plane)) * (p.sink !== undefined ? Math.max(effort, 0.7) : 1)
    const bulk = THREE.MathUtils.clamp(input.bulk ?? 1, 0, 1)
    const drag = Math.min(0.9 / dt, p.thickness * (p.linear + p.quadratic * vh) * sub * skim * bulk)
    // Coasting drag acts low on the hull, so letting go pitches the nose down into it.
    const plough = Math.min(0.9 / dt - drag, coasting * (1 + vh / 16) * Math.min(1, sub * 2) * THREE.MathUtils.clamp(input.plough ?? bulk, 0, 1))
    // Wholly under, a column falls or rises through the liquid with `sunkHeave` instead of the
    // surface's `heave`; the two blend over the last tenth of its height.
    const under = p.sunkHeave === undefined ? 0 : THREE.MathUtils.smoothstep(sub, 0.9, 1)
    const heave = Math.min(0.9 / dt, ((p.heave * (1 - under) + (p.sunkHeave ?? 0) * under) * sub + p.deep * Math.max(0, sub - 0.9) / 0.1) * bulk)
    f.x = -vx * drag * share
    f.z = -vz * drag * share
    const rise = terrain.liquidVerticalSpeedAt?.(cx, cz) ?? 0
    f.y = buoyancy * g * share * s.wet[i] - (v.y - (Number.isFinite(rise) ? rise : 0)) * heave * share
    // Turned wheels moving through the liquid act as a rudder too, a little, even coasting.
    if (front && steerSin !== 0) {
      const rudder = STEER.rudder * p.steer * share * forward * Math.min(1, sub * 1.5) * steerSin
      f.x += side.x * rudder
      f.z += side.z * rudder
    }
    // Bow dynamic lift on the front columns only, carried by their lagged wetness.
    // Like the drag, it gives way to the planing contact (`bulk`): a hull up on its planing lift
    // has little bow in the water, and kept at full it pitched a skimming buggy nose up.
    if (front && forward > 0) f.y += p.porpoise * HULL_TUNING.bowLift * g * share * plane * Math.min(1, s.wet[i] * 2) * lifted * bulk
    // Planing: the whole hull rides up on its speed, wetting less and so lifting less: a skip.
    if (forward > 0) f.y += p.planeLift * g * share * plane * Math.min(1, sub * 3) * lifted
    // Tyres skimming: a fast-spinning tyre at the surface planes on it and throws water back,
    // lifting and pulling its corner. Only at the surface (a band of wetness, nothing when the
    // tyre is clear or under), only under throttle, and only with the hull and the wheels both
    // fast: a buggy that has slowed or begun to sink is not rescued by it.
    if (p.tyreLift !== undefined && throttle > 0 && forward > 0) {
      const band = THREE.MathUtils.smoothstep(sub, 0.02, 0.15) * (1 - THREE.MathUtils.smoothstep(sub, 0.5, 0.8))
      const from = p.tyreSpeed ?? 12
      const fast = THREE.MathUtils.smoothstep(forward, from, from + 8) * THREE.MathUtils.smoothstep(input.wheelSpeed, from, from + 8)
      // Drive on the water cannot hold a hull up past its planing speed: skipping must end. The
      // pull fades out from 0.8 of the hull's planing speed (`planing`, derived in skip.ts) to all
      // of it, as the tyres find less and less to push against.
      const below = 1 - THREE.MathUtils.smoothstep(forward, 0.8 * p.planing, p.planing)
      const k = throttle * band * fast * bulk * below
      if (k > 0) {
        f.y += (p.tyreLift ?? 0) * g * share * k
        f.x += fwd.x * (p.tyrePull ?? 0) * share * k
        f.z += fwd.z * (p.tyrePull ?? 0) * share * k
      }
    }
    // Paddle: rear and front wheels alike, alternating left and right bite.
    if (effort > 0) {
      // In a turn the outside wheels dig in harder and the inside ones ease off.
      const bite = (1 + p.waddle * sway * sx) * (1 - STEER.differential * p.steer * steer * sx)
      const push = p.paddle * share * slip * Math.min(1, sub * 1.5) * bite * reach
      // Steered front wheels throw their wash where they point, so lock turns the bow.
      const dx = front ? steerCos : 1, dy = front ? steerSin : 0
      f.x += (fwd.x * dx + side.x * dy) * push
      f.z += (fwd.z * dx + side.z * dy) * push
      // The wheel throws liquid back and down: a little lift on the side that bites.
      f.y += Math.abs(push) * HULL_TUNING.waddleLift * p.waddle * (1 + sway * sx)
      // Front and rear strokes alternate too: the porpoise, in time with the wheels.
      f.y += p.porpoise * HULL_TUNING.pitchLift * g * share * effort * surge * (front ? 1 : -1) * Math.min(1, sub * 2)
    }
    // Buoyancy and paddling act at the column; drag at the body's own height, so a hard stop
    // slows the hull without tipping it end over end.
    body.addForceAtPoint({ x: 0, y: f.y, z: 0 }, { x: cx, y: cy, z: cz }, true)
    body.addForceAtPoint({ x: f.x, y: 0, z: f.z }, { x: cx, y: pos.y, z: cz }, true)
    if (plough > 0) {
      // Water piles over the bow as it digs in: the nose goes down, and the hull ploughs.
      const dig = front ? -HULL_TUNING.plough * plough * Math.min(vh, 8) * share : 0
      body.addForceAtPoint({ x: -vx * plough * share, y: dig, z: -vz * plough * share }, { x: cx, y: cy, z: cz }, true)
    }
  }
  s.mean = total / 4
  if (total <= 0) { s.axle = 0; return 0 }
  // Report the drier axle's wetness: once either pair of wheels is on the bank, it may climb.
  s.axle = Math.min(s.wet[0] + s.wet[1], s.wet[2] + s.wet[3]) / 2
  // Righting: a buoyant hull floats right way up. Weak, so it rocks; enough to undo a flip.
  const mean = total / 4
  torque.copy(up).cross(worldUp).multiplyScalar(m * 6 * mean * (up.y < 0.3 ? 3 : 1))
  // Capsized: the buggy's weight sits low in its chassis, so upside down its centre of mass
  // rides above the hull's centre of buoyancy and the liquid rolls it back over, harder the
  // more the liquid lifts it. Without this a flipped hull in lava, which floats high, rested
  // on its roof for good (the owner's report, 18 November 2026). It does not vanish on the
  // roof itself, where the lean above does: there it rolls over sideways, about the nose.
  if (up.y < CAPSIZE.below) {
    roll.copy(up).cross(worldUp)
    const sign = Math.sign(roll.dot(fwd)) || 1
    roll.addScaledVector(fwd, sign * 0.3).normalize()
    torque.addScaledVector(roll, buoyancy * m * g * mean * CAPSIZE.arm)
  }
  const w = body.angvel()
  body.addTorque({ x: torque.x - w.x * m * 1.2 * mean, y: -w.y * m * 0.3 * mean * Math.min(2, p.thickness), z: torque.z - w.z * m * 1.2 * mean }, true)
  return s.axle
}

/**
 * Open wings in a liquid: two large, light plates, one each side.
 *
 * Each wing floats (`buoyancy`, over weight, shared by the two) in proportion to how much of it
 * is under the surface, at the wing itself, so a tilted buggy rights itself unevenly and, at the
 * surface, the wings are outriggers. Each wing is also a flat plate in a dense flow: the liquid
 * pushes on it along its normal, by the square of the speed through it. That push is lift when
 * the plate is inclined to the flow and drag when it meets it flat. It acts ahead of the wing's
 * middle when the flow runs along the plate and at the middle when it hits it square, which is
 * what makes a plate flutter, swoop and tumble as it rises, like a leaf falling upward.
 * The pilot's pitch and roll keys tilt the plates, so a rise can be steered toward shore.
 *
 * Every force here is scaled by how wet the wing is: none of them can act above the surface.
 */
export interface WingProfile {
  /** Wings' buoyancy at full submergence, over the buggy's weight. */
  buoyancy: number
  /** Plate force scale: 1 for water; heavier liquids push harder and slow everything. */
  authority: number
  /** Liquid density relative to water. */
  density: number
}
export const WING = { span: 2.6, back: 0.15, up: 0.15, chord: 1.2, control: 1.6, plate: 3.5, shed: 0.9, shedBase: 0.6, strouhal: 0.3, cap: 0.04 }
const wingPoint = new THREE.Vector3(), normal = new THREE.Vector3(), cp = new THREE.Vector3()

export function applyWings(body: RAPIER.RigidBody, world: RAPIER.World, terrain: Terrain, liquid: 'lava' | 'water', p: WingProfile, s: HullState, input: { x: number; y: number }, dt: number): number {
  if (body.isKinematic()) return 0
  const pos = body.translation(), r = body.rotation()
  q.set(r.x, r.y, r.z, r.w)
  normal.set(0, 1, 0).applyQuaternion(q)
  fwd.set(0, 0, -1).applyQuaternion(q)
  const m = body.mass(), g = -world.gravity.y
  let wet = 0
  for (let k = 0; k < 2; k++) {
    const side = k ? 1 : -1
    wingPoint.set(side * WING.span, WING.up, WING.back).applyQuaternion(q).add(pos)
    const surface = terrain.liquidHeightAt?.(wingPoint.x, wingPoint.z) ?? -Infinity
    const kind = terrain.liquidKindAt ? terrain.liquidKindAt(wingPoint.x, wingPoint.z) : 'lava'
    if (kind !== liquid || !Number.isFinite(surface)) continue
    // The plate is thin: it goes from dry to wholly wet over a hand's breadth of depth.
    const x = THREE.MathUtils.clamp((surface - wingPoint.y + 0.15) / 0.3, 0, 1)
    const sub = x * x * (3 - 2 * x)
    if (sub <= 0) continue
    wet += sub / 2
    flow.x = 0; flow.z = 0
    terrain.liquidFlowAt?.(wingPoint.x, wingPoint.z, flow)
    const rise = terrain.liquidVerticalSpeedAt?.(wingPoint.x, wingPoint.z) ?? 0
    const v = body.velocityAtPoint(wingPoint)
    const vx = v.x - flow.x, vy = v.y - (Number.isFinite(rise) ? rise : 0), vz = v.z - flow.z
    const speed = Math.hypot(vx, vy, vz)
    // Pilot: pitch tilts both plates, roll tilts them oppositely, as flaps do.
    const tilt = THREE.MathUtils.clamp(-input.y * 0.35 + side * input.x * 0.35, -0.6, 0.6)
    // The effective plate normal, turned about the wing's span by the flap.
    const nx = normal.x + fwd.x * tilt, ny = normal.y + fwd.y * tilt, nz = normal.z + fwd.z * tilt
    const nl = Math.hypot(nx, ny, nz)
    const vn = (vx * nx + vy * ny + vz * nz) / nl
    // Vortices shed off alternate edges as the plate moves (a Strouhal number of about 0.2), so
    // the push wavers and its centre wanders fore and aft: the flutter of a falling leaf. Each
    // wing sheds on its own phase, set by how it has moved, so no two rises are the same.
    s.shed[k] = (s.shed[k] + 2 * Math.PI * (WING.strouhal * speed / WING.chord + WING.shedBase * Math.min(1, speed)) * dt) % (2 * Math.PI)
    const waver = Math.sin(s.shed[k])
    // Normal pressure: quadratic in the speed, plus a little linear so a slow drift still feels it.
    // Never more than the wing tip's share of the body can take in one step without reversing.
    const c = Math.min(p.authority * p.density * sub * m * 0.5 * (WING.plate * speed + 0.6), WING.cap * m / dt)
    const push = -c * vn * (1 + WING.shed * waver)
    // Skin friction along the plate, small.
    const skin = -Math.min(p.authority * p.density * sub * m * 0.5 * 0.04 * speed, 0.02 * m / dt)
    // Centre of pressure: forward of the middle when the flow runs along the plate (edge on),
    // back to the middle as it meets it square.
    const along = speed > 0.05 ? Math.sqrt(Math.max(0, 1 - (vn / speed) ** 2)) : 0
    cp.copy(fwd).multiplyScalar(WING.chord * (0.3 * along + 0.25 * Math.sin(s.shed[k] + 1))).add(wingPoint)
    const buoy = p.buoyancy * m * g * 0.5 * sub
    body.addForceAtPoint({
      x: (nx / nl) * push + (vx - vn * nx / nl) * skin,
      y: (ny / nl) * push + (vy - vn * ny / nl) * skin + buoy,
      z: (nz / nl) * push + (vz - vn * nz / nl) * skin,
    }, cp, true)
  }
  if (wet > 0) {
    // The flaps also bite when barely moving: a little direct authority, so a slow rise can be steered.
    torque.set(-input.y, 0, -input.x).applyQuaternion(q).multiplyScalar(m * WING.control * wet * p.authority)
    body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true)
  }
  return wet
}
