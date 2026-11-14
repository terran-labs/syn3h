/**
 * The Syn3h buggy (kinds 'buggy' and 'buggy-syn3h', the default), ported from the Syn3h Unity
 * client: `_Actors/Packages/Buggy/Components/Scripts/VhiclBuggy.cs` (cited "VB NNN"), with the
 * shared behaviour of `_Core/Scripts/Vhicl.cs` ("Vhicl NNN") and `VhiclMe.cs` ("Me NNN"), and
 * the serialized values of `_Actors/terra.buggy.prefab` ("prefab").
 *
 * Syn3h grew out of the Mars Explorer buggy (see ClassicBuggy.ts) but is a different machine:
 * 0.5 m wheels on a 2.6 x 2.6 m footprint, smoothed input, friction 13, softer shocks, a lerped
 * wing state, brakes that only bite when the wheels are loaded, auto brake at rest, and a
 * dedicated low friction skid plate instead of friction switching.
 *
 * Unity semantics (forces, drag, ForceMode, euler angles, handedness) live in unityBody.ts.
 */
import * as THREE from 'three/webgpu'
import { worldLavaAltitude } from '../../shared/params'
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import {
  buggyCG, buggyFlightAgility, buggyFlightDrag, buggyFlightLooPower, buggyFlightSlip, buggyIdleHold,
  buggyPower, buggyShocks, buggySpeed, buggyTraction,
} from './buggyParams'
import { applyLava, floatPoints } from './lava'
import type { BuggySkin } from './skins/BuggySkin'
import { DEG, UnityBody, lerp, signedAngle, unityEulerAngles } from './unityBody'
import { Vehicle, type WheelEffect, createWheelEffects } from './Vehicle'

// ---- prefab (terra.buggy.prefab) and VhiclBuggy.cs constants ----------------------------

/** Rigidbody m_Mass, m_Drag, m_AngularDrag. VB 180 no longer forces the mass in code. */
const MASS = 30
const PREFAB_DRAG = 0.01
const PREFAB_ANGULAR_DRAG = 2
/** VB 40-44. */
const WHEEL_RADIUS = 0.5
const MOTOR_MASS = 1
const MOTOR_DRAG = 1
const MAX_ACCELERATION = 60
/** Prefab WheelPos and AxelPos (Unity local). VB 73 moves the ray origin 0.22 further out. */
const WHEEL_POS = { x: 1.1, y: 0.1, z: 1.3 }
const RAY_OUTSET = 0.22
export const AXEL_POS = { x: 0.55, y: 0.15, z: 1.2 }
/** Prefab WingOpenSpeed. */
const WING_OPEN_SPEED = 12
/** Vhicl prefab InputSmoothingFactor. */
const INPUT_SMOOTHING = 10
/** VhiclMe.AutoBrakeMaxVelocitySquared (component default; VhiclMe is added at runtime). */
const AUTO_BRAKE_V2 = 1

/**
 * Convex hull of the "Collider" mesh of Syn3h Buggy.blend (the prefab's convex MeshCollider,
 * scale 1), read from public/models/buggy.glb whose frame matches Unity's (its wheel nodes sit
 * at WheelPos). Turned 180 degrees about Y into our frame: nose at -Z.
 */
// prettier-ignore
const HULL = [
  1.369, 0.426, 1.921, 1.369, 0.352, -1.608, 1.175, 0.41, -0.046, 1.274, 0.172, 1.819, 1.274, 0.172, -1.688,
  1.079, 0.172, -0.046, 0, 0.954, 2.165, -1.369, 0.426, 1.921, 0, 0.196, -2.012, -1.369, 0.352, -1.608,
  0, 0.172, -0.046, 0, 1.072, -0.046, -1.175, 0.41, -0.046, 0, 0.172, 1.798, -1.274, 0.172, 1.819,
  0, 0.172, -1.872, -1.274, 0.172, -1.688, -1.079, 0.172, -0.046,
]
/** Skid plate BoxCollider: size (2.5, 0.45, 3.481158), centre (0, 0.13976786, 0.090771556). */
const SKID_HALF = { x: 1.25, y: 0.225, z: 1.740579 }
const SKID_CENTER = { x: 0, y: 0.13976786, z: -0.090771556 }

