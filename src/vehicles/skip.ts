/**
 * Skipping across water: one planing contact for every vehicle and for the zorb's ball.
 *
 * The owner, 25 November 2026: "hitting the water fairly fast from any vehicle at a low
 * incidence angle should skip across it a few times like a stone rather than just sinking
 * immediately. The weight and size of the vehicle should, of course, factor in. Tanks probably
 * shouldn't ever bounce."
 *
 * A planing hull is held up by the water it pushes down, which grows as the square of its speed
 * along the surface. Its planing speed, where that lift carries its whole weight with its whole
 * planing patch wet, is
 *
 *   planing = water.skip.planingScale * water.<kind>.planing * sqrt(weight / planing area)
 *
 * so a heavier or smaller hull must go faster, from each vehicle's real mass and footprint, and a
 * new vehicle needs no entry. At each contact, along the surface normal:
 *
 *   lift = weight * (vt / planing)^2 * (wetted share of the patch) * fade(entry angle)
 *
 * with vt the speed along the surface. That is a spring that stiffens with speed, so a hull
 * falling onto the water fast and flat bounces; a damper sized from `water.skip.keep` makes each
 * bounce keep that share of its up-and-down energy at any speed, and friction
 * (`water.skip.friction` times the push) sheds speed along the surface each time. Below
 * `water.skip.minSpeed`, or steeper than `water.skip.angle`, there is no lift: the hull goes in.
 * After a few skips it is below its planing speed and settles into its ordinary water state.
 *
 * Everything is relative to the surface's own motion (current and rise) on the real wave height
 * and slope at the contact, and the water only pushes: the damper only eases the push and the
 * friction only opposes motion along the surface, so the water never gives a hull speed or
 * height. A hull with no reserve buoyancy (the tank's) is not a planing hull and gets nothing.
 *
 * Pure functions of a body's state relative to the water, so every client that built the same
 * world computes the same force from the same networked state.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../shared/params'

const P = { group: 'Water', scope: 'world' as const }
/**
 * Scales every vehicle's planing speed (see the header): higher needs more speed to skip. 2.05
 * keeps the zorbed buggy's planing speed at the old zorb.skipSpeed of 10 m/s, and gives the
 * buggy's own hull about the old water.buggy.planingSpeed of 10 m/s.
 *
 * Friction 0.15 and energy kept 0.7 make a buggy a skipped stone: at its top speed, coasting,
 * about six skips that visibly shorten, below its planing speed within about 230 m; at full
 * throttle no further; at twice its planing speed still several. The zorb keeps its old feel
 * (0.03 and 0.5) through its own factors, water.zorb.skipFriction 0.2 and skipKeep 5/7.
 */
export const skipPlaningScale = defineParam({ ...P, id: 'water.skip.planingScale', label: 'Skip: planing speed scale', default: 2.05, min: 0.2, max: 5, step: 0.05 })
/** Speed along the surface (m/s) below which the water gives no planing lift at all. */
export const skipMinSpeed = defineParam({ ...P, id: 'water.skip.minSpeed', label: 'Skip: entry speed needed (m/s)', default: 5, min: 0, max: 40, step: 0.5 })
/** Entry angle (degrees below the surface) past which a hull digs in rather than skipping. */
export const skipAngle = defineParam({ ...P, id: 'water.skip.angle', label: 'Skip: entry angle window (°)', default: 30, min: 0, max: 60, step: 1 })
/** Share of the up-and-down energy each bounce keeps. */
export const skipKeep = defineParam({ ...P, id: 'water.skip.keep', label: 'Skip: energy kept per skip', default: 0.7, min: 0.05, max: 0.95, step: 0.01 })
/** Drag along the surface as a share of the push: the speed each skip sheds. */
export const skipFriction = defineParam({ ...P, id: 'water.skip.friction', label: 'Skip: friction', default: 0.15, min: 0, max: 0.5, step: 0.005 })

/** The lift stops growing past this many times the planing speed squared's ratio (a spring stiff enough at 60 Hz). */
export const SKIP_MAX_RATIO = 4
/** The lift fades out over this many degrees past `water.skip.angle`. */
export const SKIP_ANGLE_FADE = 15
/** The minimum speed's lift fades in over this share of it, so a hull slowing down eases off. */
const SKIP_MIN_FADE = 0.2

