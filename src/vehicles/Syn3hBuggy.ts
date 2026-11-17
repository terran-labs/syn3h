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
import { seaLevel } from '../world/seaLevel'
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import {
  buggyBumpStop, buggyCG, buggyCoastDrag, buggyDownforce, buggyFin, buggyFinAir, buggyFlightAgility, buggyFlightDrag, buggyFlightLooPower, buggyFlightModel, buggyFlightSlip, buggyGrip,
  buggyGripFade, buggyIdleHold, buggyNextGen, buggyPower, buggyRebound, buggyRegen, buggyRideHeight, buggyRearSteerFast, buggyShocks, buggySideGrip, buggySideHold, buggySlide, buggySpeed, buggyStability, buggySteerFollow, buggySteerLimit,
  buggyTraction,
} from './buggyParams'
import { applyLava, floatPoints, lavaViscosity } from './lava'
import type { BuggySkin } from './skins/BuggySkin'
import { retryDelay } from './skins/modelLoader'
import { type MotorDriveInput, motorDrive, smoothEffort } from './skins/motorDrive'
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
/** Front to rear axle distance from WheelPos, for the next-gen steering limit. */
const WHEELBASE = WHEEL_POS.z * 2
export const AXEL_POS = { x: 0.55, y: 0.15, z: 1.2 }
/**
 * The driver's eye above the origin. The Unity prefab's RideCam sat at 0.95, a hand's width
 * under the canopy. With the cockpit tub the seat is lower: 0.8 is half a metre above the tub
 * floor and a quarter of a metre clear of the canopy.
 */
const RIDE_HEIGHT = 0.8
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

/**
 * Next-gen tyre contact (not from Syn3h). Each wheel is a brush: while it holds, slip winds up a
 * stiff spring-damper in the wheel plane, so the buggy truly parks on a slope and corners
 * without sideslip. The force is capped at mu x load, where mu goes from buggy.grip at rest to
 * buggy.slide (grip at speed) by the grip fade speed, and drops to SLIDE_RATIO of that as the
 * slip speed rises (SLIP_GRIP to SLIP_SLIDE). TYRE_MASS is the share of the body one wheel
 * acts on; TYRE_DAMP cancels half the slip per 50 Hz step; TYRE_OMEGA (rad/s) sets the
 * spring, which holds a 30 degree slope with about 2 cm of wind up.
 */
const TYRE_MASS = MASS / 4
const TYRE_DAMP = 0.5
const TYRE_OMEGA = 15
/** Slip speeds (m/s) over which friction falls from its peak to SLIDE_RATIO of it. */
const SLIP_GRIP = 1
const SLIP_SLIDE = 4
const SLIDE_RATIO = 0.8
/** Tyre slip angles (degrees) between which grip falls to buggy.sideGrip; see tyre(). */
const SIDE_ANGLE_GRIP = 40
const SIDE_ANGLE_SLIDE = 70
/** Speeds (m/s) over which that takes effect, so low speed handling keeps its grip. */
const SIDE_SPEED_MIN = 6
const SIDE_SPEED_FULL = 14
/**
 * Wing flight model 1, Catch (see buggy.flightModel): for CATCH_TIME seconds after the wings
 * open, the motion turns toward the nose at CATCH_START degrees a second, rising with the
 * square of the time to CATCH_END.
 */
const CATCH_TIME = 1.5
const CATCH_START = 30
const CATCH_END = 360
/**
 * Wing flight model 2, Glide: the motion turns toward the nose at GLIDE_LIFT radians a second
 * per m/s of speed (a centripetal pull of GLIDE_LIFT v squared, as lift gives), never pulling
 * more than GLIDE_G g, and trades speed for height at GLIDE_GRAVITY of free fall.
 */
const GLIDE_LIFT = 0.07
const GLIDE_G = 5
const GLIDE_GRAVITY = 0.6
/** A change of velocity in one step (m/s) that counts as a blow, for the force fields' absorb effect. */
const BLOW_MIN = 4
/** The change that shows at full strength, and the shortest time (s) between two blows shown. */
const BLOW_FULL = 14
const BLOW_GAP = 0.12
/** Body slide (degrees) the front wheels ignore before they follow the travel direction. */
const FOLLOW_DEAD = 3
/** Furthest (degrees) the front wheels swing to follow it. */
const FOLLOW_MAX = 45
/** Speeds (m/s) over which the counter-steer and stability assists come in. */
const ASSIST_SPEED_MIN = 10
const ASSIST_SPEED_FULL = 20
/** How long (s) after its wheels touch down a landing counts as one; see buggy.sideHold. */
const LANDING_SLIDE = 0.7
/** Speed (m/s) at which buggy.downforce is quoted, and the speed past which it stops growing. */
const AERO_SPEED = 40
const AERO_SPEED_MAX = 60
/** Tail fin: side acceleration per (m/s sideways at the tail) per (m/s of speed) at buggy.fin 1. */
const FIN = 0.005
/** Where the fin acts, behind the origin (m). */
const FIN_Z = 1.8
/** Next-gen steering limit at rest, as a multiple of grip; see buggy.steerLimit. */
const STEER_LIMIT_SLOW = 1.1
/** Next-gen drivetrain (see drivetrain()): below HOLD_SPEED (m/s) with no throttle it parks. */
const HOLD_SPEED = 1.5
/** How fast (m/s^2) the hold eases the wheels to a stop, so it settles instead of snapping. */
const HOLD_DECEL = 3
/** Below this speed the reverse key reverses instead of regenerating. */
const REVERSE_SPEED = 0.5
const THROTTLE_DEADZONE = 0.05
/** Slowest the wheels turn under full throttle (m/s at the tread); see driveFloor(). */
const DRIVE_FLOOR = 3
/** Regen force allowed beyond its nominal deceleration, to cover slopes and bumps. */
const REGEN_TORQUE_MARGIN = 1.25
/** A contact point closer than this (m) is touching; further ones are only predicted. */
const CONTACT_TOUCH = 0.01
/** How fast (1/s) water drags the wheels toward the body's speed while floating. */
const WATER_MOTOR_DRAG = 6
/** Fastest a kinematic copy is carried (m/s); see carriedVelocity(). */
const CARRIED_MAX = 200
/**
 * Next-gen bump stop (see suspensionForce()). The skid plate meets flat ground when a wheel ray
 * is about 0.185 m long, so the stop works over ray lengths BUMP_START down to BUMP_END, and
 * multiplies the damper by up to 1 + BUMP_DAMP there to soak up the hit instead of returning it.
 */