const UP = new THREE.Vector3(0, 1, 0)
/** Float points over the Syn3h hull footprint (half width 1.37, half length 2.1). */
const FLOAT_POINTS = floatPoints(1.37, 2.1, 0, 0.5)
/** Wheel rays hit TerrainMask 257 only (Vhicl 21: layers Default and 8): never vehicles. */
const RAY_GROUPS = groups(GROUP_ALL, GROUP_TERRAIN)

/** VB 71-73: i%2 is right, i<2 is front; z flipped to our -Z forward. */
function rayOrigin(i: number): THREE.Vector3 {
  const sx = i % 2 ? 1 : -1
  return new THREE.Vector3(sx * (WHEEL_POS.x + RAY_OUTSET), WHEEL_POS.y, -WHEEL_POS.z * (i < 2 ? 1 : -1))
}

export interface SkinFactory {
  (): BuggySkin
}

export class Syn3hBuggy extends Vehicle {
  readonly kind: 'buggy' | 'buggy-syn3h'
  readonly hull: RAPIER.Collider
  readonly skid: RAPIER.Collider
  readonly ub: UnityBody

  // VhiclBuggy registers (VB 14-47). Wheels: 0 FL, 1 FR, 2 RL, 3 RR.
  suspensionRange = 0
  motorSpeed = 0
  motorTorque = 0
  motorAccel = MAX_ACCELERATION
  motorInputSmoothed = 0
  brakePower = 0
  wingState = 0
  shouldWingsBeOpen = false
  areWingsOpen = false
  isInverted = false
  totalSuspensionCompression = 0
  /** In lava or water this step. */
  inLiquid = false
  /** Vhicl.InputSmoothed and the mapped raw Input (Me 9-20). */
  readonly inputSmoothed = new THREE.Vector4()
  readonly inputRaw = new THREE.Vector4()
  /** Effective brake flag this step: the player's brakes or the idle auto brake. */
  brakes = false
  readonly hitDistance = [-1, -1, -1, -1]
  readonly hitCompress = [0, 0, 0, 0]
  /** Mount velocity in wheel space, Unity components (z forward). */
  readonly hitVelocity = [0, 1, 2, 3].map(() => new THREE.Vector3())
  /** Steering yaw per wheel, radians about our +Y. */
  readonly steer = [0, 0, 0, 0]


  /** Vehicle.getWheelEffects: persistent FL, FR, RL, RR entries from the last fixed step. */
  readonly wheelEffects: readonly WheelEffect[] = createWheelEffects(4)
  getWheelEffects(): readonly WheelEffect[] {
    return this.wheelEffects
  }

  private readonly origins = [0, 1, 2, 3].map(rayOrigin)
  private readonly inertia: RAPIER.Vector
  private readonly inertiaFrame: RAPIER.Rotation
  private readonly comLocal = new THREE.Vector3(0, 0, -0.2)
  private comY = Number.NaN

  // Visuals.
  private skin: BuggySkin | null = null
  private readonly fallback = new THREE.Group()
  private readonly fbWheels: THREE.Group[] = []
  private readonly fbSpinners: THREE.Object3D[] = []
  private readonly fbBody: THREE.MeshStandardMaterial
  private spin = 0