/**
 * A vehicle's planing speed, m/s: where the water's dynamic lift carries its weight with its
 * whole planing patch wet. `factor` is the vehicle's own water.<kind>.planing (default 1).
 */
export function planingSpeed(mass: number, area: number, g: number, factor = 1): number {
  if (!(mass > 0) || !(area > 0) || !(g > 0)) return Infinity
  return skipPlaningScale.value * factor * Math.sqrt(mass * g / area)
}

/** One contact of a planing patch with the water. */
export interface SkipContact {
  /** How wet this contact's part of the patch is, 0 dry to 1 wholly wet. */
  wet: number
  /** Depth (m, along the surface normal) over which this contact's part goes from dry to wet: the spring's reference. */
  full: number
  /** This contact's share of the planing patch; the shares of a hull sum to 1. */
  share: number
  /** Surface normal at the contact (unit). */
  nx: number; ny: number; nz: number
  /** Velocity at the contact relative to the water's own motion (current and the surface rising). */
  vx: number; vy: number; vz: number
  /** The hull's planing speed (`planingSpeed`), m/s. */
  planing: number
  /** Gravity, m/s², positive. */
  g: number
  /** The vehicle kind's factors on water.skip.friction and water.skip.keep (water.<kind>.skipFriction, skipKeep), default 1. */
  friction?: number
  keep?: number
}
/** Force per unit of the hull's whole mass, and the lift over weight it came from (0 when none). */
export interface SkipForce { x: number; y: number; z: number; q: number; /** The friction part of it, along the surface. */ fx?: number; fy?: number; fz?: number }

/** The planing lift at one contact, per unit of the hull's mass. Writes into and returns `out`. */
export function skipForce(c: SkipContact, out: SkipForce): SkipForce {
  out.x = out.y = out.z = out.q = out.fx = out.fy = out.fz = 0
  if (!(c.wet > 0) || !(c.share > 0) || !(c.full > 0) || !(c.g > 0) || !(c.planing > 0) || !Number.isFinite(c.planing)) return out
  const un = c.vx * c.nx + c.vy * c.ny + c.vz * c.nz
  const tx = c.vx - un * c.nx, ty = c.vy - un * c.ny, tz = c.vz - un * c.nz
  const vt = Math.hypot(tx, ty, tz)
  if (!Number.isFinite(un + vt)) return out
  const min = skipMinSpeed.value
  const fast = min > 0 ? THREE.MathUtils.smoothstep(vt, min * (1 - SKIP_MIN_FADE), min) : 1
  // Only a hull moving into the water at a shallow angle planes; rising out, it is the same lift.
  const angle = Math.atan2(Math.max(0, -un), vt) * THREE.MathUtils.RAD2DEG
  const flat = 1 - THREE.MathUtils.smoothstep(angle, skipAngle.value, skipAngle.value + SKIP_ANGLE_FADE)
  const q = Math.min(SKIP_MAX_RATIO, vt / c.planing) ** 2 * fast * flat
  if (!(q > 0)) return out
  const wet = Math.min(1, c.wet)
  const lift = c.g * q * wet * c.share
  // Damping of the spring (lift grows by g q share over `full` of depth) for the chosen
  // restitution: a spring-damper keeps exp(-zeta pi / sqrt(1 - zeta^2)) of its speed.
  const e = Math.sqrt(THREE.MathUtils.clamp(skipKeep.value * (c.keep ?? 1), 0.01, 0.99)), le = Math.log(e)
  const zeta = -le / Math.sqrt(Math.PI * Math.PI + le * le)
  // The water pushes, never pulls: the damper only eases the push as the hull leaves.
  const push = Math.max(0, lift - 2 * zeta * Math.sqrt(c.g * q / c.full) * c.share * un)
  const drag = vt > 1e-6 ? skipFriction.value * (c.friction ?? 1) * push / vt : 0
  out.x = c.nx * push - tx * drag
  out.y = c.ny * push - ty * drag
  out.z = c.nz * push - tz * drag
  out.q = q
  out.fx = -tx * drag; out.fy = -ty * drag; out.fz = -tz * drag
  return out
}

