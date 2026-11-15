/**
 * Zorb mode: the vehicle rides inside a giant force-field ball that rolls, bounces and is pushed
 * around relative to the camera.
 *
 * Port of Mars Explorer (unity3d-marsxplr, Assets/Martian Assets):
 *  - Vehicles/Scripts/Vehicle.js 174-179 (the ball's scale lerps toward its target by
 *    fixedDeltaTime each fixed step), 209-241 (the ORB is a child sphere collider; scale is
 *    ramoSpheres * 15 + camOffset; it is solid only while zorbBall is on; on a toggle the scale
 *    restarts from zero; the vehicle's mass properties are saved and restored around it) and
 *    411-415 (RPC sZ sets zorbBall).
 *  - Vehicles/Scripts/VehicleMe.js 80-87: the camera-relative drive force and roll torque.
 *  - Vehicles/Scripts/RamoSphere.js: shield alpha easing, impact flare, scrolling offset, and the
 *    shield keeping world rotation identity so its pattern does not spin with the ball.
 *  - Vehicles/Materials/ForceField.shader: additive, no depth write, double sided,
 *    surface(uv + offset) * ramp(|dot(view, normal)|) * tint.rgb * tint.a.
 *  - Game/Settings.js 80-83, 733-780 and 1691: the four zorb settings and the ball's physic
 *    material bounciness. Vehicles/Materials/XorbBall.physicmaterial: friction .1 and .1,
 *    bounciness .5 (read with a float scan of the binary asset).
 *
 * Values recovered from the binary ORB.prefab with a float scan: the sphere collider radius is
 * .5 (a Unity unit sphere), so the ball radius is half the scale. RamoSphere.tagColor is
 * (.035, .565, 1, .278) and ramColor (0, 1, 0, .2275). The zorb ball uses ramColor's alpha as
 * its resting brightness; the tint follows the vehicle accent colour instead of fixed green.
 *
 * Deliberate changes:
 *  - The original waited one second (`yield WaitForSeconds(1)`) before building the ball. Here
 *    it starts growing on the fixed step the flag changes.
 *  - Switching off does not drop the vehicle from the middle of the ball (the original turned
 *    the collider into a trigger at once, for its separate tag mode, which this port does not
 *    have). The ball shrinks, ramping up to ZORB_SHRINK_SPEED slower than gravity so the car
 *    keeps resting on it, lowering the car onto its wheels; the
 *    collider goes once it is ZORB_RELEASE_RADIUS across; the visual fades out meanwhile.
 *  - The surface texture (Plasma.png) and ramp (Ramp.png) are generated in the shader.
 *  - The ball is centred ZORB_KEEL above the vehicle's centre of mass, not on its pivot. On the
 *    pivot the buggy's mass, .2 m ahead of it, swung the car about 70 degrees nose down at rest.
 *    A little keel keeps the car hanging upright and swinging like a weighted hamster ball.
 *
 * Frames: Unity is left handed with +Z forward, ours is right handed with -Z forward and a
 * three.js camera looks down its -Z. A Unity camera-local direction (x, y, z) is (x, y, -z) in
 * the three.js camera frame; an axial vector (torque) picks up the extra reflection sign and
 * becomes (-x, -y, z), the same rule as `unityTorque` in core/physics.
 */
