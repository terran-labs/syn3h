/**
 * The Mars Explorer buggy, ported from
 * `Martian Assets/Vehicles/Buggy/Components/Scripts/Buggy.js` (cited below as "Buggy.js NNN").
 *
 * The original never used WheelCollider. It is one rigid body, four raycasts and forces added
 * by hand, so this is a near line for line port onto a Rapier body. Read src/core/physics.ts
 * first: Unity is left handed with +Z forward, we are right handed with -Z forward.
 *
 * How the Unity semantics are reproduced:
 *  - Forces (ForceMode.Force) are accumulated during the step, as PhysX does, so every wheel
 *    reads the velocity from the start of the step, then turned into one impulse at the end.
 *  - Unity drag is `v *= 1 - drag * dt` after forces, before contacts. Rapier damping uses a
 *    different formula, so Rapier damping stays 0 and we scale the velocity ourselves.
 *  - Unity clamps angular speed to Rigidbody.maxAngularVelocity, 7 rad/s by default.
 *  - Wheel space formulas are evaluated in Unity components (z forward) so the original
 *    expressions, including their one sided clamps, read the same as the source.
 *
 * Stage A: driving only. Wings (Buggy.js 210-281) and buoyancy (435-475) come later; the
 * `wingOpen` flag is kept so those branches can slot in where the original has them.
 */
import * as THREE from 'three/webgpu'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import { defineParam } from '../../shared/params'
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_TERRAIN, GROUP_VEHICLE, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { Vehicle } from './Vehicle'

// ---------------------------------------------------------------------------------------
// Parameters. Defaults Settings.js 92-105, slider ranges Settings.js 944-991.
// ---------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------
// Constants from the original prefab and script.
// ---------------------------------------------------------------------------------------

/** Buggy.js 195. */
const MASS = 30
/** Buggy.js 48. */
const WHEEL_RADIUS = 0.3
/** Buggy.js 50-52. */
const MOTOR_MASS = 1
const MOTOR_DRAG = 1
const MAX_ACCELERATION = 60
/** Unity's default Rigidbody.maxAngularVelocity. */
const MAX_ANGULAR_VELOCITY = 7
/** Buggy.prefab `wheelPos` and `axelPos` (Unity local, read from the fork's text prefab). */
const WHEEL_POS = { x: 0.7, y: 0, z: 0.8 }
const AXEL_POS = { x: 0.375, y: -0.1, z: 0.75 }
/** "Vehicle Slick" physic material on the chassis collider. */
const CHASSIS_FRICTION = 0.1
const CHASSIS_RESTITUTION = 0.1

/**
 * Convex hull of the original "Collider" mesh (Buggy.jas, via the fork's Buggy2.fbx at import
 * scale 0.01 times the prefab's collider transform scale 2), already in our frame: nose at -Z.
 */
// prettier-ignore
const HULL = [
  0, 0.504, -0.013, 0.35, 0.168, -0.782, 0, 0.207, -0.792, 0.821, 0.07, -0.623, 0.69, -0.203, -0.531,
  0, -0.203, -0.7, 0.404, -0.203, -0.627, 0, -0.203, 0.906, 0.595, -0.203, 0.841, 0.821, 0.025, 0.308,
  0.821, 0.35, 0.491, 0, 0.5, 0.701, -0.821, 0.025, 0.308, -0.821, 0.35, 0.491, -0.69, -0.203, -0.531,
  -0.821, 0.07, -0.623, -0.595, -0.203, 0.841, -0.404, -0.203, -0.627, -0.35, 0.168, -0.782,
  -0.377, -0.085, -0.85, 0, -0.095, -0.959, 0.377, -0.085, -0.85, 0, 0.148, 1.041, 0, 0.499, 0.95,
  -0.821, 0.377, 0.828, 0.821, 0.377, 0.828,
]

/** Mathf.Lerp clamps t to 0..1. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

const UP = new THREE.Vector3(0, 1, 0)
const DEG = 180 / Math.PI

/** Wheel mount i in our local frame. Buggy.js 67: i%2 is right, i<2 is front. */
function wheelMount(i: number): THREE.Vector3 {
  return new THREE.Vector3(WHEEL_POS.x * (i % 2 ? 1 : -1), WHEEL_POS.y, -WHEEL_POS.z * (i < 2 ? 1 : -1))
}