/**
 * The planing lift's share of a hull's support, from its lift over weight `q`: dynamic lift over
 * buoyancy at the same depth is about q, as both grow with the wetted patch. The bulk drag and
 * heave damping of a hull in the water give way by this share while it planes.
 */
export const skipShare = (q: number): number => q > 0 && Number.isFinite(q) ? q / (1 + q) : 0

/**
 * How much a vehicle hull's drag, heave and plough give way to its planing lift: its share
 * (`skipShare`), but only once the lift is carrying the hull, from half its weight to one and a
 * half times. A paddling hull's little planing lift leaves today's wallowing, turning and stopping
 * as they were.
 */
export const hullGiveWay = (q: number): number => skipShare(q) * THREE.MathUtils.smoothstep(q, 0.5, 1.5)

/**
 * How much a hull's coasting plough gives way to its planing lift: wholly while the lift carries
 * the hull's weight, and back in full by a quarter of it. The plough is the water winning once a
 * hull stops trying; a hull still on its planing lift has not stopped.
 */
export const ploughGiveWay = (q: number): number => q > 0 && Number.isFinite(q) ? THREE.MathUtils.smoothstep(q, 0.25, 1) : 0

/** Surface normal from the surface's slope (rise per metre along x and z). */
export function surfaceNormal(slopeX: number, slopeZ: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const sx = Number.isFinite(slopeX) ? slopeX : 0, sz = Number.isFinite(slopeZ) ? slopeZ : 0
  const l = Math.hypot(sx, 1, sz)
  out.x = -sx / l; out.y = 1 / l; out.z = -sz / l
  return out
}

// ---------------------------------------------------------------------------------------
// A vehicle's planing patch, from its own colliders, and its skip on the water.
// ---------------------------------------------------------------------------------------

/** Depth (m) over which a flat hull's corner goes from just touching to wholly planing. */
export const SKIP_FULL_DEPTH = 0.15
/** Depths (m) below the surface over which a hull's planing lift fades out as it goes under. */
export const SKIP_UNDER = [0.5, 1.5] as const
/** Rate (1/s) at which a planing contact damps a hull's pitch and roll, at full share. */
export const SKIP_STEADY = 8
/** Slope sample half width (m) for the surface normal at a contact. */
const SLOPE_SAMPLE = 0.5

/** The hull's planing patch in the body frame: its footprint and the height of its bottom. */
export interface PlaningPatch { minX: number; maxX: number; minZ: number; maxZ: number; bottom: number; area: number }

/** Rapier's shape types this reads (ShapeType in @dimforge/rapier3d-compat). */
const CUBOID = 1, ROUND_CUBOID = 12, CONVEX = 9, ROUND_CONVEX = 16
const patches = new WeakMap<object, { key: string; patch: PlaningPatch | null }>()
const pv = new THREE.Vector3(), pq = new THREE.Quaternion(), pt = new THREE.Vector3()

/** Minimal slice of a Rapier rigid body this reads, so tests can pass a stand-in. */
interface PatchBody {
  numColliders(): number
  collider(i: number): {
    isSensor(): boolean; shapeType(): number; halfExtents(): { x: number; y: number; z: number } | null; vertices(): Float32Array
    translationWrtParent(): { x: number; y: number; z: number } | null; rotationWrtParent(): { x: number; y: number; z: number; w: number } | null; handle: number
  }
}

/**
 * The footprint of a body's solid hull: every boxy or convex collider (chassis, hull, skid,
 * gear), not its wheels or a zorb's ball, in the body's own frame. Cached per body until its
 * colliders change. Null for a body with no such collider.
 */