  constructor(
    game: Game,
    terrain: Terrain,
    position: THREE.Vector3,
    heading = 0,
    kind: 'buggy' | 'buggy-syn3h' = 'buggy',
    skinFactory?: SkinFactory,
  ) {
    super(game, terrain, position, heading)
    this.kind = kind
    const world = game.world
    // Physic material "Vehicle Body": friction 1, bounce 0.5, both Average. In Unity that
    // averaged with the default terrain material (0.6) to 0.8; our terrain has friction 1, so a
    // hull friction of 0.6 gives the same 0.8 when it scrapes the ground.
    this.hull = world.createCollider(
      RAPIER.ColliderDesc.convexHull(new Float32Array(HULL))!
        .setDensity(1)
        .setFriction(0.6)
        .setRestitution(0.5)
        .setCollisionGroups(Vehicle.chassisGroups()),
      this.body,
    )
    // Physic material "Vehicle Slick": dynamic friction 0 (static 0.5) with Multiply, bounce 0.25
    // Average. Rapier has one friction coefficient: we use the dynamic one, 0.
    this.skid = world.createCollider(
      RAPIER.ColliderDesc.cuboid(SKID_HALF.x, SKID_HALF.y, SKID_HALF.z)
        .setTranslation(SKID_CENTER.x, SKID_CENTER.y, SKID_CENTER.z)
        .setDensity(1)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitution(0.25)
        .setCollisionGroups(Vehicle.chassisGroups()),
      this.body,
    )
    // Unity derives the inertia tensor from the non trigger colliders at uniform density and the
    // rigidbody's mass, and keeps it when a script moves centerOfMass (VB 178-179). Measure the
    // two colliders at equal density, scale to 30 kg, then move all mass onto the body.
    this.body.recomputeMassPropertiesFromColliders()
    const s = MASS / this.body.mass()
    const pi = this.body.principalInertia()
    const pf = this.body.principalInertiaLocalFrame()
    this.inertia = { x: pi.x * s, y: pi.y * s, z: pi.z * s }
    this.inertiaFrame = { x: pf.x, y: pf.y, z: pf.z, w: pf.w }
    this.hull.setDensity(0)
    this.skid.setDensity(0)
    this.updateMassProperties()

    this.ub = new UnityBody(this.body, world, PREFAB_DRAG, PREFAB_ANGULAR_DRAG)

    this.fbBody = new THREE.MeshStandardMaterial({ color: this.colors.body, roughness: 0.4, metalness: 0.3 })
    this.buildFallback()
    this.object.add(this.fallback)
    if (skinFactory) this.attachSkin(skinFactory)
  }

  private attachSkin(factory: SkinFactory): void {
    let skin: BuggySkin
    try {
      skin = factory()
    } catch (err) {
      console.warn('Buggy skin failed, keeping the primitive model', err)
      return
    }
    this.skin = skin
    this.object.add(skin.object)
    skin.setColors(this.colors.body, this.colors.accent)
    skin.ready.then(
      () => { if (this.skin === skin) this.fallback.visible = false },
      (err) => {
        console.warn('Buggy model failed to load, keeping the primitive model', err)
        if (this.skin === skin) { skin.dispose(); this.skin = null }
      },
    )
  }

  protected override applyColors(): void {
    this.fbBody.color.set(this.colors.body)
    this.skin?.setColors(this.colors.body, this.colors.accent)
  }

  /** VB 178-179. Only touches Rapier when the centre of mass moved. */
  private updateMassProperties(): void {
    const y = buggyCG.value * this.suspensionRange * 0.5
    if (Math.abs(y - this.comY) < 1e-5) return
    this.comY = y
    // Unity (x, y, 0.2): z forward, ours -0.2.
    this.comLocal.set(0, y, -0.2)
    this.body.setAdditionalMassProperties(MASS, this.comLocal, this.inertia, this.inertiaFrame, true)
    this.body.recomputeMassPropertiesFromColliders()
  }

  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RAPIER.RayColliderIntersection | null {
    this.ray.origin = origin
    this.ray.dir = dir
    return this.game.world.castRayAndGetNormal(
      this.ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, RAY_GROUPS, undefined, this.body,
    )
  }

  /** Height of lava or sea under a point (Unity layer 4 raycasts). */
  private liquidAt(x: number, z: number): number {
    return this.terrain.liquidHeightAt?.(x, z) ?? worldLavaAltitude.value
  }

  // ---- input: Vhicl.FixedUpdate smoothing and VhiclMe mapping ----------------------------

  private updateInput(dt: number, speedSq: number): void {
    const i = this.input
    const raw = this.inputRaw.set(i.x, i.y, i.z, i.w)
    // Me 15-20: with wings shut, the throttle and yaw axes stand in for vertical and horizontal.
    if (!this.areWingsOpen) {
      if (raw.x > -0.1 && raw.x < 0.1) raw.x = raw.w
      if (raw.y > -0.1 && raw.y < 0.1) raw.y = raw.z
    } else {
      raw.z = (raw.z + 1) * 0.5
    }
    // Me 22-30: the Interact button brakes, and so does doing nothing at walking pace.
    const idle = raw.x === 0 && raw.y === 0 && raw.z === 0 && raw.w === 0
    this.brakes = i.brakes || (buggyIdleHold.value && idle && speedSq < AUTO_BRAKE_V2)
    // Vhicl 266-270.
    this.inputSmoothed.lerp(raw, Math.min(1, dt * INPUT_SMOOTHING))
    this.shouldWingsBeOpen = i.special
  }