export class Buggy extends Vehicle {
  readonly collider: RAPIER.Collider

  // Internal registers, Buggy.js 18-54. Arrays are per wheel: 0 FL, 1 FR, 2 RL, 3 RR.
  /** Unity leaves this float at 0 until smart suspension lerps it up. */
  suspensionRange = 0
  motorSpeed = 0
  motorTorque = 0
  motorAccel = MAX_ACCELERATION
  wingOpen = false
  isInverted = false
  readonly hitDistance = [-1, -1, -1, -1]
  readonly hitCompress = [0, 0, 0, 0]
  /** Contact point velocity in wheel space, Unity components (x right, y up, z forward). */
  readonly hitVelocity = [0, 1, 2, 3].map(() => new THREE.Vector3())
  /** Steering yaw of each wheel in our frame, radians about +Y. */
  readonly steer = [0, 0, 0, 0]
  /** Unity rigidbody.drag and angularDrag. Persist between steps like the Unity properties. */
  drag = 0.01
  angularDrag = 2
  /** True while the chassis uses Maximum friction combine (crashing). Buggy.js 477-483. */
  crashing = false

  private readonly wheelPositn = [0, 1, 2, 3].map(wheelMount)
  private comY = Number.NaN
  private readonly inertia: RAPIER.Vector
  private readonly inertiaFrame: RAPIER.Rotation
  private readonly comLocal = new THREE.Vector3(0, 0, -0.2)

  // Force accumulators for this step (world frame, torque about the centre of mass).
  private readonly accF = new THREE.Vector3()
  private readonly accT = new THREE.Vector3()
  private readonly accDV = new THREE.Vector3()
  private readonly accDW = new THREE.Vector3()