export function planingPatch(body: PatchBody): PlaningPatch | null {
  let key = ''
  for (let i = 0; i < body.numColliders(); i++) key += body.collider(i).handle + ','
  const cached = patches.get(body)
  if (cached && cached.key === key) return cached.patch
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, bottom = Infinity
  const add = (x: number, y: number, z: number, t: { x: number; y: number; z: number } | null, r: { x: number; y: number; z: number; w: number } | null) => {
    pv.set(x, y, z)
    if (r) pv.applyQuaternion(pq.set(r.x, r.y, r.z, r.w))
    if (t) pv.add(pt.set(t.x, t.y, t.z))
    minX = Math.min(minX, pv.x); maxX = Math.max(maxX, pv.x); minZ = Math.min(minZ, pv.z); maxZ = Math.max(maxZ, pv.z); bottom = Math.min(bottom, pv.y)
  }
  for (let i = 0; i < body.numColliders(); i++) {
    const c = body.collider(i)
    if (c.isSensor()) continue
    const type = c.shapeType(), t = c.translationWrtParent(), r = c.rotationWrtParent()
    if (type === CUBOID || type === ROUND_CUBOID) {
      const h = c.halfExtents()
      if (!h) continue
      for (let k = 0; k < 8; k++) add(k & 1 ? h.x : -h.x, k & 2 ? h.y : -h.y, k & 4 ? h.z : -h.z, t, r)
    } else if (type === CONVEX || type === ROUND_CONVEX) {
      const v = c.vertices()
      for (let k = 0; k + 2 < v.length; k += 3) add(v[k], v[k + 1], v[k + 2], t, r)
    }
  }
  const patch = Number.isFinite(minX + maxX + minZ + maxZ + bottom) && maxX > minX && maxZ > minZ
    ? { minX, maxX, minZ, maxZ, bottom, area: (maxX - minX) * (maxZ - minZ) } : null
  patches.set(body, { key, patch })
  return patch
}

/** The liquid functions the skip reads. */
export interface SkipTerrain {
  liquidHeightAt?(x: number, z: number): number
  liquidKindAt?(x: number, z: number): string | null
  liquidFlowAt?(x: number, z: number, out: { x: number; z: number }): unknown
  liquidVerticalSpeedAt?(x: number, z: number): number
}
/** The body functions the skip reads and writes. */
export interface SkipBody extends PatchBody {
  isKinematic(): boolean
  mass(): number
  translation(): { x: number; y: number; z: number }
  rotation(): { x: number; y: number; z: number; w: number }
  velocityAtPoint(p: { x: number; y: number; z: number }): { x: number; y: number; z: number }
  addForce(f: { x: number; y: number; z: number }, wake: boolean): void
  angvel(): { x: number; y: number; z: number }
  principalInertia(): { x: number; y: number; z: number }
  addTorque(t: { x: number; y: number; z: number }, wake: boolean): void
  addForceAtPoint?(f: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, wake: boolean): void
}
/**
 * A planing hull's keel (the buggy's tyres): sideways grip at each planing corner in proportion
 * to that corner's planing push, as a tyre's grip on the ground follows its load. `grip` is the
 * side force over the push at full slip, `front` the front corners' share of it, `steer` the
 * front keel's angle (radians about up).
 */
export interface SkipKeel { grip: number; front: number; steer: number; /** The rear keel's angle (radians about up), counter to the front's: a skimming hull rides on its stern. */ rearSteer?: number; /** The step, s. */ dt?: number }
/** Sideways slip (m/s) at a planing corner at which its keel grip is full. */
export const KEEL_SLIP = 2

const kl = new THREE.Vector3(), corner = new THREE.Vector3(), rq = new THREE.Quaternion(), n = { x: 0, y: 1, z: 0 }, flow = { x: 0, z: 0 }
const contact: SkipContact = { wet: 0, full: SKIP_FULL_DEPTH, share: 0.25, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, planing: Infinity, g: 9.81 }
const force: Required<SkipForce> = { x: 0, y: 0, z: 0, q: 0, fx: 0, fy: 0, fz: 0 }
const fsum = { x: 0, y: 0, z: 0 }
/** The friction along the surface `applySkip` applied in its last call, N (zero when none). */
export const skipFrictionApplied = { x: 0, y: 0, z: 0 }

/** Surface height at (x, z) when it is water there, else NaN. */
function waterAt(terrain: SkipTerrain, x: number, z: number): number {
  if (terrain.liquidKindAt && terrain.liquidKindAt(x, z) !== 'water') return NaN
  const h = terrain.liquidHeightAt?.(x, z)
  return h === undefined ? NaN : h
}