  // ---- FixedUpdate, VB 153-542 -------------------------------------------------------

  private readonly up = new THREE.Vector3()
  private readonly down = new THREE.Vector3()
  private readonly origin = new THREE.Vector3()
  private readonly hitPoint = new THREE.Vector3()
  private readonly qWheel = new THREE.Quaternion()
  private readonly qWheelInv = new THREE.Quaternion()
  private readonly qSteer = new THREE.Quaternion()
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly euler = new THREE.Vector3()

  protected applyForces(dt: number): void {
    const ub = this.ub
    const b = this.body
    ub.begin()
    const q = ub.q
    const pos = ub.pos
    this.up.copy(UP).applyQuaternion(q)
    this.down.copy(this.up).negate()
    const lv = b.linvel()
    const speedSq = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z
    const myVelocity = Math.sqrt(speedSq)
    const S = buggySpeed.value
    const smoothed = this.inputSmoothed

    this.updateInput(dt, speedSq)
    this.selfRight(dt, speedSq)

    let wheelsAreTouchingGround = false
    this.totalSuspensionCompression = 0

    // Smart suspension, VB 160-176. Always on in Syn3h, driven by body speed, lerp rate 1.
    let desired = 0.5
    if (this.areWingsOpen) {
      if (!this.raycast(pos, this.v1.set(0, -1, 0), 5)) desired = 0
    } else {
      desired = lerp(0.4, 0.1, Math.min(1, myVelocity / S))
    }
    this.suspensionRange = lerp(this.suspensionRange, desired, dt * 1)
    this.updateMassProperties()
    const rayLength = this.suspensionRange + WHEEL_RADIUS

    // VB 185-197: kinematic copies only place their wheels.
    if (b.isKinematic()) {
      let grounded = 0
      for (let i = 0; i < 4; i++) {
        this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
        const hit = this.raycast(this.origin, this.down, rayLength)
        const eff = this.wheelEffects[i]
        eff.grounded = !!hit
        eff.slip = hit ? Math.abs(this.hitVelocity[i].x) : 0
        if (hit) {
          this.motorSpeed = this.hitVelocity[i].z
          this.hitDistance[i] = hit.timeOfImpact
          eff.point.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)
          eff.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
          grounded++
        } else this.hitDistance[i] = -1
      }
      this.wheelsGrounded = grounded
      return
    }

    // Wing state, VB 199-213.
    if (this.shouldWingsBeOpen && this.wingState > 0.95) this.wingState = 1
    else if (!this.shouldWingsBeOpen && this.wingState < 0.05) this.wingState = 0
    else this.wingState = lerp(this.wingState, this.shouldWingsBeOpen ? 1 : 0, dt * WING_OPEN_SPEED)
    this.areWingsOpen = this.wingState > 0.01
    this.wingsOpen = this.areWingsOpen

    // Four wheel steering, VB 215-221. LookRotation((s, 0, 1 - |s|)) is a yaw of
    // atan2(s, 1 - |s|) toward Unity +X; turning right is negative yaw in our frame.
    let s = smoothed.x * (lerp(30, 25, myVelocity / S) / 90)
    this.steer[0] = this.steer[1] = -Math.atan2(s, 1 - Math.abs(s))
    s = -smoothed.x * (lerp(30, 10, myVelocity / S) / 90)
    this.steer[2] = this.steer[3] = -Math.atan2(s, 1 - Math.abs(s))

    // Motor, VB 280-285.
    const top = S * 10
    this.motorTorque = Math.max(
      1,
      lerp(buggyPower.value * 5, 0, this.motorSpeed / top) * Math.abs(this.areWingsOpen ? 0 : smoothed.y),
    )
    this.motorAccel = lerp(MAX_ACCELERATION, 0, this.motorSpeed / top)
    this.motorSpeed += (smoothed.y * this.motorAccel) / MOTOR_MASS * dt
    this.motorSpeed += (-this.motorSpeed * (this.brakes ? 50 : MOTOR_DRAG)) / this.motorTorque * dt