  // Visuals.
  private readonly wheelGroups: THREE.Group[] = []
  private readonly wheelSpinners: THREE.Object3D[] = []
  private readonly axels: THREE.Mesh[] = []

  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0) {
    super(game, terrain, position, heading)
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(HULL))!
      .setMass(MASS)
      .setFriction(CHASSIS_FRICTION)
      .setRestitution(CHASSIS_RESTITUTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(Vehicle.chassisGroups())
    this.collider = game.world.createCollider(desc, this.body)

    // Unity derives the inertia tensor from the collider at the body's mass and keeps it when
    // a script moves centerOfMass. Measure the hull's inertia once, then move all mass onto
    // the body so the centre of mass can follow buggyCG every step (Buggy.js 193-195).
    this.body.recomputeMassPropertiesFromColliders()
    const pi = this.body.principalInertia()
    const pf = this.body.principalInertiaLocalFrame()
    this.inertia = { x: pi.x, y: pi.y, z: pi.z }
    this.inertiaFrame = { x: pf.x, y: pf.y, z: pf.z, w: pf.w }
    this.collider.setDensity(0)
    this.updateMassProperties()

    this.buildVisuals()
  }

  /** Buggy.js 193-195. Only touches Rapier when the centre of mass actually moved. */
  private updateMassProperties(): void {
    // Unity centerOfMass (0, y, 0.2): z is forward, so ours is -0.2.
    const y = buggyCG.value * this.suspensionRange * 0.5
    if (Math.abs(y - this.comY) < 1e-5) return
    this.comY = y
    this.comLocal.set(0, y, -0.2)
    this.body.setAdditionalMassProperties(MASS, this.comLocal, this.inertia, this.inertiaFrame, true)
    this.body.recomputeMassPropertiesFromColliders()
  }

  // ---- Unity style force helpers -----------------------------------------------------

  private readonly tmpR = new THREE.Vector3()
  private readonly tmpC = new THREE.Vector3()

  private worldCom(out: THREE.Vector3): THREE.Vector3 {
    const c = this.body.worldCom()
    return out.set(c.x, c.y, c.z)
  }

  /** Rigidbody.AddForceAtPosition, ForceMode.Force. */
  private addForceAtPosition(f: THREE.Vector3, p: THREE.Vector3): void {
    this.accF.add(f)
    this.tmpR.subVectors(p, this.worldCom(this.tmpC))
    this.accT.add(this.tmpR.cross(f))
  }

  /**
   * Rigidbody.AddForceAtPosition, ForceMode.VelocityChange. PhysX adds the vector straight to
   * the linear velocity and `r x v` straight to the angular velocity, ignoring mass and inertia.
   */
  private addVelocityChangeAtPosition(dv: THREE.Vector3, p: THREE.Vector3): void {
    this.accDV.add(dv)
    this.tmpR.subVectors(p, this.worldCom(this.tmpC))
    this.accDW.add(this.tmpR.cross(dv))
  }

  /** Rigidbody.AddTorque, ForceMode.Force, world frame. */
  private addTorque(t: THREE.Vector3): void {
    this.accT.add(t)
  }

  /**
   * Hand the step's forces to Rapier with Unity's drag folded in.
   *
   * PhysX does `v' = (v + a * dt) * (1 - drag * dt)`, gravity included in `a`. Expanding that:
   * scale the current velocity by k = 1 - drag * dt now, and scale every force by k, adding
   * `m * g * (k - 1)` so Rapier's own gravity ends up scaled too. Forces must stay forces:
   * Rapier substeps its solver, so an impulse applied before the step is not equivalent to a
   * force and leaves a bias against gravity.
   */
  private flushForces(dt: number): void {
    const b = this.body
    const kv = Math.max(0, 1 - this.drag * dt)
    const kw = Math.max(0, 1 - this.angularDrag * dt)
    const v = b.linvel()
    const w = b.angvel()
    const av = { x: (w.x + this.accDW.x) * kw, y: (w.y + this.accDW.y) * kw, z: (w.z + this.accDW.z) * kw }
    // Unity's maxAngularVelocity cap, applied to the velocity we hand over.
    const wl = Math.hypot(av.x, av.y, av.z)
    if (wl > MAX_ANGULAR_VELOCITY) {
      const s = MAX_ANGULAR_VELOCITY / wl
      av.x *= s; av.y *= s; av.z *= s
    }
    b.setLinvel({ x: (v.x + this.accDV.x) * kv, y: (v.y + this.accDV.y) * kv, z: (v.z + this.accDV.z) * kv }, true)
    b.setAngvel(av, true)
    const g = this.game.world.gravity
    const m = b.mass()
    b.addForce({
      x: this.accF.x * kv + m * g.x * (kv - 1),
      y: this.accF.y * kv + m * g.y * (kv - 1),
      z: this.accF.z * kv + m * g.z * (kv - 1),
    }, true)
    b.addTorque({ x: this.accT.x * kw, y: this.accT.y * kw, z: this.accT.z * kw }, true)
    this.accF.set(0, 0, 0)
    this.accT.set(0, 0, 0)
    this.accDV.set(0, 0, 0)
    this.accDW.set(0, 0, 0)
  }

  // ---- Raycasts ------------------------------------------------------------------------

  /** Terrain and vehicles, never liquid (the original's `~1<<4` terrainMask), never ourselves. */
  private static readonly RAY_GROUPS = groups(GROUP_ALL, GROUP_TERRAIN | GROUP_VEHICLE)
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  private raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RAPIER.RayColliderHit | null {
    this.ray.origin = origin
    this.ray.dir = dir
    return this.game.world.castRay(
      this.ray, maxDist, true, undefined, Buggy.RAY_GROUPS, undefined, this.body,
    )
  }

  // ---- FixedUpdate, Buggy.js 178-484 --------------------------------------------------

  private readonly q = new THREE.Quaternion()
  private readonly qWheel = new THREE.Quaternion()
  private readonly qWheelInv = new THREE.Quaternion()
  private readonly qSteer = new THREE.Quaternion()
  private readonly pos = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly down = new THREE.Vector3()
  private readonly origin = new THREE.Vector3()
  private readonly hitPoint = new THREE.Vector3()
  private readonly vec = new THREE.Vector3()
  private readonly vec2 = new THREE.Vector3()

  protected applyForces(dt: number): void {
    const b = this.body
    const input = this.input
    const r = b.rotation()
    const t = b.translation()
    this.q.set(r.x, r.y, r.z, r.w)
    this.pos.set(t.x, t.y, t.z)
    this.up.copy(UP).applyQuaternion(this.q)
    this.down.copy(this.up).negate()
    const lv = b.linvel()
    const speed = Math.hypot(lv.x, lv.y, lv.z)

    // Self righting, Buggy.js 487-495. Unity runs OnCollisionStay after the physics step; the
    // contacts Rapier kept from the last step are the same information, read one step later.
    this.selfRight()

    let wheelsAreTouchingGround = false

    // Smart suspension, Buggy.js 180-192.
    if (buggySmartSuspension.value) {
      if (this.wingOpen && !this.raycast(this.pos, this.vec.set(0, -1, 0), 5)) {
        // Auto gear retract. Only reachable with wings open (stage B) or the unused new physics.
        if (this.suspensionRange > 0.01) this.suspensionRange -= dt * 0.5
        else this.suspensionRange = 0
      } else {
        this.suspensionRange = lerp(
          this.suspensionRange,
          this.wingOpen ? 0.5 : lerp(0.4, 0.2, Math.min(1, Math.abs(this.motorSpeed) / buggySpeed.value)),
          dt * 3,
        )
      }
    } else {
      this.suspensionRange = 0.4
    }
    this.updateMassProperties()

    const rayLength = this.suspensionRange + WHEEL_RADIUS

    // Remote copies the network layer drives kinematically only need wheel heights (199-208).
    if (b.isKinematic()) {
      for (let i = 0; i < 4; i++) {
        this.origin.copy(this.wheelPositn[i]).applyQuaternion(this.q).add(this.pos)
        const hit = this.raycast(this.origin, this.down, rayLength)
        if (hit) {
          this.motorSpeed = this.hitVelocity[i].z
          this.hitDistance[i] = hit.timeOfImpact
        } else this.hitDistance[i] = -1
      }
      return
    }

    // Drag and brake states, Buggy.js 287-299 (the not flying branch).
    if (input.brakes && speed < 1.5) {
      this.drag = input.y ? 2 : 50
      this.angularDrag = 1
    } else if (input.brakes && speed < 10) {
      this.drag = input.y ? 2 : 10
    } else {
      this.angularDrag = 0.2
      this.drag = 0.01
    }

    // Four wheel steering, Buggy.js 304-307. Quaternion.LookRotation((s, 0, 1 - |s|)) is a yaw
    // of atan2(s, 1 - |s|) toward Unity +X (right). Turning right in our frame is negative yaw.
    let s = input.x * (lerp(40, 30, speed / buggySpeed.value) / 90)
    this.steer[0] = this.steer[1] = -Math.atan2(s, 1 - Math.abs(s))
    s = -input.x * (lerp(20, 0, speed / buggySpeed.value) / 90)
    this.steer[2] = this.steer[3] = -Math.atan2(s, 1 - Math.abs(s))

    // Modified Yoggy physics: the motor, Buggy.js 393-396.
    const top = buggySpeed.value * 10
    this.motorTorque = Math.max(
      1,
      lerp(buggyPower.value * 5, 0, this.motorSpeed / top) * Math.abs(this.wingOpen ? 0 : input.y),
    )
    this.motorAccel = lerp(MAX_ACCELERATION, 0, this.motorSpeed / top)
    this.motorSpeed += (input.y * this.motorAccel) / MOTOR_MASS * dt
    this.motorSpeed += (-this.motorSpeed * (input.brakes ? 50 : MOTOR_DRAG)) / this.motorTorque * dt

    // Wheel and terrain contacts, Buggy.js 399-424.
    const hv = this.vec
    for (let i = 0; i < 4; i++) {
      this.origin.copy(this.wheelPositn[i]).applyQuaternion(this.q).add(this.pos)
      const hit = this.raycast(this.origin, this.down, rayLength)
      if (!hit) {
        this.hitDistance[i] = -1
        continue
      }
      wheelsAreTouchingGround = true
      this.hitDistance[i] = hit.timeOfImpact
      this.hitCompress[i] = -(hit.timeOfImpact / rayLength) + 1
      this.hitPoint.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)

      // wheels[i] is the chassis rotation times the steering yaw.
      this.qSteer.setFromAxisAngle(UP, this.steer[i])
      this.qWheel.multiplyQuaternions(this.q, this.qSteer)
      this.qWheelInv.copy(this.qWheel).invert()

      // hitVelocity = wheels[i].InverseTransformDirection(GetPointVelocity(mount)), kept in
      // Unity components: z forward.
      const pv = b.velocityAtPoint(this.origin)
      hv.set(pv.x, pv.y, pv.z).applyQuaternion(this.qWheelInv)
      this.hitVelocity[i].set(hv.x, hv.y, -hv.z)
      const hitVel = this.hitVelocity[i]

      // Riding on other rigid bodies, Buggy.js 404-409. DEVIATION: the original passes
      // `(hitVelocity - otherVelocity) / 4`, both in wheel space, to AddForceAtPosition with
      // ForceMode.VelocityChange. Summed over four wheels that adds the whole relative velocity
      // each step, so relative motion doubles every step and a buggy on a moving vehicle is
      // flung off (measured: 23 m/s off a 3 m/s platform). The commented alternatives next to
      // it in the original (`position += otherVelocity * dt / 4`) show the intent was to inherit
      // the other body's motion, so we use `(other - self) / 4` in world space. Kept: the
      // quarter per wheel and PhysX velocity change semantics (dv added as is, r x dv added to
      // the angular velocity).
      const other = hit.collider.parent()
      if (other && !other.isFixed()) {
        const ov = other.velocityAtPoint(this.hitPoint)
        this.vec2.set(ov.x - pv.x, ov.y - pv.y, ov.z - pv.z).multiplyScalar(0.25)
        this.addVelocityChangeAtPosition(this.vec2, this.hitPoint)
      }

      const speedAtWheel = hitVel.length()
      const friction =
        buggyTraction.value * 9 * lerp(0.5, 1, this.hitCompress[i]) * Math.max(1, (20 - speedAtWheel) / 4)
      // Vector3.Min against (1000, 1000, 1000): an upper clamp only, exactly as the original.
      const fx = Math.min(-hitVel.x * friction, 1000) // Sideslip
      const fz = Math.min(-(hitVel.z - this.motorSpeed) * friction, 1000) // Motor
      // Back to our wheel space (z mirrored), then to world.
      this.vec2.set(fx, 0, -fz).applyQuaternion(this.qWheel)
      this.addForceAtPosition(this.vec2, this.hitPoint)
      this.motorSpeed += ((hitVel.z - this.motorSpeed) * friction * dt) / this.motorTorque
    }

    // Suspension, Buggy.js 428-433. Wheel space y is chassis up, so hitVelocity.y is the
    // velocity along chassis up at the mount.
    for (let i = 0; i < 4; i++) {
      if (this.hitDistance[i] === -1) continue
      const f =
        -this.hitVelocity[i].y * buggyShocks.value * 1 * (this.wingOpen ? 3 : 1) +
        this.hitCompress[i] * (20 * MASS) * (this.wingOpen && i < 2 ? 8 : 1)
      this.origin.copy(this.wheelPositn[i]).applyQuaternion(this.q).add(this.pos)
      this.addForceAtPosition(this.vec2.copy(this.up).multiplyScalar(f), this.origin)
    }

    // Collision friction, Buggy.js 477-483: slick while driving, grippy while crashing.
    const crashing = !(this.wingOpen || wheelsAreTouchingGround || this.raycast(this.pos, this.down, 3))
    if (crashing !== this.crashing) {
      this.crashing = crashing
      this.collider.setFrictionCombineRule(
        crashing ? RAPIER.CoefficientCombineRule.Max : RAPIER.CoefficientCombineRule.Min,
      )
    }

    this.flushForces(dt)
  }

  /** Buggy.js 487-495, run over the chassis contacts Rapier found last step. */
  private selfRight(): void {
    const world = this.game.world
    const n = this.vec
    const w = this.body.angvel()
    const angSq = w.x * w.x + w.y * w.y + w.z * w.z
    world.contactPairsWith(this.collider, (other) => {
      world.contactPair(this.collider, other, (manifold, flipped) => {
        const count = manifold.numSolverContacts()
        if (count === 0) return
        // Unity's contact normal points from the other collider into this one. Rapier's points
        // out of the manifold's first collider, which is us unless `flipped`.
        const mn = manifold.normal()
        n.set(mn.x, mn.y, mn.z)
        if (!flipped) n.negate()
        const angleToNormal = this.up.angleTo(n) * DEG
        for (let c = 0; c < count; c++) {
          if (this.isInverted && angleToNormal < 50) this.isInverted = false
          else if (!this.isInverted && angSq < 5 && !this.wingOpen && angleToNormal > 120) this.isInverted = true
          if (this.isInverted) {
            // AddTorque(Cross(up, Vector3.up) * Angle(up, Vector3.up) * 3). A cross product
            // computed in our frame is already the mirrored Unity torque.
            this.vec2.crossVectors(this.up, UP).multiplyScalar(this.up.angleTo(UP) * DEG * 3)
            this.addTorque(this.vec2)
          }
        }
      })
    })
  }

  // ---- Visuals ------------------------------------------------------------------------

  private buildVisuals(): void {
    const body = new THREE.MeshStandardMaterial({ color: 0x7a1838, roughness: 0.45, metalness: 0.3 })
    const glass = new THREE.MeshStandardMaterial({ color: 0xe9a6e0, roughness: 0.15, metalness: 0.2 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 })
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.35, metalness: 0.8 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xfff1b0, emissiveIntensity: 0.6 })

    const pts: THREE.Vector3[] = []
    for (let i = 0; i < HULL.length; i += 3) pts.push(new THREE.Vector3(HULL[i], HULL[i + 1], HULL[i + 2]))
    const hull = new THREE.Mesh(new ConvexGeometry(pts), body)
    hull.castShadow = true
    this.object.add(hull)

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), glass)
    cockpit.scale.set(0.4, 0.24, 0.55)
    cockpit.position.set(0, 0.36, -0.05)
    cockpit.castShadow = true
    this.object.add(cockpit)

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.05, 0.38), body)
    spoiler.position.set(0, 0.6, 0.85)
    spoiler.rotation.x = -0.12
    spoiler.castShadow = true
    this.object.add(spoiler)
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.12), body)
      strut.position.set(x, 0.47, 0.82)
      this.object.add(strut)
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.03), lamp)
      light.position.set(x * 0.65, 0, -0.93)
      this.object.add(light)
    }

    const tyreGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.36, 18)
    tyreGeo.rotateZ(Math.PI / 2)
    const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.55, WHEEL_RADIUS * 0.55, 0.38, 10)
    rimGeo.rotateZ(Math.PI / 2)
    const spokeGeo = new THREE.BoxGeometry(0.39, WHEEL_RADIUS * 1.5, 0.06)
    const axelGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6)
    axelGeo.translate(0, 0.5, 0)

    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group()
      group.position.copy(this.wheelPositn[i])
      const spinner = new THREE.Group()
      const tyre = new THREE.Mesh(tyreGeo, dark)
      tyre.castShadow = true
      spinner.add(tyre, new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(spokeGeo, rimMat))
      group.add(spinner)
      this.object.add(group)
      this.wheelGroups.push(group)
      this.wheelSpinners.push(spinner)

      const axel = new THREE.Mesh(axelGeo, rimMat)
      axel.position.set(AXEL_POS.x * (i % 2 ? 1 : -1), AXEL_POS.y, -AXEL_POS.z * (i < 2 ? 1 : -1))
      this.object.add(axel)
      this.axels.push(axel)
    }
  }

  private readonly axelDir = new THREE.Vector3()

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha)
    // Buggy.js 169-175: wheels drop to the end of their travel when airborne, spin at half
    // the motor's rate (a quirk of the original), and axles point at the wheel hubs.
    const spin = (this.motorSpeed / WHEEL_RADIUS) * dt * 0.5
    for (let i = 0; i < 4; i++) {
      const g = this.wheelGroups[i]
      const d = this.hitDistance[i]
      g.position.y = WHEEL_POS.y - (d === -1 ? this.suspensionRange : d - WHEEL_RADIUS)
      g.rotation.y = this.steer[i]
      // Rolling toward -Z means the top of the wheel moves to -Z: negative rotation about +X.
      this.wheelSpinners[i].rotation.x -= spin
      const a = this.axels[i]
      this.axelDir.subVectors(g.position, a.position)
      a.scale.y = this.axelDir.length()
      a.quaternion.setFromUnitVectors(UP, this.axelDir.normalize())
    }
  }
}
