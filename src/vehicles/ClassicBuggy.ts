/**
 * The classic Mars Explorer buggy (kind 'buggy-classic'), ported from
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
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_TERRAIN, GROUP_VEHICLE, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import {
  buggyCG, buggyFlightAgility, buggyFlightDrag, buggyFlightLooPower, buggyFlightSlip, buggyPower, buggyShocks,
  buggySmartSuspension, buggySpeed, buggyTraction,
} from './buggyParams'
import { worldLavaAltitude } from '../../shared/params'
import type { BuggySkin } from './skins/BuggySkin'
import { applyLava, floatPoints } from './lava'
import { DEG, UnityBody, signedAngle, unityEulerAngles } from './unityBody'
import { Vehicle, type WheelEffect, createWheelEffects } from './Vehicle'

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
/** Buggy.prefab `wheelPos` and `axelPos` (Unity local, read from the fork's text prefab). */
const WHEEL_POS = { x: 0.7, y: 0, z: 0.8 }
const AXEL_POS = { x: 0.375, y: -0.1, z: 0.75 }
/** "Vehicle Slick" physic material on the chassis collider. */
const CHASSIS_FRICTION = 0.1
/** Friction of Unity's default physic material, which the original terrain used. */
const UNITY_TERRAIN_FRICTION = 0.6
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
/** Buggy.prefab Floats (12 points at scale 0.25) over the classic footprint. */
const FLOAT_POINTS = floatPoints(1, 1, -0.15, 0.15)

/** Wheel mount i in our local frame. Buggy.js 67: i%2 is right, i<2 is front. */
function wheelMount(i: number): THREE.Vector3 {
  return new THREE.Vector3(WHEEL_POS.x * (i % 2 ? 1 : -1), WHEEL_POS.y, -WHEEL_POS.z * (i < 2 ? 1 : -1))
}

export class ClassicBuggy extends Vehicle {
  readonly kind = 'buggy-classic' as const
  readonly collider: RAPIER.Collider

  // Internal registers, Buggy.js 18-54. Arrays are per wheel: 0 FL, 1 FR, 2 RL, 3 RR.
  /** Unity leaves this float at 0 until smart suspension lerps it up. */
  suspensionRange = 0
  motorSpeed = 0
  motorTorque = 0
  motorAccel = MAX_ACCELERATION
  wingOpen = false
  /** Buggy.js wingState: 1 to 2 opening, -1 to 0 closing, 0 at rest. */
  wingState = 0
  private lastSpecial = false
  motorInputSmoothed = 0
  brakePower = 0
  /** In lava or water this step. */
  inLiquid = false
  isInverted = false
  readonly hitDistance = [-1, -1, -1, -1]
  readonly hitCompress = [0, 0, 0, 0]
  /** Contact point velocity in wheel space, Unity components (x right, y up, z forward). */
  readonly hitVelocity = [0, 1, 2, 3].map(() => new THREE.Vector3())
  /** Steering yaw of each wheel in our frame, radians about +Y. */
  readonly steer = [0, 0, 0, 0]
  /** Unity rigidbody semantics: forces, drag, ForceMode (unityBody.ts). Prefab drag 0.01, angular 2. */
  readonly ub: UnityBody
  get drag(): number { return this.ub.drag }
  set drag(v: number) { this.ub.drag = v }
  get angularDrag(): number { return this.ub.angularDrag }
  set angularDrag(v: number) { this.ub.angularDrag = v }
  /** True while the chassis uses Maximum friction combine (crashing). Buggy.js 477-483. */
  crashing = false


  /** Vehicle.getWheelEffects: persistent FL, FR, RL, RR entries from the last fixed step. */
  readonly wheelEffects: readonly WheelEffect[] = createWheelEffects(4)
  getWheelEffects(): readonly WheelEffect[] {
    return this.wheelEffects
  }

  private readonly wheelPositn = [0, 1, 2, 3].map(wheelMount)
  private comY = Number.NaN
  private readonly inertia: RAPIER.Vector
  private readonly inertiaFrame: RAPIER.Rotation
  private readonly comLocal = new THREE.Vector3(0, 0, -0.2)

  // Visuals.
  private readonly wheelGroups: THREE.Group[] = []
  private readonly wheelSpinners: THREE.Object3D[] = []
  private readonly axels: THREE.Mesh[] = []