    // Wheels, VB 288-332.
    const wasAirborne = this.wheelsGrounded === 0
    let grounded = 0
    const hv = this.v1
    for (let i = 0; i < 4; i++) {
      this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
      const hit = this.raycast(this.origin, this.down, rayLength)
      const eff = this.wheelEffects[i]
      if (!hit) {
        this.hitDistance[i] = -1
        eff.grounded = false
        eff.slip = 0
        continue
      }
      wheelsAreTouchingGround = true
      grounded++
      this.hitDistance[i] = hit.timeOfImpact
      this.hitCompress[i] = -(hit.timeOfImpact / rayLength) + 1
      this.totalSuspensionCompression += this.hitCompress[i]
      this.hitPoint.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)

      this.qSteer.setFromAxisAngle(UP, this.steer[i])
      this.qWheel.multiplyQuaternions(q, this.qSteer)
      this.qWheelInv.copy(this.qWheel).invert()
      const pv = b.velocityAtPoint(this.origin)
      hv.set(pv.x, pv.y, pv.z).applyQuaternion(this.qWheelInv)
      const hitVel = this.hitVelocity[i].set(hv.x, hv.y, -hv.z)
      eff.grounded = true
      eff.point.copy(this.hitPoint)
      eff.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
      eff.slip = Math.abs(hitVel.x)

      // VB 299-306, riding on rigid bodies. Only dynamic bodies in the terrain group can be hit
      // (wheel rays ignore vehicles), and the sign is the corrected one from the classic port:
      // inherit a quarter of the other body's motion per wheel, in world space.
      const other = hit.collider.parent()
      if (other && other.isDynamic()) {
        const ov = other.velocityAtPoint(this.hitPoint)
        this.v2.set(ov.x - pv.x, ov.y - pv.y, ov.z - pv.z).multiplyScalar(0.25)
        ub.addVelocityChangeAtPosition(this.v2, this.hitPoint)
      }