const BUMP_START = 0.4
const BUMP_END = 0.2
const BUMP_DAMP = 3

function moveToward(v: number, target: number, step: number): number {
  return v > target ? Math.max(target, v - step) : Math.min(target, v + step)
}

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

/** Fresh skins tried when building one fails outright (a download failure retries inside). */
const SKIN_ATTEMPTS = 6

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
  /** Floating in water this step, or immersed in lava (set by the base class). */
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
  /** Next-gen tyres: sliding flag and brush wind up (wheel frame, Unity x lateral, z forward). */
  readonly sliding = [false, false, false, false]
  private readonly windX = [0, 0, 0, 0]
  private readonly windZ = [0, 0, 0, 0]
  /** Next-gen drivetrain state this step (see drivetrain()). */
  drive: 'drive' | 'coast' | 'regen' | 'hold' = 'hold'
  private regenForce = 0
  /** Motor speed at the start of this step's wheel pass (next-gen). */
  private motorStep = 0
  /** Seconds left in which a touchdown still counts as a landing (see LANDING_SLIDE). */
  private landingSlide = 0
  /** Seconds the wings have been asked open, for the Catch flight model. */
  private wingTime = 0


  /** The driver's eye, for the ride camera (see RIDE_HEIGHT). */
  override readonly ridePosition = new THREE.Object3D()

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
  private readonly fbMaterials: THREE.MeshStandardMaterial[] = []
  private spin = 0
  private skinReady = false
  private skinAttempts = 0
  private skinRetry: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private ghostClock = 0

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
    this.ridePosition.position.set(0, RIDE_HEIGHT, 0)
    this.object.add(this.ridePosition)
    // A vehicle with a cockpit: the ride camera sits in it and hides nothing (PATTERN.md rule 3).
    this.object.userData.cockpit = true

    this.fbBody = new THREE.MeshStandardMaterial({ color: this.colors.body, roughness: 0.4, metalness: 0.3 })
    this.buildFallback()
    this.object.add(this.fallback)
    if (skinFactory) this.attachSkin(skinFactory)
  }

  /**
   * True once the real body is showing. Until then the vehicle draws its primitive stand in,
   * as a translucent pulsing ghost so it never passes for the final look.
   */
  get bodyReady(): boolean {
    return this.skinReady
  }

  /**
   * Build the skin and show it when its models arrive. The skin's own loader retries a failed
   * download until it succeeds (modelLoader.ts), so a rejection here means building the skin
   * itself failed: try a fresh skin after a growing delay, a few times, rather than keeping
   * the stand in for the rest of the session (which the player could only fix by reloading).
   */
  private attachSkin(factory: SkinFactory): void {
    if (this.disposed) return
    this.skinAttempts++
    let skin: BuggySkin
    try {
      skin = factory()
    } catch (err) {
      console.warn('Buggy skin failed to build', err)
      this.retrySkin(factory)
      return
    }
    this.skin = skin
    this.object.add(skin.object)
    skin.setColors(this.colors.body, this.colors.accent)
    skin.ready.then(
      () => {
        if (this.skin !== skin || this.disposed) return
        this.skinReady = true
        this.showBody()
        // Contract with the effects lane: the vehicle object says its skin draws its own lamps.
        if (skin.ownLamps) this.object.userData.ownLamps = true
      },
      (err) => {
        if (this.skin !== skin) return
        console.warn('Buggy model failed to load', err)
        skin.object.removeFromParent()
        skin.dispose()
        this.skin = null
        this.retrySkin(factory)
      },
    )
  }

  private retrySkin(factory: SkinFactory): void {
    if (this.disposed || this.skinAttempts >= SKIN_ATTEMPTS) return
    this.skinRetry = setTimeout(() => this.attachSkin(factory), retryDelay(this.skinAttempts))
  }

  /**
   * Hide the stand in once the body has loaded. Applied again every frame, so anything that
   * saved and restored visibility around the load cannot bring the box back over the body.
   */
  private showBody(): void {
    this.fallback.visible = !this.skinReady
  }

  protected override applyColors(): void {
    this.fbBody.color.set(this.colors.body)
    for (const m of this.fbMaterials) m.emissive.set(this.colors.accent)
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

  /** Surface height of the lava or water at a point (Unity layer 4 raycasts). */
  private liquidAt(x: number, z: number): number {
    return this.terrain.liquidHeightAt?.(x, z) ?? seaLevel()
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
    // Next-gen replaces the auto brake with the drivetrain hold (see drivetrain()).
    this.brakes = i.brakes || (!buggyNextGen.value && buggyIdleHold.value && idle && speedSq < AUTO_BRAKE_V2)
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
  private readonly vLocal = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly v4 = new THREE.Vector3()

  protected applyForces(dt: number): void {
    const ub = this.ub
    const b = this.body
    ub.begin()
    const q = ub.q
    const pos = ub.pos
    this.up.copy(UP).applyQuaternion(q)
    this.down.copy(this.up).negate()
    const kinematic = b.isKinematic()
    const lv = kinematic ? this.carriedVelocity(pos, dt) : b.linvel()
    if (!kinematic) this.carriedValid = false
    this.feelBlow(lv, pos, dt, kinematic)
    const speedSq = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z
    const myVelocity = Math.sqrt(speedSq)
    const S = buggySpeed.value
    const smoothed = this.inputSmoothed

    this.updateInput(dt, speedSq)
    this.wingTime = this.shouldWingsBeOpen ? this.wingTime + dt : 0
    // Buggy.js 488 (Mars Explorer): no self righting inside a zorb ball.
    if (this.zorbed) this.isInverted = false
    else this.selfRight(dt, speedSq)

    let wheelsAreTouchingGround = false
    this.totalSuspensionCompression = 0

    // Smart suspension, VB 160-176. Always on in Syn3h, driven by body speed, lerp rate 1.
    let desired = 0.5
    if (this.areWingsOpen) {
      if (!this.raycast(pos, this.v1.set(0, -1, 0), 5)) desired = 0
    } else {
      desired = lerp(0.4, buggyNextGen.value ? buggyRideHeight.value : 0.1, Math.min(1, myVelocity / S))
    }
    this.suspensionRange = lerp(this.suspensionRange, desired, dt * 1)
    this.updateMassProperties()
    const rayLength = this.suspensionRange + WHEEL_RADIUS

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
    // Next-gen: the rear wheels steer against the fronts when slow, and fade to
    // buggy.rearSteerFast of that (straight, or with the fronts) by the grip fade speed.
    if (buggyNextGen.value) s *= lerp(1, buggyRearSteerFast.value, THREE.MathUtils.smoothstep(myVelocity, buggyGripFade.value * 0.5, buggyGripFade.value))
    this.steer[2] = this.steer[3] = -Math.atan2(s, 1 - Math.abs(s))
    // Body velocity and turn rate in the body's frame (Unity: x right, z forward; yaw left
    // positive), for the steering assist and the aerodynamics below.
    const vl = ub.inverseTransformDirectionUnity(kinematic ? this.v2.set(lv.x, lv.y, lv.z) : ub.velocity, this.vLocal)
    const wv = b.angvel()
    const yawRate = wv.x * this.up.x + wv.y * this.up.y + wv.z * this.up.z
    if (buggyNextGen.value) {
      // Opposite front and rear angles turn on a radius of about WHEELBASE / (tan f + tan r).
      // Cap that sum so full lock asks for buggy.steerLimit times the grip the tyres have.
      const v2 = Math.max(myVelocity * myVelocity, 1)
      // Precise up to half the grip fade speed (STEER_LIMIT_SLOW times the grip), loosening to
      // buggy.steerLimit by the fade speed so full lock at speed breaks into a drift.
      const fast = myVelocity / buggyGripFade.value
      const grip = lerp(buggyGrip.value, buggySlide.value, Math.min(1, fast))
      const loose = THREE.MathUtils.clamp(fast * 2 - 1, 0, 1)
      const limit = lerp(Math.min(STEER_LIMIT_SLOW, buggySteerLimit.value), buggySteerLimit.value, loose)
      const cap = (WHEELBASE * grip * buggyTraction.value * 9.81 * limit) / v2
      // Front minus rear: they add when opposed and cancel when the rear steers with the front.
      const sum = Math.abs(Math.tan(this.steer[0]) - Math.tan(this.steer[2]))
      if (sum > cap) {
        const f = cap / sum
        for (let w = 0; w < 4; w++) this.steer[w] = Math.atan(Math.tan(this.steer[w]) * f)
      }
      // Counter-steer assist (buggy.steerFollow). The limit above is measured from the body, so
      // once the body has slid further than that from its direction of travel no steering
      // could point the front wheels back along it: every tyre slid alike and the wheel did
      // nothing. Past FOLLOW_DEAD the front wheels swing to the direction the front axle is
      // travelling, and the driver's capped steering is added to that, so it always works the
      // front tyres either side of rolling free.
      const follow = buggySteerFollow.value * THREE.MathUtils.smoothstep(myVelocity, ASSIST_SPEED_MIN, ASSIST_SPEED_FULL)
      if (follow > 0 && vl.z > ASSIST_SPEED_MIN * 0.5) {
        const travel = Math.atan2(-(vl.x - WHEEL_POS.z * yawRate), vl.z) * DEG
        const past = Math.min(FOLLOW_MAX, Math.max(0, Math.abs(travel) - FOLLOW_DEAD)) * Math.sign(travel)
        this.steer[0] = this.steer[1] = this.steer[0] + (follow * past) / DEG
      }
    }

    // VB 185-197: kinematic copies only place their wheels. Ours are remote players beyond
    // net.proxyRadius, carried along their owner's snapshots with the owner's input (see
    // RemotePlayer.steer). They take no forces, but the wings and steering above follow that
    // input, and the wheels here roll and slip with the body's motion over the ground, so a
    // distant buggy flies with its wings out and corners with its wheels turned.
    if (kinematic) {
      let grounded = 0, rolling = 0
      for (let i = 0; i < 4; i++) {
        this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
        const hit = this.raycast(this.origin, this.down, rayLength)
        const eff = this.wheelEffects[i]
        eff.grounded = !!hit
        this.windX[i] = this.windZ[i] = 0
        this.sliding[i] = false
        if (!hit) {
          this.hitDistance[i] = -1
          eff.slip = 0
          continue
        }
        this.mountVelocity(i, q, lv)
        this.hitDistance[i] = hit.timeOfImpact
        this.hitCompress[i] = -(hit.timeOfImpact / rayLength) + 1
        eff.point.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)
        eff.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
        eff.slip = Math.abs(this.hitVelocity[i].x)
        rolling += this.hitVelocity[i].z
        grounded++
      }
      // Grounded wheels turn with the ground; in the air they spin down like a free motor.
      if (grounded) this.motorSpeed = rolling / grounded
      else this.motorSpeed -= this.motorSpeed * MOTOR_DRAG * dt
      this.wheelsGrounded = grounded
      // For the brake lamps, which light for regeneration (see update()).
      this.drive = buggyNextGen.value ? this.driveMode(smoothed.y, this.motorSpeed) : 'hold'
      return
    }

    // Motor, VB 280-285.
    const top = S * 10
    this.motorTorque = Math.max(
      1,
      lerp(buggyPower.value * 5, 0, this.motorSpeed / top) * Math.abs(this.areWingsOpen ? 0 : smoothed.y),
    )
    this.motorAccel = lerp(MAX_ACCELERATION, 0, this.motorSpeed / top)
    const nextGen = buggyNextGen.value
    const mass = b.mass()
    if (nextGen) this.drivetrain(dt, smoothed.y)
    else {
      this.motorSpeed += (smoothed.y * this.motorAccel) / MOTOR_MASS * dt
      this.motorSpeed += (-this.motorSpeed * (this.brakes ? 50 : MOTOR_DRAG)) / this.motorTorque * dt
    }
    // Sticky lava (see applyVehicleLiquid in lava.ts) takes over the body while it is immersed
    // and moves it at the lava crawl power, so no wheel force reaches it. The wheels churn in
    // the same goo: drag the motor toward the body's speed so it cannot spin up unloaded and
    // lurch when the tyres bite again at the shore.
    // Water does the same more gently, so the wheels are not at full speed when they touch
    // the beach. inLiquid is last step's value here.
    if (this.lavaDepth > 0 || this.inLiquid) {
      const vf = ub.inverseTransformDirectionUnity(ub.velocity, this.v1).z
      const drag = this.lavaDepth > 0 ? lavaViscosity.value : WATER_MOTOR_DRAG
      this.motorSpeed = vf + (this.motorSpeed - vf) * Math.exp(-drag * dt)
    }
    // Next-gen updates the motor from all four wheels at once (Jacobi). Updating it wheel by
    // wheel, as VB 323 does, favours the left wheels and pulls the buggy right.
    this.motorStep = this.motorSpeed

    // Wheels, VB 288-332.
    const wasAirborne = this.wheelsGrounded === 0
    this.landingSlide = wasAirborne ? LANDING_SLIDE : Math.max(0, this.landingSlide - dt)
    let grounded = 0
    for (let i = 0; i < 4; i++) {
      this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
      const hit = this.raycast(this.origin, this.down, rayLength)
      const eff = this.wheelEffects[i]
      if (!hit) {
        this.hitDistance[i] = -1
        eff.grounded = false
        eff.slip = 0
        this.windX[i] = this.windZ[i] = 0
        this.sliding[i] = false
        continue
      }
      wheelsAreTouchingGround = true
      grounded++
      this.hitDistance[i] = hit.timeOfImpact
      this.hitCompress[i] = -(hit.timeOfImpact / rayLength) + 1
      this.totalSuspensionCompression += this.hitCompress[i]
      this.hitPoint.copy(this.down).multiplyScalar(hit.timeOfImpact).add(this.origin)

      const pv = this.mountVelocity(i, q, b.velocityAtPoint(this.origin))
      const hitVel = this.hitVelocity[i]
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

      if (nextGen) {
        this.tyre(i, dt, myVelocity, mass)
        continue
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
    if (nextGen && this.drive === 'drive' && !this.brakes && Math.abs(smoothed.y) > THROTTLE_DEADZONE) this.driveFloor(smoothed.y)
    this.wheelsGrounded = grounded
    this.landedThisStep = wasAirborne && grounded > 0
    if (this.landedThisStep) this.landingImpact = Math.max(0, -lv.y)

    // Suspension, VB 336-344: skipped while inverted, shocks at 0.8.
    for (let i = 0; i < 4; i++) {
      if (this.hitDistance[i] === -1 || this.isInverted) continue
      const f = this.suspensionForce(i, mass, nextGen)
      this.origin.copy(this.origins[i]).applyQuaternion(q).add(pos)
      ub.addForceAtPosition(this.v2.copy(this.up).multiplyScalar(f), this.origin)
    }

    if (nextGen && !this.shouldWingsBeOpen && !this.isInverted) this.aero(dt, mass, myVelocity, grounded, vl.x, yawRate, smoothed.x, pos, q)
    if (this.shouldWingsBeOpen) this.fly(dt, myVelocity, smoothed)
    else if (nextGen) {
      // The tyres do the braking and the parking, so only the free rolling drag remains.
      ub.maxAngularVelocity = 7
      ub.angularDrag = 0.2
      ub.drag = 0.01
    } else {
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

    // Water: float and paddle (Mars Explorer Buggy.js 435-475, see lava.ts), after drag like the
    // original. applyLava does nothing in lava, which is sticky instead: the base class applies
    // that after this controller and sets inLiquid, lavaDepth and stuck.
    this.inLiquid = applyLava(ub, FLOAT_POINTS, (x, z) => this.liquidAt(x, z), {
      x: smoothed.x, y: smoothed.y, wingsOpen: this.areWingsOpen,
    })

    ub.flush(dt)
  }

  private readonly blowLast = new THREE.Vector3()
  private blowValid = false
  private blowWait = 0
  /**
   * Tell the skin's force fields when the buggy takes a blow: any sudden change of velocity,
   * whether from the ground, another vehicle, a shove, or the wings taking the whole load of
   * a buggy that was moving across them. The fields flash at the side the blow came from and
   * a ring runs across them (BuggySkin.fieldHit). Visual only.
   */
  private feelBlow(lv: RAPIER.Vector, pos: THREE.Vector3, dt: number, kinematic: boolean): void {
    this.blowWait = Math.max(0, this.blowWait - dt)
    const dv = this.v1.set(lv.x - this.blowLast.x, lv.y - this.blowLast.y, lv.z - this.blowLast.z)
    const felt = dv.length()
    if (this.blowValid && !kinematic && felt > BLOW_MIN && this.blowWait === 0 && this.skin?.fieldHit) {
      // The body was pushed along dv, so the blow landed on the side facing against it.
      this.skin.fieldHit(this.v2.copy(pos).addScaledVector(dv, -1.2 / felt), THREE.MathUtils.clamp(felt / BLOW_FULL, 0.2, 1.2))
      this.blowWait = BLOW_GAP
    }
    this.blowLast.set(lv.x, lv.y, lv.z)
    this.blowValid = !kinematic
  }

  private readonly carriedLast = new THREE.Vector3()
  private readonly carried = new THREE.Vector3()
  private carriedValid = false
  /**
   * Velocity of a kinematic copy, from how far it was carried since the last step. Rapier
   * reports none for a remote copy in the game (the same reason Vehicle.postPhysics measures
   * a kinematic zorb this way). A move faster than CARRIED_MAX is a teleport or a whole tile
   * shift at the world seam, not motion.
   */
  private carriedVelocity(pos: THREE.Vector3, dt: number): THREE.Vector3 {
    const v = this.carried
    if (this.carriedValid) v.subVectors(pos, this.carriedLast).divideScalar(dt)
    else v.set(0, 0, 0)
    if (v.lengthSq() > CARRIED_MAX * CARRIED_MAX) v.set(0, 0, 0)
    this.carriedLast.copy(pos)
    this.carriedValid = true
    return v
  }

  /**
   * Wheel i's frame (qWheel: the body turned by its steering angle) and its mount's world
   * velocity `pv` in that frame as Unity components (x lateral, z forward), into
   * hitVelocity[i]. Returns `pv`.
   */
  private mountVelocity<V extends RAPIER.Vector>(i: number, q: THREE.Quaternion, pv: V): V {
    this.qSteer.setFromAxisAngle(UP, this.steer[i])
    this.qWheel.multiplyQuaternions(q, this.qSteer)
    this.qWheelInv.copy(this.qWheel).invert()
    const hv = this.v1.set(pv.x, pv.y, pv.z).applyQuaternion(this.qWheelInv)
    this.hitVelocity[i].set(hv.x, hv.y, -hv.z)
    return pv
  }

  /**
   * Suspension force along the body's up axis for grounded wheel i. Classic is VB 340: a damper
   * on the mount's vertical speed plus a spring on compression, stiffer with wings open.
   * Next-gen adds a progressive bump stop near full compression (wings shut): the spring rises
   * with the square of the depth into the stop, then linearly, and the damper stiffens with it,
   * so a hard hit is absorbed before the body strikes the ground and bounces off it. The damper
   * is also firmer on rebound than on compression (buggy.rebound). Next-gen never pulls: a wheel cannot hold the body down to the ground.
   */
  private suspensionForce(i: number, mass: number, nextGen: boolean): number {
    const wings = this.areWingsOpen
    let damper = -this.hitVelocity[i].y * buggyShocks.value * 0.8 * (wings ? 3 : 1)
    let spring = this.hitCompress[i] * (20 * mass) * (wings && i < 2 ? 8 : 1)
    if (!nextGen) return damper + spring
    if (!wings) {
      // Rebound: the wheel is extending. Damping it harder keeps a compressed spring from
      // flinging the body up and pitching it as it leaves a crest.
      if (damper < 0) damper *= buggyRebound.value
      const x = Math.max(0, (BUMP_START - this.hitDistance[i]) / (BUMP_START - BUMP_END))
      spring += buggyBumpStop.value * 20 * mass * (x < 1 ? x * x : 2 * x - 1)
      if (buggyBumpStop.value > 0) damper *= 1 + BUMP_DAMP * Math.min(1, x)
    }
    return Math.max(0, damper + spring)
  }

  /**
   * Next-gen tyre force for grounded wheel i (see TYRE_MASS). Uses this step's ray hit:
   * hitVelocity (mount velocity in wheel space), hitCompress, hitPoint and qWheel.
   */
  private tyre(i: number, dt: number, speed: number, mass: number): void {
    const hv = this.hitVelocity[i]
    const eff = this.wheelEffects[i]
    // Load is the force the suspension pass applies at this wheel.
    const load = this.isInverted ? 0 : this.suspensionForce(i, mass, true)
    const traction = buggyTraction.value
    // Peak friction: buggy.grip at rest, buggy.slide (grip at speed) by the grip fade speed.
    const grip = lerp(buggyGrip.value, buggySlide.value, Math.min(1, speed / buggyGripFade.value))
    // Longitudinal slip acts on the body and the motor together; locked brakes make the motor
    // immovable. Mass terms follow the classic motor reaction (VB 323): dv = F dt / torque.
    const slipX = hv.x
    const slipZ = hv.z - this.motorStep
    // Each wheel drives a quarter of the motor; all four see the same motor speed this step.
    const locked = this.brakes || this.drive === 'regen' || this.drive === 'hold'
    const motorMass = locked ? Infinity : this.motorTorque / 4
    const longMass = 1 / (1 / TYRE_MASS + 1 / motorMass)
    const damp = TYRE_DAMP / dt
    const k = TYRE_OMEGA * TYRE_OMEGA
    this.windX[i] += slipX * dt
    this.windZ[i] += slipZ * dt
    let fx = -TYRE_MASS * (slipX * damp + this.windX[i] * k)
    let fz = -longMass * (slipZ * damp + this.windZ[i] * k)
    // Friction falls to SLIDE_RATIO of its peak as the contact patch slips faster (a Stribeck curve),
    // so a tyre that has let go keeps most of its bite while it is only just sliding. ABS
    // keeps braking at the peak.
    const slip = Math.hypot(slipX, slipZ)
    let mu = locked ? grip : grip * lerp(1, SLIDE_RATIO, THREE.MathUtils.smoothstep(slip, SLIP_GRIP, SLIP_SLIDE))
    // A tyre dragged sideways lets go. Steering works the tyre at a modest angle to its travel
    // (the buggy drifts at 20 to 40 degrees), and there it keeps its full grip. Past that, as
    // when the buggy lands or spins broadside, friction falls to buggy.sideGrip, so it slides
    // and bounces on instead of stopping dead. Only at speed: a parked or crawling tyre holds.
    const travel = Math.hypot(slipX, hv.z)
    if (travel > SIDE_SPEED_MIN) {
      const angle = Math.atan2(Math.abs(slipX), Math.abs(hv.z)) * DEG
      const broadside = THREE.MathUtils.smoothstep(angle, SIDE_ANGLE_GRIP, SIDE_ANGLE_SLIDE) * THREE.MathUtils.smoothstep(travel, SIDE_SPEED_MIN, SIDE_SPEED_FULL)
      // On the ground a slide keeps buggy.sideHold of the tyre's grip, so it can be caught;
      // the full drop to buggy.sideGrip is for the moments after a landing.
      const landing = Math.min(1, this.landingSlide / (LANDING_SLIDE * 0.5))
      const floor = lerp(Math.max(buggySideGrip.value, buggySideHold.value * mu), buggySideGrip.value, landing)
      mu = Math.min(mu, lerp(mu, floor, broadside))
    }
    const cap = mu * traction * load
    const n = Math.hypot(fx, fz)
    this.sliding[i] = n > cap
    // Regen is torque limited: past its force the wheel turns with the ground, not the motor.
    const regenCap = this.drive === 'regen' && !this.brakes ? this.regenForce / 4 : Infinity
    if (this.sliding[i]) {
      // Saturated: the brush cannot wind up any further than the friction it can carry.
      const f = cap / n
      fx *= f
      fz *= f
      this.windX[i] *= f
      this.windZ[i] *= f
    }
    if (Math.abs(fz) > regenCap) {
      const f = regenCap / Math.abs(fz)
      fz *= f
      this.windZ[i] *= f
    }
    this.v2.set(fx, 0, -fz).applyQuaternion(this.qWheel)
    this.ub.addForceAtPosition(this.v2, this.hitPoint)
    if (!locked) this.motorSpeed -= (fz * dt) / this.motorTorque
    eff.slip = this.sliding[i] ? slip : 0
  }

  /**
   * Next-gen aerodynamics with the wings shut (not from Syn3h), all growing with speed:
   * - downforce (buggy.downforce) along the body's down axis, only in proportion to the wheels
   *   on the ground, so it adds grip at speed without shortening a jump;
   * - a tail fin (buggy.fin): a side force at the tail against its sideways motion, which
   *   turns the buggy to point where it is going, on the ground, and in the air only with
   *   buggy.finAir;
   * - the stability assist (buggy.stability): a damper on the turn rate while the steering is
   *   let go, at speed, with at least two wheels down.
   * `side` is the body's rightward speed and `yawRate` its turn rate, left positive.
   */
  private aero(dt: number, mass: number, speed: number, grounded: number, side: number, yawRate: number, steerInput: number, pos: THREE.Vector3, q: THREE.Quaternion): void {
    const ub = this.ub
    const down = buggyDownforce.value
    if (down > 0 && grounded > 0) {
      const k = Math.min(speed, AERO_SPEED_MAX) / AERO_SPEED
      ub.addForce(this.v2.copy(this.down).multiplyScalar(down * 9.81 * mass * k * k * (grounded / 4)))
    }
    const fin = buggyFin.value
    if (fin > 0 && speed > 1 && (grounded > 0 || buggyFinAir.value)) {
      // The tail (our +Z) moves right when the body does, and left of that as it yaws left.
      const tailSide = side + FIN_Z * yawRate
      const right = this.v2.set(1, 0, 0).applyQuaternion(q).multiplyScalar(-fin * FIN * mass * tailSide * Math.min(speed, AERO_SPEED_MAX))
      ub.addForceAtPosition(right, this.v1.set(0, 0, FIN_Z).applyQuaternion(q).add(pos))
    }
    const assist = buggyStability.value * THREE.MathUtils.smoothstep(speed, ASSIST_SPEED_MIN, ASSIST_SPEED_FULL) * (1 - Math.min(1, Math.abs(steerInput)))
    if (assist > 0 && grounded >= 2) ub.addTorqueAcceleration(this.v2.copy(this.up).multiplyScalar(-assist * yawRate), dt)
  }

  /**
   * Next-gen electric drivetrain, modelled on a one-pedal EV but with coasting at speed so a
   * tapped throttle holds a speed:
   * - drive: throttle along the direction of travel (or from rest) runs the classic motor.
   * - coast: no throttle above HOLD_SPEED. The motor freewheels with buggy.coastDrag.
   * - regen: the reverse key while rolling forward. The motor decelerates the wheels at
   *   buggy.regen g, torque limited, until the buggy is nearly stopped; then the key reverses.
   *   The forward key never regenerates: it always drives (see driveFloor()).
   * - hold: no throttle below HOLD_SPEED. The motor eases to zero and stays there, and the
   *   tyres' static friction parks the buggy, slopes included. No brake drag freeze.
   * In regen and hold the motor is a fixed reference the tyres pull the body toward.
   */
  private drivetrain(dt: number, y: number): void {
    const vf = this.ub.inverseTransformDirectionUnity(this.ub.velocity, this.v1).z
    this.drive = this.driveMode(y, vf)
    if (this.brakes) {
      this.motorSpeed = 0
      return
    }

    if (this.drive === 'hold') {
      this.motorSpeed = moveToward(this.motorSpeed, 0, HOLD_DECEL * dt)
    } else if (this.drive === 'regen') {
      const decel = buggyRegen.value * 9.81 * Math.abs(y)
      // Start from the wheels' actual speed so a motor still spinning from wheelspin cannot
      // read as regen, then pull it toward zero.
      if (Math.sign(this.motorSpeed) !== Math.sign(vf) || Math.abs(this.motorSpeed) > Math.abs(vf)) this.motorSpeed = vf
      this.motorSpeed = moveToward(this.motorSpeed, 0, decel * dt)
      this.regenForce = MASS * decel * REGEN_TORQUE_MARGIN
    } else if (this.drive === 'coast') {
      this.motorTorque = 1
      this.motorSpeed -= this.motorSpeed * buggyCoastDrag.value * dt
    } else {
      this.motorSpeed += (y * this.motorAccel) / MOTOR_MASS * dt
      this.motorSpeed -= (this.motorSpeed * MOTOR_DRAG) / this.motorTorque * dt
      this.driveFloor(y)
    }
  }

  /** Which drivetrain state throttle `y` asks for at forward speed `vf` (see drivetrain()). */
  private driveMode(y: number, vf: number): Syn3hBuggy['drive'] {
    if (this.brakes) return 'hold'
    if (Math.abs(y) <= THROTTLE_DEADZONE) {
      return buggyIdleHold.value && Math.abs(vf) < HOLD_SPEED && this.wheelsGrounded > 0 ? 'hold' : 'coast'
    }
    // Only the reverse key regenerates. The forward key always drives: rolling back down a
    // hill with it held is the moment the motor must pull hardest, not brake gently.
    return y < 0 && vf > REVERSE_SPEED ? 'regen' : 'drive'
  }

  /**
   * Under throttle the wheels always turn the way the driver asked, at DRIVE_FLOOR or faster:
   * the motor has torque to spare, so the ground can never drag it backward. On a hill too
   * steep to grip the tyres spin and the buggy slides, instead of the wheels being wound
   * backward as it falls. Called after the motor update and again after the tyres react on it.
   */
  private driveFloor(y: number): void {
    const dir = Math.sign(y)
    const floor = DRIVE_FLOOR * Math.min(1, Math.abs(y))
    if (this.motorSpeed * dir < floor) this.motorSpeed = dir * floor
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
          const speed = locVel.length() + dt * 50 * boost
          const model = Math.round(buggyFlightModel.value)
          // How far (radians) the wings may turn the motion toward the nose this step.
          const turn = model === 1 && this.wingTime < CATCH_TIME
            ? ((CATCH_START + (CATCH_END - CATCH_START) * (this.wingTime / CATCH_TIME) ** 2) / DEG) * dt
            : model === 2 ? Math.min(GLIDE_LIFT * myVelocity, (GLIDE_G * 9.81) / Math.max(myVelocity, 1)) * dt : Infinity
          const dir = this.v3.copy(vel).normalize()
          const off = dir.angleTo(fwd)
          if (off <= turn) {
            // Classic, and the other models once the motion has come round: straight down the nose.
            if (model === 2) ub.setVelocity(this.v3.copy(fwd).multiplyScalar(Math.max(0, speed - GLIDE_GRAVITY * 9.81 * fwd.y * dt)))
            else ub.setVelocity(ub.transformDirectionUnity(0, 0, speed, this.v2))
          } else {
            // Swing the motion toward the nose by `turn`, about the axis between them (the
            // body's up when they are opposed and that axis is undefined).
            const axis = this.v4.crossVectors(dir, fwd)
            if (axis.lengthSq() < 1e-10) axis.copy(this.up)
            dir.applyAxisAngle(axis.normalize(), turn)
            ub.setVelocity(dir.multiplyScalar(model === 2 ? Math.max(0, speed - GLIDE_GRAVITY * 9.81 * dir.y * dt) : speed))
          }
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
      if (ub.pos.y < seaLevel() + 10 && d >= 0 && d <= 10) {
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

  /**
   * Self righting, VB 545-562, over the contacts Rapier kept from the last step. Unity's contact
   * normal points into this body. Rapier's points from the pair's first collider to its second
   * and tells us when that order is swapped. Only contacts that actually touch count: the
   * manifold also lists points still inside the prediction margin. numSolverContacts() reads 0
   * against a triangle mesh, which is what the terrain is, so count the geometric contacts.
   *
   * Not in the source: the flag only sets while the body is actually past 90 degrees from world
   * up. A contact on the roof side of an upright buggy (another vehicle ramming or landing on
   * it) would otherwise switch the suspension and tyres off until a ground contact cleared it.
   */
  private selfRight(dt: number, speedSq: number): void {
    const world = this.game.world
    const n = this.v1
    const w = this.body.angvel()
    const angSq = w.x * w.x + w.y * w.y + w.z * w.z
    for (const collider of [this.hull, this.skid]) {
      world.contactPairsWith(collider, (other) => {
        world.contactPair(collider, other, (manifold, flipped) => {
          let count = 0
          for (let c = manifold.numContacts() - 1; c >= 0; c--) if (manifold.contactDist(c) < CONTACT_TOUCH) count++
          if (count === 0) return
          const mn = manifold.normal()
          n.set(mn.x, mn.y, mn.z)
          if (!flipped) n.negate()
          const angle = this.up.angleTo(n) * DEG
          for (let c = 0; c < count; c++) {
            if (this.isInverted && angle < 50) this.isInverted = false
            else if (!this.isInverted && angle > 90 && this.up.y < 0) this.isInverted = true
            if (this.isInverted && angSq < 2 && speedSq < 8) {
              this.v2.crossVectors(this.up, UP).multiplyScalar(this.up.angleTo(UP) * DEG * 0.5)
              this.ub.addTorqueAcceleration(this.v2, dt)
            }
          }
        })
      })
    }
  }

  /**
   * A teleport is a fresh start: besides the pose and velocities the base clears, drop every
   * piece of drivetrain, suspension and tyre state, so nothing from before (a spinning motor,
   * the inverted flag, wound up tyres, open wings) acts on the buggy where it lands.
   */
  override teleport(position: THREE.Vector3, heading = 0): void {
    super.teleport(position, heading)
    this.isInverted = false
    this.stuckSteps = 0
    this.motorSpeed = this.motorStep = 0
    this.motorInputSmoothed = 0
    this.brakePower = 0
    this.regenForce = 0
    this.drive = 'hold'
    this.inputSmoothed.set(0, 0, 0, 0)
    this.wingState = 0
    this.areWingsOpen = this.wingsOpen = false
    // Rest length, so it lands on its wheels and not on its skid plate.
    this.suspensionRange = 0.4
    this.updateMassProperties()
    this.wheelsGrounded = 0
    this.landingSlide = 0
    this.wingTime = 0
    this.blowValid = false
    this.carriedValid = false
    for (let i = 0; i < 4; i++) {
      this.windX[i] = this.windZ[i] = 0
      this.sliding[i] = false
      this.hitDistance[i] = -1
      this.hitCompress[i] = 0
      this.hitVelocity[i].set(0, 0, 0)
    }
  }

  // ---- visuals -------------------------------------------------------------------------

  private buildFallback(): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.9 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4), this.fbBody)
    body.position.set(0, 0.45, 0)
    body.castShadow = true
    this.fallback.add(body)
    const tyre = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.48, 18)
    tyre.rotateZ(Math.PI / 2)
    const spoke = new THREE.BoxGeometry(0.5, WHEEL_RADIUS * 1.4, 0.08)
    const rim = new THREE.MeshStandardMaterial({ color: 0x89949f, roughness: 0.5, metalness: 0.5 })
    // The stand in is shown only while the real body loads: a translucent ghost glowing in the
    // accent colour (pulsed in update), so it reads as arriving, never as the vehicle itself.
    for (const m of [this.fbBody, dark, rim]) {
      m.transparent = true
      m.depthWrite = false
      m.opacity = 0.55
      m.emissive.set(this.colors.accent)
      this.fbMaterials.push(m)
    }
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
  /** Smoothed hub motor effort per wheel, for the skin's glow and sparks (visual only). */
  readonly motorEffort = [0, 0, 0, 0]
  private readonly driveIn: MotorDriveInput = {
    throttle: 0, forwardSpeed: 0, motorSpeed: 0, topSpeed: 1, brakes: false, wingsOpen: false, grounded: false, sliding: false,
  }
  private readonly driveOut = { effort: 0, regen: false }
  private readonly vDrive = new THREE.Vector3()
  private readonly qDrive = new THREE.Quaternion()

  /** Fill `driveIn` for wheel `i` from this buggy's public state. */
  private motorDriveInput(i: number): MotorDriveInput {
    const d = this.driveIn
    if (i === 0) {
      // Body speed along the nose (Unity sign, forward positive), once per frame.
      const v = this.body.linvel(), r = this.body.rotation()
      d.forwardSpeed = -this.vDrive.set(v.x, v.y, v.z).applyQuaternion(this.qDrive.set(r.x, r.y, r.z, r.w).invert()).z
    }
    d.throttle = this.inputSmoothed.y
    d.motorSpeed = this.motorSpeed
    d.topSpeed = buggySpeed.value * 10
    d.brakes = this.brakes
    d.wingsOpen = this.areWingsOpen
    d.grounded = this.hitDistance[i] !== -1
    d.sliding = this.sliding[i]
    return d
  }

  /** Effects consume vehicle-local anchors from the current visible skin geometry. */
  override getWingTip(side: -1 | 1, out: THREE.Vector3): boolean {
    if (!this.skin?.getWingTip?.(side, out)) return false
    this.skin.object.updateMatrix()
    out.applyMatrix4(this.skin.object.matrix)
    return true
  }

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha)
    this.showBody()
    if (!this.skinReady) {
      this.ghostClock += dt
      const pulse = 0.5 + 0.5 * Math.sin(this.ghostClock * 6)
      for (const m of this.fbMaterials) { m.opacity = 0.35 + 0.3 * pulse; m.emissiveIntensity = 0.4 + 0.8 * pulse }
    }
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
      if (this.skin?.setDrive) {
        const drive = motorDrive(this.motorDriveInput(i), this.driveOut)
        this.motorEffort[i] = smoothEffort(this.motorEffort[i], drive.effort, dt)
        this.skin.setDrive(i, this.motorEffort[i], drive.regen)
      }
      const g = this.fbWheels[i]
      g.position.copy(this.wheelPos)
      g.rotation.y = this.steer[i]
      this.fbSpinners[i].rotation.x = this.spin
    }
    // An EV lights its brake lamps for regeneration as well as the brakes.
    this.skin?.setLights?.(this.brakes || this.drive === 'regen')
    // The skin rewrites every wing vertex, so only call it when something visible changed.
    const w = this.lastWings
    const ws = this.wingState, wx = this.inputSmoothed.x, wp = this.motorInputSmoothed
    if (this.skin && (Math.abs(ws - w[0]) > 1e-3 || (ws > 0 && (Math.abs(wx - w[1]) > 1e-3 || Math.abs(wp - w[2]) > 1e-3)))) {
      this.skin.setWings(ws, wx, wp)
      w[0] = ws; w[1] = wx; w[2] = wp
    }
  }

  override dispose(): void {
    this.disposed = true
    clearTimeout(this.skinRetry)
    this.skin?.dispose()
    super.dispose()
  }
}