import * as THREE from 'three/webgpu'
import {
  Fn, abs, dot, float, mix, mx_fractal_noise_float, mx_noise_vec3, normalView, positionLocal,
  positionViewDirection, pow, sin, smoothstep, time, uniform, vec3,
} from 'three/tsl'
import { defineParam } from '../../shared/params'
import { GROUP_ALL, GROUP_VEHICLE, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { type LiquidState, lavaCoolingTime, lavaViscosity, liquidKind } from './lava'
import { hotExposureNode } from './skins/hotExposure'

// Game/Settings.js 80-83 and 733-780. ramoSpheres defaults to 0 there (shields off) and the
// "RORBs Enabled" toggle sets it to .5; zorb mode is per player here, so .5 is the default.
export const zorbSize = defineParam({ id: 'zorb.size', label: 'Ball size', group: 'Zorb', scope: 'world', default: 0.5, min: 0.001, max: 1, step: 0.001 })
/** 0 disables zorbing, as the "XORBs Available" toggle did (Messaging.js 67). */
export const zorbSpeed = defineParam({ id: 'zorb.speed', label: 'Roll speed (m/s²)', group: 'Zorb', scope: 'world', default: 7, min: 0, max: 14, step: 0.1 })
export const zorbAgility = defineParam({ id: 'zorb.agility', label: 'Sideways agility (m/s²)', group: 'Zorb', scope: 'world', default: 0, min: -7, max: 7, step: 0.1 })
export const zorbBounce = defineParam({ id: 'zorb.bounce', label: 'Bounciness', group: 'Zorb', scope: 'world', default: 0.5, min: 0, max: 1, step: 0.01 })

/** XorbBall.physicmaterial dynamic and static friction. */
export const ZORB_FRICTION = 0.1
/** RamoSphere.ramColor alpha from ORB.prefab: the shield's resting brightness. */
export const ZORB_REST_ALPHA = 0.2275
/** Vehicle clearance used when a vehicle declares no `camOffset` (Syn3h buggy prefab CamOffset 3). */
export const ZORB_DEFAULT_CAM_OFFSET = 3
/** How deep the base of a floating ball sits in water or lava, in metres. */
export const ZORB_FLOAT_DEPTH = 0.4
/** The ball's centre sits this far above the vehicle's centre of mass, in the vehicle frame. */
export const ZORB_KEEL = 0.35
/** Metres per second a switched-off ball shrinks, so the car is set down rather than dropped. */
export const ZORB_SHRINK_SPEED = 4
/** How fast the shrink speeds up. Below g, so the car stays on the ball instead of falling. */
const SHRINK_RAMP = 6
/** Radius below which a shrinking ball is removed: the wheels reach the ground about here. */
export const ZORB_RELEASE_RADIUS = 1
/** Smallest collider radius while growing; Rapier needs a non-degenerate ball. */
const MIN_RADIUS = 0.05

/**
 * Ball radius for a size setting and a vehicle clearance. Vehicle.js 225: the ORB's scale is
 * ramoSpheres * 15 + camOffset, and its sphere collider has radius .5. At the default size a
 * buggy (clearance 3) gets 5.25 m, matching the roughly 10 m ball in the legacy screenshots.
 */
export function zorbRadius(size: number, camOffset: number): number {
  return 0.5 * (size * 15 + camOffset)
}

const tmpV = new THREE.Vector3()
const tmpN = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpC = new THREE.Vector3()

/** Terrain functions the ball reads for its ground-contact glow. */
interface ZorbTerrain {
  heightAt(x: number, z: number): number
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3
}

/** Liquid functions the ball floats on. */
type ZorbLiquidTerrain = Pick<Terrain, 'liquidHeightAt' | 'liquidKindAt'>

/**
 * The physical ball: one zero-density sphere collider on the vehicle's own rigid body, so mass,
 * centre of mass and inertia stay exactly as the vehicle class set them (Vehicle.js 214-215 and
 * 238-239 save and restore them for the same reason).
 */
export class ZorbBall {
  collider: RAPIER.Collider | null = null
  /** Current collider radius in metres, 0 when off. */
  radius = 0
  /** Radius the ball is growing toward. */
  target = 0
  /** Strongest impact (normal speed in m/s, RamoSphere.js OnCollisionEnter) since last read. */
  impact = 0
  /** Number of impacts above the flare threshold, for tests and debugging. */
  impacts = 0
  /** 0..1: how firmly the ball sits on the ground, for the contact glow. */
  contact = 0
  /** World direction from the ball centre to the ground contact. */
  readonly contactDir = new THREE.Vector3(0, -1, 0)
  private readonly lastVelocity = new THREE.Vector3()
  private hasVelocity = false
  private restitution = -1
  /** Ball centre in the vehicle's local frame, fixed when the ball is built. */
  readonly offset = new THREE.Vector3()

  constructor(
    private readonly world: RAPIER.World,
    private readonly body: RAPIER.RigidBody,
    private readonly camOffset: () => number,
  ) {}

  /** The collider exists, growing, full size or shrinking away. */
  get active(): boolean { return this.collider !== null }
  /** Zorb mode is switched on (the ball may still be growing). */
  on = false
  private shrinkSpeed = 0

  /**
   * Run once per fixed step before the vehicle's controller. Builds, grows, shrinks or removes
   * the collider to match `on`.
   */
  sync(on: boolean, dt: number): void {
    this.on = on
    if (!on) {
      if (!this.collider) return
      this.shrinkSpeed = Math.min(ZORB_SHRINK_SPEED, this.shrinkSpeed + SHRINK_RAMP * dt)
      this.radius -= this.shrinkSpeed * dt
      // A collider shrinking under the car is not a moving contact to Rapier: gravity builds a
      // fall speed the contact never removes, and the car would hit the ground with it. On the
      // ground, cap the descent at the shrink speed.
      const v = this.body.linvel()
      if (this.contact > 0.5 && !this.body.isKinematic() && v.y < -this.shrinkSpeed) this.body.setLinvel({ x: v.x, y: -this.shrinkSpeed, z: v.z }, true)
      if (this.radius <= ZORB_RELEASE_RADIUS) this.remove()
      else this.collider.setRadius(this.radius)
      return
    }
    this.target = zorbRadius(zorbSize.value, this.camOffset())
    this.shrinkSpeed = 0
    if (!this.collider) {
      // Vehicle.js 228-231: a fresh toggle restarts the scale from zero.
      this.radius = 0
      this.hasVelocity = false
      const com = this.body.localCom()
      this.offset.set(com.x, com.y + ZORB_KEEL, com.z)
      this.collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(MIN_RADIUS)
          .setTranslation(this.offset.x, this.offset.y, this.offset.z)
          .setDensity(0)
          .setFriction(ZORB_FRICTION)
          .setRestitution(zorbBounce.value)
          .setCollisionGroups(groups(GROUP_VEHICLE, GROUP_ALL)),
        this.body,
      )
      this.restitution = zorbBounce.value
    }
    // Vehicle.js 175-176: Lerp(scale, target, fixedDeltaTime), then stop within .01 of scale
    // (.005 of radius).
    if (this.radius !== this.target) {
      this.radius += (this.target - this.radius) * Math.min(1, dt)
      if (Math.abs(this.radius - this.target) < 0.005) this.radius = this.target
      this.collider.setRadius(Math.max(MIN_RADIUS, this.radius))
    }
    // Settings.js 1691: zorbPhysics.bounciness = zorbBounce, live.
    if (this.restitution !== zorbBounce.value) {
      this.restitution = zorbBounce.value
      this.collider.setRestitution(this.restitution)
    }
  }

  /**
   * VehicleMe.js 80-87, owner only: while any steering input is held, push the ball along the
   * camera's horizontal axes and spin it the way it should roll.
   *
   *   AddForce(Scale((1,0,1), cam.TransformDirection((x * max(0, speed + agility), 0, y * speed))), Acceleration)
   *   AddTorque(cam.TransformDirection((y, 0, -x)) * speed, Acceleration)
   *
   * `view` is the camera's world rotation (three.js convention, looking down its -Z).
   */
  drive(input: { x: number; y: number }, view: THREE.Quaternion, dt: number): void {
    if (!this.on || !this.collider || this.body.isKinematic() || (!input.x && !input.y)) return
    const speed = zorbSpeed.value
    const side = input.x * Math.max(0, speed + zorbAgility.value)
    tmpV.set(side, 0, -input.y * speed).applyQuaternion(view)
    tmpV.y = 0
    const mass = this.body.mass()
    this.body.addForce({ x: tmpV.x * mass, y: 0, z: tmpV.z * mass }, true)
    // Unity camera-local torque (y, 0, -x) mirrored to our frame is (-y, 0, -x). ForceMode
    // Acceleration ignores inertia, so it is an angular velocity change, as in UnityBody.
    tmpV.set(-input.y, 0, -input.x).applyQuaternion(view).multiplyScalar(speed * dt)
    const w = this.body.angvel()
    this.body.setAngvel({ x: w.x + tmpV.x, y: w.y + tmpV.y, z: w.z + tmpV.z }, true)
  }

  /**
   * Liquids while zorbed, in place of `applyVehicleLiquid` (not in the original, whose zorb ball
   * simply sank with the vehicle's own float code). The shared liquid pass measures immersion at
   * the body origin, which is the ball centre: in liquid deeper than the radius it cancelled the
   * drive and held the ball under the surface for good. A metres-wide force field full of air
   * floats instead: a damped support keeps its base about ZORB_FLOAT_DEPTH under the surface,
   * and a drag (thicker in lava) still lets the drive push it across and out. The vehicle inside
   * is shielded, so it neither heats nor counts as stuck. Kinematic copies only reset state.
   */
  float(terrain: ZorbLiquidTerrain, state: LiquidState, dt: number): void {
    state.lavaDepth = 0
    state.stuck = false
    state.heat = Math.max(0, state.heat - dt / lavaCoolingTime.value)
    state.wingLiftAvailable = false
    state.wingLiftSurface = -Infinity
    state.wingLiftSpeed = 0
    state.wingLaunchSpeed = 0
    state.fastWingContact = false
    state.wasImmersed = false
    if (!this.collider || this.body.isKinematic()) return
    const p = this.centre(tmpC)
    const surface = terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity
    const kind = Number.isFinite(surface) ? liquidKind(terrain as Terrain, p.x, p.z) : null
    if (!kind) return
    const depth = surface - (p.y - Math.max(MIN_RADIUS, this.radius))
    if (depth <= 0) return
    const g = -this.world.gravity.y
    const v = this.body.linvel()
    const mass = this.body.mass()
    // Weight is carried at the float depth; deeper pushes up harder, capped at 3 g.
    const lift = Math.min(3, depth / ZORB_FLOAT_DEPTH) * g - v.y * 2.5
    const wet = Math.min(1, depth / ZORB_FLOAT_DEPTH)
    const drag = (kind === 'lava' ? lavaViscosity.value : 1.2) * 0.15 * wet
    this.body.addForce({ x: -v.x * drag * mass, y: Math.max(0, lift) * mass, z: -v.z * drag * mass }, true)
  }

  /**
   * After the physics step: measure impacts and ground contact for the shield. Works from the
   * body's motion, so remote copies (often kinematic, which Rapier gives no terrain contacts)
   * flare too. RamoSphere.js OnCollisionEnter uses the contact's normal approach speed; the
   * velocity change outside gravity stands in for it, divided by (1 + e) for the rebound.
   */
  observe(velocity: THREE.Vector3, centre: THREE.Vector3, gravity: { x: number; y: number; z: number }, dt: number, terrain: ZorbTerrain): void {
    if (!this.collider) { this.hasVelocity = false; this.contact = 0; return }
    if (this.hasVelocity) {
      tmpN.copy(velocity).sub(this.lastVelocity)
      tmpN.x -= gravity.x * dt; tmpN.y -= gravity.y * dt; tmpN.z -= gravity.z * dt
      const i = tmpN.length() / (1 + this.restitution * 0.5)
      // RamoSphere.js: `if(i > 3)` flares the shield.
      if (i > 3) { this.impact = Math.max(this.impact, i); this.impacts++ }
    }
    this.lastVelocity.copy(velocity)
    this.hasVelocity = true
    const gap = centre.y - Math.max(MIN_RADIUS, this.radius) - terrain.heightAt(centre.x, centre.z)
    this.contact = THREE.MathUtils.clamp(1 - gap / 0.6, 0, 1)
    if (this.contact > 0) terrain.normalAt(centre.x, centre.z, this.contactDir).negate()
  }

  /** World position of the ball centre from the body's pose. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    const r = this.body.rotation()
    return out.copy(this.offset).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)).add(this.body.translation())
  }

  /** Read and clear the strongest impact since the last call. */
  takeImpact(): number {
    const i = this.impact
    this.impact = 0
    return i
  }

  /** Remove the collider; safe to call repeatedly. */
  remove(): void {
    if (this.collider) {
      // The body may already be gone when its vehicle is disposed.
      if (this.world.getCollider(this.collider.handle)) this.world.removeCollider(this.collider, true)
      this.collider = null
    }
    this.radius = 0
    this.on = false
    this.hasVelocity = false
  }
}