      const friction =
        buggyTraction.value * 13 * lerp(0.5, 1, this.hitCompress[i]) * Math.max(1, (20 - hitVel.length()) / 4)
      // Vector3.Min against (1000, 1000, 1000): an upper clamp only, as in the source.
      const fx = Math.min(-hitVel.x * friction, 1000) // Sideslip
      const fz = Math.min(-(hitVel.z - this.motorSpeed) * friction, 1000) // Motor
      this.v2.set(fx, 0, -fz).applyQuaternion(this.qWheel)
      ub.addForceAtPosition(this.v2, this.hitPoint)
      this.motorSpeed += ((hitVel.z - this.motorSpeed) * friction * dt) / this.motorTorque
    }
    this.wheelsGrounded = grounded
    this.landedThisStep = wasAirborne && grounded > 0
    if (this.landedThisStep) this.landingImpact = Math.max(0, -lv.y)

    // Suspension, VB 336-344: skipped while inverted, shocks at 0.8.
    const mass = b.mass()
    for (let i = 0; i < 4; i++) {
      if (this.hitDistance[i] === -1 || this.isInverted) continue
      const f =
        -this.hitVelocity[i].y * buggyShocks.value * 0.8 * (this.areWingsOpen ? 3 : 1) +
        this.hitCompress[i] * (20 * mass) * (this.areWingsOpen && i < 2 ? 8 : 1)
      this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
      ub.addForceAtPosition(this.v2.copy(this.up).multiplyScalar(f), this.origin)
    }

    if (this.shouldWingsBeOpen) this.fly(dt, myVelocity, smoothed)
    else {
      // Brakes and drag, VB 483-520. Brakes only bite with the wheels down and not bottomed out.
      const eligible = wheelsAreTouchingGround && this.totalSuspensionCompression <= 1
      ub.maxAngularVelocity = 7
      if (this.brakes && eligible && Math.abs(smoothed.y) > 0.01) {
        ub.drag = 2
        ub.angularDrag = 1
      } else if (this.brakes && eligible && myVelocity < 1.5) {
        ub.drag = 50
        ub.maxAngularVelocity = 0
        this.motorSpeed = 0
      } else if (this.brakes && eligible && myVelocity < 10) {
        ub.drag = 10
      } else {
        ub.angularDrag = 0.2
        ub.drag = 0.01
      }
    }

    // Lava and water (Mars Explorer Buggy.js 435-475, see lava.ts), after drag like the original.
    this.inLiquid = applyLava(ub, FLOAT_POINTS, (x, z) => this.liquidAt(x, z), {
      x: smoothed.x, y: smoothed.y, wingsOpen: this.areWingsOpen,
    })

    ub.flush(dt)
  }

  /** Flight, VB 389-480. Runs on the wish to fly (`_shouldWingsBeOpen`), as in the source. */
  private fly(dt: number, myVelocity: number, smoothed: THREE.Vector4): void {
    const ub = this.ub
    const q = ub.q
    this.motorInputSmoothed = lerp(
      smoothed.y,
      THREE.MathUtils.clamp(this.motorInputSmoothed + (this.brakes ? -0.8 : 0), -1.2, 1),
      0.8,
    )
    const mis = this.motorInputSmoothed
    const stallSpeed = 16
    const vel = ub.velocity
    const locVel = ub.inverseTransformDirectionUnity(vel, this.v1)
    const e = unityEulerAngles(q, this.euler)
    const roll = signedAngle(e.z)
    const pitch = signedAngle(e.x)
    const agility = buggyFlightAgility.value
    if (locVel.lengthSq() > stallSpeed) {
      ub.drag = (myVelocity / buggyFlightDrag.value) * 0.3

      if (this.brakes) {
        // Airbrakes, VB 402-408.
        if (this.brakePower < 1) this.brakePower += dt * 0.15
        const m = -this.brakePower * 2
        ub.addRelativeForce(locVel.x * m * 5, locVel.y * m * 100, locVel.z * 150 * m)
        ub.addRelativeTorque((pitch + smoothed.y * -100) * -2, smoothed.x * 280, roll * -1)
      } else {
        // Standard flight, VB 411-434: velocity follows the nose.
        this.brakePower = 0
        const fwd = ub.transformDirectionUnity(0, 0, 1, this.v2)
        const angDelta = vel.angleTo(fwd) * DEG
        if (angDelta > 10 && buggyFlightSlip.value) {
          ub.setVelocity(ub.transformDirectionUnity(
            locVel.x * 0.95, locVel.y * 0.95,
            locVel.z + (Math.abs(locVel.x) + Math.abs(locVel.y)) * 0.1 * (angDelta / 360),
            this.v2,
          ))
        } else {
          const boost = buggyFlightLooPower.value
            ? Math.abs(mis) / 10
            : mis < 0.999 && mis > -0.999 ? Math.abs(mis) / 10 : 0
          ub.setVelocity(ub.transformDirectionUnity(0, 0, locVel.length() + dt * 50 * boost, this.v2))
        }
        ub.addRelativeTorqueAcceleration(mis * 10 * agility, 0, smoothed.x * -13 * agility, dt)
      }

      // Dihedral, VB 436-451.
      if (Math.abs(smoothed.x) < 0.01 && (e.z < 90 || e.z > 270)) {
        ub.addRelativeTorque(0, roll * -0.6, e.z < 20 || e.z > 340 ? roll * -0.5 : 0)
      } else if (Math.abs(smoothed.x) < 0.01) {
        ub.addRelativeTorque(0, (e.z - 180) * 0.4, 0)
      }

      // Lava thermals, VB 459-466: lift within 10 m above lava or sea.
      const liquid = this.liquidAt(ub.pos.x, ub.pos.z)
      const d = ub.pos.y - liquid
      if (ub.pos.y < worldLavaAltitude.value + 10 && d >= 0 && d <= 10) {
        ub.addForce(this.v2.set(0, (10 - d) * 40, 0))
      }
      ub.angularDrag = 5
    } else {
      // Stalling, VB 474-479. `y + 0.5 * 100` is the source's precedence: y + 50.
      ub.angularDrag = 1
      ub.drag = (myVelocity / buggyFlightDrag.value) * 9
      ub.addRelativeTorque(smoothed.y + 0.5 * 100, 0, smoothed.x * -30)
    }
  }

  /** Self righting, VB 545-562, over the contacts Rapier kept from the last step. */
  private selfRight(dt: number, speedSq: number): void {
    const world = this.game.world
    const n = this.v1
    const w = this.body.angvel()
    const angSq = w.x * w.x + w.y * w.y + w.z * w.z
    for (const collider of [this.hull, this.skid]) {
      world.contactPairsWith(collider, (other) => {
        world.contactPair(collider, other, (manifold) => {
          const count = manifold.numSolverContacts()
          if (count === 0) return
          // Unity's contact normal points into this body. Rapier's sign depends on the pair's
          // internal order, so orient it from the contact point toward our centre of mass.
          const mn = manifold.normal()
          n.set(mn.x, mn.y, mn.z)
          const cp = manifold.solverContactPoint(0)
          const com = this.body.worldCom()
          if (cp && n.x * (com.x - cp.x) + n.y * (com.y - cp.y) + n.z * (com.z - cp.z) < 0) n.negate()
          const angle = this.up.angleTo(n) * DEG
          for (let c = 0; c < count; c++) {
            if (this.isInverted && angle < 50) this.isInverted = false
            else if (!this.isInverted && angle > 90) this.isInverted = true
            if (this.isInverted && angSq < 2 && speedSq < 8) {
              this.v2.crossVectors(this.up, UP).multiplyScalar(this.up.angleTo(UP) * DEG * 0.5)
              this.ub.addTorqueAcceleration(this.v2, dt)
            }
          }
        })
      })
    }
  }

  // ---- visuals -------------------------------------------------------------------------

  private buildFallback(): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.9 })
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < HULL.length; i += 3) pts.push(new THREE.Vector3(HULL[i], HULL[i + 1] - 0.2, HULL[i + 2]))
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4), this.fbBody)
    body.position.set(0, 0.45, 0)
    body.castShadow = true
    this.fallback.add(body)
    const tyre = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.48, 18)
    tyre.rotateZ(Math.PI / 2)
    const spoke = new THREE.BoxGeometry(0.5, WHEEL_RADIUS * 1.4, 0.08)
    const rim = new THREE.MeshStandardMaterial({ color: 0x89949f, roughness: 0.5, metalness: 0.5 })
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group()
      const spinner = new THREE.Group()
      const t = new THREE.Mesh(tyre, dark)
      t.castShadow = true
      spinner.add(t, new THREE.Mesh(spoke, rim))
      g.add(spinner)
      this.fallback.add(g)
      this.fbWheels.push(g)
      this.fbSpinners.push(spinner)
    }
  }

  private readonly wheelPos = new THREE.Vector3()
  private readonly lastWings = [0, 0, 0]

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha)
    // VB 135-149: wheels hang at full travel in the air; graphics spin at half the motor rate.
    this.spin -= (this.motorSpeed / WHEEL_RADIUS) * dt * 0.5
    for (let i = 0; i < 4; i++) {
      const d = this.hitDistance[i]
      this.wheelPos.set(
        WHEEL_POS.x * (i % 2 ? 1 : -1),
        WHEEL_POS.y - (d === -1 ? this.suspensionRange : d - WHEEL_RADIUS),
        -WHEEL_POS.z * (i < 2 ? 1 : -1),
      )
      this.skin?.setWheel(i, this.wheelPos, this.steer[i], this.spin)
      const g = this.fbWheels[i]
      g.position.copy(this.wheelPos)
      g.rotation.y = this.steer[i]
      this.fbSpinners[i].rotation.x = this.spin
    }
    // The skin rewrites every wing vertex, so only call it when something visible changed.
    const w = this.lastWings
    const ws = this.wingState, wx = this.inputSmoothed.x, wp = this.motorInputSmoothed
    if (this.skin && (Math.abs(ws - w[0]) > 1e-3 || (ws > 0 && (Math.abs(wx - w[1]) > 1e-3 || Math.abs(wp - w[2]) > 1e-3)))) {
      this.skin.setWings(ws, wx, wp)
      w[0] = ws; w[1] = wx; w[2] = wp
    }
  }

  override dispose(): void {
    this.skin?.dispose()
    super.dispose()
  }
}