/**
 * Planing lift on a vehicle at the water: its patch's four bottom corners, each a quarter of
 * the patch, on the real surface at each. `buoyancy` is the vehicle's reserve buoyancy over
 * weight: none, and it is not a planing hull (the tank). `factor` is its water.<kind>.planing.
 * `bottom` (body frame, m) overrides the patch's bottom where a hull meets the water below its
 * solid colliders: the buggy's tyres, which are not colliders. `atSurface` (0..1), when given,
 * replaces the depth fade below with the hull's own measure of being at the surface (the buggy's
 * lagged lift from effort and motion, which already fades as it goes under or gives up).
 * `kindFactors` are the vehicle kind's factors on the shared friction and energy kept.
 * Returns the largest lift over weight at any corner this step, 0 when it is not planing.
 */
export function applySkip(body: SkipBody, terrain: SkipTerrain, g: number, buoyancy: number, factor = 1, bottom?: number, atSurface?: number, kindFactors?: { friction: number; keep: number }, keel?: SkipKeel): number {
  if (!(buoyancy > 0) || body.isKinematic()) return 0
  const patch = planingPatch(body)
  if (!patch) return 0
  const mass = body.mass()
  const planing = planingSpeed(mass, patch.area, g, factor)
  if (!Number.isFinite(planing)) return 0
  const p = body.translation(), r = body.rotation()
  rq.set(r.x, r.y, r.z, r.w)
  contact.planing = planing; contact.g = g; contact.full = SKIP_FULL_DEPTH; contact.share = 0.25
  contact.friction = kindFactors?.friction ?? 1; contact.keep = kindFactors?.keep ?? 1
  let most = 0
  fsum.x = fsum.y = fsum.z = 0
  skipFrictionApplied.x = skipFrictionApplied.y = skipFrictionApplied.z = 0
  for (let i = 0; i < 4; i++) {
    corner.set(i & 1 ? patch.maxX : patch.minX, bottom ?? patch.bottom, i & 2 ? patch.maxZ : patch.minZ).applyQuaternion(rq)
    corner.x += p.x; corner.y += p.y; corner.z += p.z
    const surface = waterAt(terrain, corner.x, corner.z)
    if (!Number.isFinite(surface)) continue
    const lo = waterAt(terrain, corner.x - SLOPE_SAMPLE, corner.z), hi = waterAt(terrain, corner.x + SLOPE_SAMPLE, corner.z)
    const bk = waterAt(terrain, corner.x, corner.z - SLOPE_SAMPLE), fw = waterAt(terrain, corner.x, corner.z + SLOPE_SAMPLE)
    const slope = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (2 * SLOPE_SAMPLE)
      : Number.isFinite(b) ? (b - surface) / SLOPE_SAMPLE : Number.isFinite(a) ? (surface - a) / SLOPE_SAMPLE : 0
    surfaceNormal(slope(lo, hi), slope(bk, fw), n)
    const depth = (surface - corner.y) * n.y
    if (!(depth > 0)) continue
    // Planing is a surface effect: a hull gone under does not plane. The lift fades as its lowest
    // point goes from SKIP_UNDER[0] to SKIP_UNDER[1] below the surface: past where a floating
    // hull's bottom sits, until the hull itself is under (the old planing term faded within a
    // metre below the hull's middle).
    const surfaceShare = atSurface ?? 1 - THREE.MathUtils.smoothstep(depth, SKIP_UNDER[0], SKIP_UNDER[1])
    if (!(surfaceShare > 0)) continue
    contact.wet = Math.min(1, depth / SKIP_FULL_DEPTH) * surfaceShare
    flow.x = flow.z = 0
    terrain.liquidFlowAt?.(corner.x, corner.z, flow)
    const rise = terrain.liquidVerticalSpeedAt?.(corner.x, corner.z) ?? 0
    const v = body.velocityAtPoint(corner)
    contact.nx = n.x; contact.ny = n.y; contact.nz = n.z
    contact.vx = v.x - (Number.isFinite(flow.x) ? flow.x : 0)
    contact.vy = v.y - (Number.isFinite(rise) ? rise : 0)
    contact.vz = v.z - (Number.isFinite(flow.z) ? flow.z : 0)
    skipForce(contact, force)
    if (!(force.q > 0) || !Number.isFinite(force.x + force.y + force.z)) continue
    // Through the centre of mass, as the zorb's skim is: a skip is a bounce, not a wheelie. The
    // hull's own buoyancy (its columns or corners) keeps its attitude on the water; a push at the
    // corner pitched a light buggy nose-up on its tail while the tail went on planing.
    fsum.x += force.x * mass; fsum.y += force.y * mass; fsum.z += force.z * mass
    if (keel && keel.grip > 0 && body.addForceAtPoint) {
      // Sideways along the corner's keel (front corners turned by the steer), in the surface's
      // plane, opposing the corner's slip: it turns and slows the hull, never speeds it.
      const front = i < 2, a = front ? keel.steer : keel.rearSteer ?? 0
      kl.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(rq)
      const kn = kl.x * n.x + kl.y * n.y + kl.z * n.z
      kl.x -= kn * n.x; kl.y -= kn * n.y; kl.z -= kn * n.z
      const ll = Math.hypot(kl.x, kl.y, kl.z)
      const pushN = force.x * n.x + force.y * n.y + force.z * n.z
      if (ll > 1e-6 && pushN > 0) {
        kl.multiplyScalar(1 / ll)
        const slip = contact.vx * kl.x + contact.vy * kl.y + contact.vz * kl.z
        // No more than would stop this corner's quarter of the hull slipping within the step: a
        // touchdown's push (up to SKIP_MAX_RATIO squared times its weight) overshot in one step,
        // and the hull pirouetted from touch to touch.
        const cap = 0.5 * (mass / 4) * Math.abs(slip) / Math.max(keel.dt ?? 1 / 60, 1e-3)
        const side = -Math.sign(slip) * Math.min(cap, keel.grip * (front ? keel.front : 1) * pushN * mass * Math.min(1, Math.abs(slip) / KEEL_SLIP))
        // At the centre of mass's height, so it yaws the hull without rolling it over its tyres.
        if (Number.isFinite(side) && side !== 0) body.addForceAtPoint({ x: kl.x * side, y: kl.y * side, z: kl.z * side }, { x: corner.x, y: p.y, z: corner.z }, true)
      }
    }
    skipFrictionApplied.x += force.fx * mass; skipFrictionApplied.y += force.fy * mass; skipFrictionApplied.z += force.fz * mass
    most = Math.max(most, force.q)
  }
  if (most > 0) {
    body.addForce(fsum, true)
    // A planing surface steadies the hull: it resists pitching and rolling once it carries the
    // hull, so a skipping hull leaves each contact about level instead of tumbling (the hull's
    // own righting needs it wet, and planing it is mostly not). Damping only: it never spins it.
    const w = body.angvel(), I = body.principalInertia()
    // Only when the lift is carrying the hull (a skip or a plane), not a paddling hull's little lift.
    const k = SKIP_STEADY * THREE.MathUtils.smoothstep(most, 0.5, 1.5) * (I.x + I.z) / 2
    if (Number.isFinite(k + w.x + w.z) && k > 0) body.addTorque({ x: -w.x * k, y: 0, z: -w.z * k }, true)
  }
  return most
}