// ---------------------------------------------------------------------------------------------
// Visual: one additive sphere per zorbed vehicle, sharing two materials and one geometry.
// ---------------------------------------------------------------------------------------------

/** Brightness calibration for our tone mapped pipeline; Unity 2 drew it untonemapped. */
const SHIELD_GAIN = 3
/** ForceField _Offset advances .1 per second over a 4x tiled texture's v; on the unit sphere that
 * is about .1 * pi radians of latitude per second. */
const SCROLL_RATE = 0.1 * Math.PI
/** Noise frequency on the unit direction, about the feature size of the 4x tiled Plasma.png. */
const PATTERN_SCALE = 3.2

interface ShieldData { tint: THREE.Color; alpha: number; contact: number; contactDir: THREE.Vector3 }
const shieldData = (object: THREE.Object3D | null | undefined): ShieldData | undefined =>
  object?.userData.zorbShield as ShieldData | undefined

/** The Ramp.png facing-ratio curve: white below .08, falling to .14 by .78 (sampled from the asset). */
const facingRamp = Fn(() => {
  const facing = abs(dot(normalView, positionViewDirection))
  return mix(float(0.14), float(1), float(1).sub(smoothstep(0.08, 0.78, facing)))
})

function shieldMaterial(cheap: boolean): THREE.MeshBasicNodeMaterial {
  const tint = uniform(new THREE.Color()).onObjectUpdate(({ object }) => shieldData(object)?.tint)
  const alpha = uniform(0).onObjectUpdate(({ object }) => shieldData(object)?.alpha ?? 0)
  const contact = uniform(0).onObjectUpdate(({ object }) => shieldData(object)?.contact ?? 0)
  const contactDir = uniform(new THREE.Vector3(0, -1, 0)).onObjectUpdate(({ object }) => shieldData(object)?.contactDir)
  // The mesh keeps world rotation identity (RamoSphere.js Update), so the local position is a
  // world direction from the centre: no UVs, so no pinching at the poles.
  const dir = positionLocal.normalize()
  const patch = smoothstep(0.93, 1, dot(dir, contactDir)).mul(contact)
  const ramp = facingRamp()
  let colour
  if (cheap) {
    // Fresnel only: the ramp at the Plasma texture's mean grey, plus a plain contact glow.
    colour = ramp.mul(0.45).add(patch.mul(0.35))
  } else {
    // Plasma.png: grey marble with thin bright ridges. A domain-warped noise field, banded by a
    // sine, gives the same ridged swirl. It scrolls downward at the original rate and the warp
    // drifts slowly, so the pattern swirls rather than just sliding.
    const p = dir.mul(PATTERN_SCALE).add(vec3(0, time.mul(SCROLL_RATE * PATTERN_SCALE), 0))
    const warp = mx_noise_vec3(p.mul(0.6).add(vec3(time.mul(0.07), 0, time.mul(-0.05))))
    const n = mx_fractal_noise_float(p.add(warp.mul(1.3)), 3, 2, 0.5)
    const ridge = pow(float(1).sub(abs(sin(n.mul(10)))), 5)
    const marble = ridge.mul(0.85).add(n.mul(0.5).add(0.5).mul(0.3))
    // Where the ball meets the ground the ridges brighten into a caustic-like patch.
    colour = marble.mul(ramp).add(patch.mul(ridge.mul(1.3).add(0.1)))
  }
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
  material.fog = false
  // Transparent double sided materials otherwise draw back faces then front faces. Additive
  // light without depth writes does not depend on that order, so one draw is enough.
  material.forceSinglePass = true
  material.colorNode = tint.mul(colour).mul(alpha).mul(SHIELD_GAIN).mul(hotExposureNode())
  material.name = cheap ? 'zorb-shield-cheap' : 'zorb-shield'
  return material
}