  private skin: BuggySkin | null = null
  private readonly fallback = new THREE.Group()
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x7a1838, roughness: 0.45, metalness: 0.3 })
  private spin = 0
  private readonly lastWings = [-1, 0, 0]
  private readonly euler = new THREE.Vector3()

  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0, skinFactory?: () => BuggySkin) {
    super(game, terrain, position, heading)
    this.ub = new UnityBody(this.body, game.world, 0.01, 2)
    this.object.add(this.fallback)
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
    if (skinFactory) {
      try {
        const skin = skinFactory()
        this.skin = skin
        this.object.add(skin.object)
        skin.setColors(this.colors.body, this.colors.accent)
        skin.ready.then(
          () => { if (this.skin === skin) this.fallback.visible = false },
          (err) => {
            console.warn('Classic buggy model failed to load, keeping primitives', err)
            if (this.skin === skin) { skin.dispose(); this.skin = null }
          },
        )
      } catch (err) {
        console.warn('Classic buggy skin failed, keeping primitives', err)
      }
    }
  }

  protected override applyColors(): void {
    this.bodyMaterial.color.set(this.colors.body)
    this.skin?.setColors(this.colors.body, this.colors.accent)
  }

  override dispose(): void {
    this.skin?.dispose()
    super.dispose()
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

  // ---- Unity style force helpers (see unityBody.ts) -------------------------------------

  private addForceAtPosition(f: THREE.Vector3, p: THREE.Vector3): void {
    this.ub.addForceAtPosition(f, p)
  }

  private addVelocityChangeAtPosition(dv: THREE.Vector3, p: THREE.Vector3): void {
    this.ub.addVelocityChangeAtPosition(dv, p)
  }

  private addTorque(t: THREE.Vector3): void {
    this.ub.addTorque(t)
  }

  private flushForces(dt: number): void {
    this.ub.flush(dt)
  }

  // ---- Raycasts ------------------------------------------------------------------------

  /** Terrain and vehicles, never liquid (the original's `~1<<4` terrainMask), never ourselves. */
  private static readonly RAY_GROUPS = groups(GROUP_ALL, GROUP_TERRAIN | GROUP_VEHICLE)
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  private raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RAPIER.RayColliderIntersection | null {
    this.ray.origin = origin
    this.ray.dir = dir
    return this.game.world.castRayAndGetNormal(
      this.ray, maxDist, true, undefined, ClassicBuggy.RAY_GROUPS, undefined, this.body,
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
    this.ub.begin()
    this.up.copy(UP).applyQuaternion(this.q)
    this.down.copy(this.up).negate()
    const lv = b.linvel()
    const speed = Math.hypot(lv.x, lv.y, lv.z)

    // Self righting, Buggy.js 487-495. Unity runs OnCollisionStay after the physics step; the
    // contacts Rapier kept from the last step are the same information, read one step later.
    this.selfRight()

    let wheelsAreTouchingGround = false

    // Wings, Buggy.js Update 105-122 and OnSetSpecialInput 501-513, run per fixed step so remote
    // copies agree. wingState runs 1 to 2 while opening and -1 to 0 while closing.
    if (input.special !== this.lastSpecial) {
      this.lastSpecial = input.special
      this.wingState = input.special ? 1 : -1
    }
    if (this.wingState !== 0) {
      this.wingState += dt * 2
      if (this.wingState >= 1) {
        this.wingOpen = true
        if (this.wingState > 2) this.wingState = 0
      } else if (this.wingState > 0) {
        this.wingOpen = false
        this.wingState = 0
      }
    }
    this.wingsOpen = this.wingOpen

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
        const eff = this.wheelEffects[i]
        eff.grounded = !!hit
        eff.slip = hit ? Math.abs(this.hitVelocity[i].x) : 0
        if (hit) {
          this.motorSpeed = this.hitVelocity[i].z
          this.hitDistance[i] = hit.timeOfImpact
          eff.point.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)
          eff.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
        } else this.hitDistance[i] = -1
      }
      this.wheelsGrounded = this.hitDistance.filter((d) => d !== -1).length
      return
    }

    if (this.wingOpen) this.fly(dt, speed)
    // Drag and brake states, Buggy.js 287-299 (the not flying branch).
    else if (input.brakes && speed < 1.5) {
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
      const eff = this.wheelEffects[i]
      if (!hit || this.isPassingVehicle(hit, this.origin)) {
        this.hitDistance[i] = -1
        eff.grounded = false
        eff.slip = 0
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
      eff.grounded = true
      eff.point.copy(this.hitPoint)
      eff.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
      eff.slip = Math.abs(hitVel.x)

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

    const wasAirborne = this.wheelsGrounded === 0
    this.wheelsGrounded = this.hitDistance.filter((d) => d !== -1).length
    this.landedThisStep = wasAirborne && this.wheelsGrounded > 0
    if (this.landedThisStep) this.landingImpact = Math.max(0, -lv.y)

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
      // Unity: Maximum combine against Unity's default terrain material (friction 0.6). Our
      // terrain has friction 1, so Max would grip 1.7 times harder while the body scrapes and
      // trip a buggy into a roll more easily. Min against 0.6 reproduces Unity's result.
      this.collider.setFriction(crashing ? UNITY_TERRAIN_FRICTION : CHASSIS_FRICTION)
    }

    // Lava and water, Buggy.js 435-475 (lava.ts).
    this.inLiquid = applyLava(this.ub, FLOAT_POINTS, (x, z) => this.terrain.liquidHeightAt?.(x, z) ?? worldLavaAltitude.value, {
      x: input.x, y: input.y, wingsOpen: this.wingOpen,
    })

    this.flushForces(dt)
  }

  /** Wing flight, Buggy.js 210-281. */
  private fly(dt: number, speed: number): void {
    const ub = this.ub
    const input = this.input
    this.motorInputSmoothed = lerp(input.y, this.motorInputSmoothed + (input.brakes ? -1 : 0), 0.8)
    const mis = this.motorInputSmoothed
    const stallSpeed = 16
    const vel = ub.velocity
    const locVel = ub.inverseTransformDirectionUnity(vel, this.vec)
    const e = unityEulerAngles(ub.q, this.euler)
    const roll = signedAngle(e.z)
    const pitch = signedAngle(e.x)
    const agility = buggyFlightAgility.value
    if (locVel.lengthSq() > stallSpeed) {
      this.drag = (speed / buggyFlightDrag.value) * 0.3
      if (input.brakes) {
        // Airbrakes, 221-226.
        if (this.brakePower < 1) this.brakePower += dt * 0.15
        const m = -this.brakePower * 2
        ub.addRelativeForce(locVel.x * m * 5, locVel.y * m * 100, locVel.z * 150 * m)
        ub.addRelativeTorque((pitch + input.y * -100) * -2, input.x * 280, roll * -1)
      } else {
        // Standard flight, 229-241: velocity follows the nose.
        this.brakePower = 0
        const fwd = ub.transformDirectionUnity(0, 0, 1, this.vec2)
        const angDelta = vel.angleTo(fwd) * DEG
        if (angDelta > 10 && buggyFlightSlip.value) {
          ub.setVelocity(ub.transformDirectionUnity(
            locVel.x * 0.95, locVel.y * 0.95,
            locVel.z + (Math.abs(locVel.x) + Math.abs(locVel.y)) * 0.1 * (angDelta / 360),
            this.vec2,
          ))
        } else {
          const boost = buggyFlightLooPower.value
            ? Math.abs(mis) / 10
            : mis < 0.999 && mis > -0.999 ? Math.abs(mis) / 10 : 0
          ub.setVelocity(ub.transformDirectionUnity(0, 0, locVel.length() + dt * 50 * boost, this.vec2))
        }
        ub.addRelativeTorque(mis * 100 * agility, 0, input.x * -100 * agility)
      }
      // Dihedral, 243-256.
      if (!input.x && (e.z < 90 || e.z > 270)) {
        ub.addRelativeTorque(0, roll * -0.6, e.z < 20 || e.z > 340 ? roll * -0.5 : 0)
      } else if (!input.x) {
        ub.addRelativeTorque(0, (e.z - 180) * 0.4, 0)
      }
      // Lava thermals, 264-267. When the first test passes Unity never casts, and the stale hit
      // distance is 0, so the lift is a flat 400 N; otherwise (10 - distance) * 40.
      const liquid = this.terrain.liquidHeightAt?.(ub.pos.x, ub.pos.z) ?? worldLavaAltitude.value
      const d = ub.pos.y - liquid
      if (ub.pos.y < worldLavaAltitude.value + 10) ub.addForce(this.vec2.set(0, 400, 0))
      else if (d >= 0 && d <= 10) ub.addForce(this.vec2.set(0, (10 - d) * 40, 0))
      this.angularDrag = 5
    } else {
      // Stalling, 274-279. `input.y + 0.5 * 100` is the source's precedence: y + 50.
      this.angularDrag = 1
      this.drag = (speed / buggyFlightDrag.value) * 9
      ub.addRelativeTorque(input.y + 0.5 * 100, 0, input.x * -30)
    }
  }

  /**
   * DEVIATION (head-on launch fix). The original's wheel rays hit other vehicles so you can ride
   * on them, but in a head-on crash a ray lands on the other buggy's bonnet at 20+ m/s closing
   * speed: full suspension compression plus the riding velocity change spun buggies at 10 rad/s.
   * A wheel only stands on another vehicle when the two move together, so a vehicle hit counts
   * only below 3 m/s relative speed at the contact; otherwise the chassis colliders handle it.
   */
  private isPassingVehicle(hit: RAPIER.RayColliderIntersection, origin: THREE.Vector3): boolean {
    const other = hit.collider.parent()
    if (!other || other.isFixed() || !(hit.collider.collisionGroups() >>> 16 & GROUP_VEHICLE)) return false
    const p = this.hitPoint.copy(this.down).multiplyScalar(hit.timeOfImpact).add(origin)
    const ov = other.velocityAtPoint(p)
    const sv = this.body.velocityAtPoint(origin)
    return Math.hypot(ov.x - sv.x, ov.y - sv.y, ov.z - sv.z) > 3
  }

  /** Buggy.js 487-495, run over the chassis contacts Rapier found last step. */
  private selfRight(): void {
    const world = this.game.world
    const n = this.vec
    const w = this.body.angvel()
    const angSq = w.x * w.x + w.y * w.y + w.z * w.z
    world.contactPairsWith(this.collider, (other) => {
      world.contactPair(this.collider, other, (manifold) => {
        const count = manifold.numSolverContacts()
        if (count === 0) return
        // Unity's contact normal points into this body. Rapier's sign depends on the pair's
        // internal order, so orient it from the contact point toward our centre of mass.
        const mn = manifold.normal()
        n.set(mn.x, mn.y, mn.z)
        const cp = manifold.solverContactPoint(0)
        const com = this.body.worldCom()
        if (cp && n.x * (com.x - cp.x) + n.y * (com.y - cp.y) + n.z * (com.z - cp.z) < 0) n.negate()
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
    const body = this.bodyMaterial
    const glass = new THREE.MeshStandardMaterial({ color: 0xe9a6e0, roughness: 0.15, metalness: 0.2 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 })
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.35, metalness: 0.8 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xfff1b0, emissiveIntensity: 0.6 })

    const pts: THREE.Vector3[] = []
    for (let i = 0; i < HULL.length; i += 3) pts.push(new THREE.Vector3(HULL[i], HULL[i + 1], HULL[i + 2]))
    const hull = new THREE.Mesh(new ConvexGeometry(pts), body)
    hull.castShadow = true
    this.fallback.add(hull)

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), glass)
    cockpit.scale.set(0.4, 0.24, 0.55)
    cockpit.position.set(0, 0.36, -0.05)
    cockpit.castShadow = true
    this.fallback.add(cockpit)

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.05, 0.38), body)
    spoiler.position.set(0, 0.6, 0.85)
    spoiler.rotation.x = -0.12
    spoiler.castShadow = true
    this.fallback.add(spoiler)
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.12), body)
      strut.position.set(x, 0.47, 0.82)
      this.fallback.add(strut)
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.03), lamp)
      light.position.set(x * 0.65, 0, -0.93)
      this.fallback.add(light)
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
      this.fallback.add(group)
      this.wheelGroups.push(group)
      this.wheelSpinners.push(spinner)

      const axel = new THREE.Mesh(axelGeo, rimMat)
      axel.position.set(AXEL_POS.x * (i % 2 ? 1 : -1), AXEL_POS.y, -AXEL_POS.z * (i < 2 ? 1 : -1))
      this.fallback.add(axel)
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
      this.skin?.setWheel(i, g.position, this.steer[i], this.wheelSpinners[i].rotation.x)
      const a = this.axels[i]
      this.axelDir.subVectors(g.position, a.position)
      a.scale.y = this.axelDir.length()
      a.quaternion.setFromUnitVectors(UP, this.axelDir.normalize())
    }
    // Buggy.js 126-163: the wing scales open 1 to 2 and shut -1 to 0, then flexes with input.
    const ws = this.wingState
    const open = ws >= 1 ? ws - 1 : ws < 0 ? -ws : this.wingOpen ? 1 : 0
    const w = this.lastWings, wx = this.input.x, wp = this.motorInputSmoothed
    if (this.skin && (Math.abs(open - w[0]) > 1e-3 || (open > 0 && (Math.abs(wx - w[1]) > 1e-3 || Math.abs(wp - w[2]) > 1e-3)))) {
      this.skin.setWings(open, wx, wp)
      w[0] = open; w[1] = wx; w[2] = wp
    }
  }
}