// ---------------------------------------------------------------------------------------
// Wet tyres grip the water sideways: steering a buggy on the water.
// ---------------------------------------------------------------------------------------
//
// The owner, 26 November 2026: "If it's skipping on the top of the tires or if it's wallowing,
// it should have good directional control as I turn the wheels left and right. Right now the
// skip has essentially no directional control." The planing contact above drags equally in every
// direction along the surface, so a skipping buggy's steered wheels turned its nose and not its
// path. A wet tyre is a keel: the water resists it moving sideways, along its own axle, in
// proportion to how much of it is wet. The steered wheels' axles turn with them, so lock turns the
// path. Strong while paddling (`wetGripWallow`, by wet depth); while the planing lift carries the hull
// the tyres grip by their planing push instead (`SkipKeel`, `wetGripSkip`: the owner, tight
// turns wallowing, wide arcs skipping), the two handing over by that lift's share (`hullGiveWay`).
//
// It only opposes the tyre's sideways slip, so it can turn and slow the hull but never give it
// speed. A pure function of the body's state, its wheels' steer and the water, as the skip is.

const WG = { group: 'Water', scope: 'world' as const }
/** Sideways grip of a wholly wet tyre while paddling (1/s): how quickly it kills its sideways slip. */
export const wetGripWallow = defineParam({ ...WG, id: 'water.buggy.wallowGrip', label: 'Buggy: wet tyre side grip, wallowing (1/s)', default: 3, min: 0, max: 20, step: 0.1 })
/**
 * Sideways grip of the tyres while the planing lift carries the hull (a skip or a skim), over
 * their planing push (`SkipKeel`): about 1 is the push's own size, wide arcs; lower is wider.
 */