let shared: { full: THREE.MeshBasicNodeMaterial; cheap: THREE.MeshBasicNodeMaterial; geometry: THREE.SphereGeometry; users: number } | null = null

function acquireShared() {
  shared ??= { full: shieldMaterial(false), cheap: shieldMaterial(true), geometry: new THREE.SphereGeometry(1, 64, 32), users: 0 }
  shared.users++
  return shared
}

function releaseShared(): void {
  if (!shared || --shared.users > 0) return
  shared.full.dispose(); shared.cheap.dispose(); shared.geometry.dispose()
  shared = null
}

/** Distance beyond which a remote vehicle's shield uses the cheap material. */
export const ZORB_CHEAP_DISTANCE = 120

/** The rendered shield. Lives in the scene, not under the vehicle, so it never rotates. */
export class ZorbShield implements ShieldData {
  readonly mesh: THREE.Mesh
  readonly tint = new THREE.Color()
  /** RamoSphere.js colorSet: a fresh shield starts transparent and eases in. */
  alpha = 0
  contact = 0
  readonly contactDir = new THREE.Vector3(0, -1, 0)
  private readonly materials = acquireShared()
  private disposed = false

  constructor(private readonly scene: THREE.Object3D) {
    this.mesh = new THREE.Mesh(this.materials.geometry, this.materials.full)
    this.mesh.name = 'zorb-shield'
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.renderOrder = 2
    this.mesh.userData.zorbShield = this
    scene.add(this.mesh)
  }

  /**
   * Per rendered frame. Returns false once a switched-off shield has faded and can be disposed.
   * RamoSphere.js Update: alpha eases toward its resting value at rate 3 per second; an impact
   * with normal speed i > 3 sets it to rest + i * .1.
   */
  update(dt: number, ball: ZorbBall, vehicle: THREE.Object3D, accent: THREE.ColorRepresentation, cheap: boolean): boolean {
    const on = ball.on
    const impact = ball.takeImpact()
    if (impact > 3) this.alpha = Math.max(this.alpha, ZORB_REST_ALPHA + impact * 0.1)
    this.alpha = THREE.MathUtils.lerp(this.alpha, on ? ZORB_REST_ALPHA : 0, Math.min(1, dt * 3))
    if (ball.active) this.mesh.scale.setScalar(Math.max(MIN_RADIUS, ball.radius))
    this.mesh.position.copy(ball.offset).applyQuaternion(vehicle.quaternion).add(vehicle.position)
    this.mesh.quaternion.copy(tmpQ.identity())
    this.contact = THREE.MathUtils.lerp(this.contact, ball.active ? ball.contact : 0, Math.min(1, dt * 8))
    this.contactDir.lerp(ball.contactDir, Math.min(1, dt * 8)).normalize()
    this.tint.set(accent)
    this.mesh.material = cheap ? this.materials.cheap : this.materials.full
    return ball.active || this.alpha > 0.004
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.mesh)
    releaseShared()
  }
}