export const wetGripSkip = defineParam({ ...WG, id: 'water.buggy.skipGrip', label: 'Buggy: tyre side grip while skipping (× planing push)', default: 1, min: 0, max: 3, step: 0.05 })

/**
 * The front tyres' share of the side grip, against the rear's 1. A hull grips the water hardest
 * aft, as a boat's keel and skeg do, so it weathervanes into its path; a front gripping as hard as
 * the rear (wetter, as the nose dips at a touchdown) turned a skipping buggy round on itself.
 */
/**
 * The rear tyres' share of the keel's steer, turned against the front's as the buggy's four-wheel
 * steer turns them slow. At speed a skimming buggy rides nose up on its rear tyres alone, so a
 * front-only keel steered nothing and the rear held the hull straight as a rail.
 */
export const wetGripRear = defineParam({ ...WG, id: 'water.buggy.keelRear', label: 'Buggy: rear tyres\' counter-steer on water (share of the lock)', default: 0.5, min: 0, max: 1, step: 0.05 })
export const wetGripFront = defineParam({ ...WG, id: 'water.buggy.keelFront', label: 'Buggy: front tyres\' share of the wet side grip', default: 0.4, min: 0, max: 1.5, step: 0.05 })

/** A wheeled hull's wheels for the wet grip: hub half track and half wheelbase, tyre radius, steer (radians, about up; front and rear axles). */
export interface WetWheels { x: number; z: number; radius: number; steerFront?: number; steerRear?: number }

const wp = new THREE.Vector3(), hub = new THREE.Vector3(), lat = new THREE.Vector3(), wq = new THREE.Quaternion(), wflow = { x: 0, z: 0 }
/**
 * Sideways grip of each wet tyre (see above). `bottom` is the tyres' bottom in the body frame
 * (liquidHull.ts `hullBottom`), `skipping` this step's planing lift over weight (`applySkip`).
 * Applied at the hub, so it steers the hull without rolling it over its tyres.
 */
export function applyWetGrip(body: SkipBody & { addForceAtPoint(f: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, wake: boolean): void }, terrain: SkipTerrain, wheels: WetWheels, bottom: number, skipping: number, dt: number): void {
  if (body.isKinematic()) return
  const k = Math.min(0.5 / Math.max(dt, 1e-3), wetGripWallow.value * (1 - hullGiveWay(skipping)))
  if (!(k > 0) || !(wheels.radius > 0)) return
  const p = body.translation(), r = body.rotation(), share = body.mass() / 4
  wq.set(r.x, r.y, r.z, r.w)
  for (let i = 0; i < 4; i++) {
    const front = i < 2, a = (front ? wheels.steerFront : wheels.steerRear) ?? 0
    wp.set(i & 1 ? wheels.x : -wheels.x, bottom, front ? -wheels.z : wheels.z).applyQuaternion(wq)
    wp.x += p.x; wp.y += p.y; wp.z += p.z
    const surface = waterAt(terrain, wp.x, wp.z)
    if (!Number.isFinite(surface)) continue
    // Wet from the tyre's bottom up to its hub, then wholly.
    const wet = THREE.MathUtils.clamp((surface - wp.y) / wheels.radius, 0, 1)
    if (!(wet > 0)) continue
    lat.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(wq)
    // At the hub: a tyre radius up the body's own up axis from its bottom.
    wp.add(hub.set(0, wheels.radius, 0).applyQuaternion(wq))
    const v = body.velocityAtPoint(wp)
    wflow.x = wflow.z = 0
    terrain.liquidFlowAt?.(wp.x, wp.z, wflow)
    const slip = (v.x - (Number.isFinite(wflow.x) ? wflow.x : 0)) * lat.x + v.y * lat.y + (v.z - (Number.isFinite(wflow.z) ? wflow.z : 0)) * lat.z
    const f = -k * (front ? wetGripFront.value : 1) * slip * wet * share
    if (!Number.isFinite(f) || f === 0) continue
    body.addForceAtPoint({ x: lat.x * f, y: lat.y * f, z: lat.z * f }, wp, true)
  }
}
