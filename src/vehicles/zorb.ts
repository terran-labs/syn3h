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
  positionViewDirection, pow, sin, smoothstep, time, uniform, vec3, clamp } from 'three/tsl'
import { defineParam } from '../../shared/params'
import { FIXED_DT, GROUP_ALL, GROUP_VEHICLE, RAPIER, groups } from '../core/physics'
import { type InputState, emptyInput } from '../core/Input'
import type { Terrain } from '../world/Terrain'
import { applyWaterForces, waterSinking } from './buoyancy'
import { type LiquidState, lavaCoolingTime, lavaViscosity, liquidKind } from './lava'
import { hotExposureNode } from './skins/hotExposure'

// Game/Settings.js 80-83 and 733-780. ramoSpheres defaults to 0 there (shields off) and the
// "RORBs Enabled" toggle sets it to .5; zorb mode is per player here, so .5 is the default.
export const zorbSize = defineParam({ id: 'zorb.size', label: 'Ball size', group: 'Zorb', scope: 'world', default: 0.5, min: 0.001, max: 1, step: 0.001 })
/** 0 disables zorbing, as the "XORBs Available" toggle did (Messaging.js 67). */
export const zorbSpeed = defineParam({ id: 'zorb.speed', label: 'Roll speed (m/s²)', group: 'Zorb', scope: 'world', default: 7, min: 0, max: 14, step: 0.1 })
export const zorbAgility = defineParam({ id: 'zorb.agility', label: 'Sideways agility (m/s²)', group: 'Zorb', scope: 'world', default: 0, min: -7, max: 7, step: 0.1 })
/**
 * Bounciness, 0 to 2: half of it is the ball's restitution, combined with what it hits by the
 * larger of the two (Max). Against the ground (restitution 0) that is exactly what the old 0 to 1
 * slider gave by averaging (b + 0) / 2, so a value saved in a world link behaves as before, and
 * 2 is a perfect bounce. Rebound height goes as the square: the default 1.1 (restitution .55)
 * rebounds to about 30 percent of the drop, the owner's choice after reading 75 percent at 1.75;
 * the old default .5 rebounded to 6 percent.
 * The owner, 16 November 2026: "The zorb should also be substantially bouncier by default."
 */
export const zorbBounce = defineParam({ id: 'zorb.bounce', label: 'Bounciness (2 is a perfect bounce)', group: 'Zorb', scope: 'world', default: 1.1, min: 0, max: 2, step: 0.01 })
/** The ball's restitution for a bounciness slider value (see zorbBounce). */
export const zorbRestitution = (bounce: number): number => Math.min(1, Math.max(0, bounce / 2))
// Not in the original. Space inside the ball: a hop and a pulse of the shield (see `hold`).
/**
 * Height a hop lifts the ball, under any gravity: a velocity change of sqrt(2 g h), so every
 * vehicle mass hops the same and a low-gravity world changes the hang time, not the height.
 * The owner, 16 November 2026: "it needs to actually lift the vehicle more, pop it around."
 */
export const zorbHopHeight = defineParam({ id: 'zorb.hopHeight', label: 'Hop height (m)', group: 'Zorb', scope: 'world', default: 4.5, min: 0, max: 12, step: 0.1 })
export const zorbHopCooldown = defineParam({ id: 'zorb.hopCooldown', label: 'Time between hops (s)', group: 'Zorb', scope: 'world', default: 0.5, min: 0, max: 3, step: 0.05 })
export const zorbAirHops = defineParam({ id: 'zorb.airHops', label: 'Hop in mid-air', group: 'Zorb', scope: 'world', default: false })
/** Extra shield brightness at the peak of a hop's pulse; it eases back like an impact flare. */
export const zorbPulseBrightness = defineParam({ id: 'zorb.pulseBrightness', label: 'Hop pulse brightness', group: 'Zorb', scope: 'world', default: 0.8, min: 0, max: 3, step: 0.05 })

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
/** A hop counts the ball as on a liquid while its base is within this many metres of the surface. */
const HOP_LIQUID_REACH = 0.5
/** Spin (rad/s) a full hop gives the ball, so the vehicle tumbles inside it. */
const HOP_TUMBLE = 3
/** Seconds a press in the air is remembered: it hops on touching down within this. */
const HOP_BUFFER = 0.25
/** Impact speeds (m/s) between which the ball's bounce eases from none to full (see `sync`). */
const BOUNCE_DEAD = 1
const BOUNCE_FULL = 4
/**
 * Holding brake in the ball damps its bounce to a dull thud: restitution eases to this within
 * about BRAKE_EASE seconds, and back on release. The owner, 16 November 2026: "holding brake,
 * making the Zorb less bouncy is a wonderful idea." Brake did nothing in a zorb before (the
 * controller sees it masked, and the ball's own drive ignores it), so it applies no rolling
 * brake: only the bounce changes. It is the replicated `brakes` input, so every client's copy
 * of a player's ball bounces the same.
 */
const BRAKE_RESTITUTION = 0.1
const BRAKE_EASE = 0.15
/** How far the shield swells at the peak of a hop's pulse, as a fraction of the radius. */
const PULSE_SWELL = 0.12
/** Rate per second the swell eases back. */
const PULSE_EASE = 7

type PulseListener = (ball: ZorbBall, centre: THREE.Vector3) => void
const pulseListeners = new Set<PulseListener>()
/**
 * Called on every hop's pulse, on every client that sees it (the owner, remote copies and
 * bots alike), with the ball and its world centre. For a future pulse sound; nothing listens
 * yet. Returns the unsubscribe function.
 */
export function onZorbPulse(listener: PulseListener): () => void {
  pulseListeners.add(listener)
  return () => pulseListeners.delete(listener)
}

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
// The hop's own scratch, apart from tmpV / tmpN / tmpC, which its prediction uses.
const hopKick = new THREE.Vector3(), hopTravel = new THREE.Vector3(), hopTumble = new THREE.Vector3(), hopUp = new THREE.Vector3(0, 1, 0)
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
  /** Restitution last set on the collider (see `sync`). */
  private applied = -1
  /** 0 to 1: how far holding brake has damped the bounce (see BRAKE_RESTITUTION). */
  damp = 0
  /** Ball centre in the vehicle's local frame, fixed when the ball is built. */
  readonly offset = new THREE.Vector3()
  /** The input as given, kept by `hold` while the controller sees the masked one. */
  readonly raw: InputState = emptyInput()
  /** True between `hold` and `release`: the vehicle's `input` is masked. */
  masked = false
  /** Hops made, for tests and debugging. */
  hops = 0
  /** Strength (0..1) of a pulse not yet shown by the shield. */
  pulse = 0
  /** The ball's base is on or just over a liquid surface (set by `float`). */
  onLiquid = false
  private lastSpecial = false
  private armed = false
  private hopCooldown = 0
  private hopPending = false
  /** Spin to add on the step after a hop (see applyHop). */
  private readonly tumble = new THREE.Vector3()
  /** Seconds left on a press made in the air (see HOP_BUFFER). */
  private buffered = 0

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
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setCollisionGroups(groups(GROUP_VEHICLE, GROUP_ALL)),
        this.body,
      )
      this.restitution = zorbBounce.value
      this.applied = 0
    }
    // Vehicle.js 175-176: Lerp(scale, target, fixedDeltaTime), then stop within .01 of scale
    // (.005 of radius).
    if (this.radius !== this.target) {
      this.radius += (this.target - this.radius) * Math.min(1, dt)
      if (Math.abs(this.radius - this.target) < 0.005) this.radius = this.target
      this.collider.setRadius(Math.max(MIN_RADIUS, this.radius))
    }
    // Settings.js 1691: zorbPhysics.bounciness = zorbBounce, live. Below BOUNCE_FULL m/s the
    // restitution eases away, to none at BOUNCE_DEAD: the big bounces are untouched and the tail
    // of ever smaller ones ends after a handful instead of running on for half a minute.
    this.restitution = zorbBounce.value
    const v = this.body.linvel()
    const ease = THREE.MathUtils.smoothstep(Math.hypot(v.x, v.y, v.z), BOUNCE_DEAD, BOUNCE_FULL)
    // `raw` holds the last step's input as given, before `hold` masks brake from the controller.
    this.damp += ((this.raw.brakes ? 1 : 0) - this.damp) * Math.min(1, dt / BRAKE_EASE)
    const full = zorbRestitution(this.restitution)
    const e = THREE.MathUtils.lerp(full, Math.min(full, BRAKE_RESTITUTION), this.damp) * ease
    if (Math.abs(e - this.applied) > 0.005) { this.applied = e; this.collider.setRestitution(e) }
  }

  /**
   * Called by the vehicle just before its controller, with `release` just after. Not in the
   * original. While the ball exists the controller sees its mechanisms at rest: `input` is
   * masked (axes zero, brakes off, `special` off), so the buggy's wings, the jet's flight
   * mode and thrust, motors and tracks stay put. (The jet lowers its gear in hover mode, which
   * a masked `special` means; Jet.ts checks `zorbed` for that.) `release` puts the raw input back, so the ball's drive, the
   * network state and anything reading `input` between steps see what was pressed; readers
   * that should go quiet too (audio, effects) check `vehicle.zorbed`. Plasma Tag's `fire`
   * and the `zorb` flag pass through.
   *
   * `special` is a toggle (Space). While zorb mode is on, every change of it is one press, and
   * one press is one hop: an edge test, so remote copies see the owner's hops from the
   * replicated bit with no protocol change. Anything Space deploys is stowed for the whole
   * zorb ride and stays stowed after it (the owner's decision of 15 November 2026): on
   * switching off, `owner` (the local player's input state, null for remote copies and bots)
   * has its `special` cleared, which reaches other clients in the same state message that
   * clears `zorb`.
   */
  hold(input: InputState, owner: InputState | null, dt: number): void {
    this.hopCooldown = Math.max(0, this.hopCooldown - dt)
    if (!this.collider) { this.armed = false; this.hopPending = false; return }
    if (!this.on && this.armed && owner) { owner.special = false; input.special = false }
    // An edge only counts once a step has already run with zorb on, so the step that switches
    // it on is never read as a press.
    if (this.on && this.armed && input.special !== this.lastSpecial && !this.tryHop() && this.airborne()) this.buffered = HOP_BUFFER
    // A press just before touching down hops on contact, so it never feels dropped.
    if (this.buffered > 0) { this.buffered -= dt; if (this.on && !this.airborne() && this.tryHop()) this.buffered = 0 }
    this.lastSpecial = input.special
    this.armed = this.on
    Object.assign(this.raw, input)
    input.x = 0; input.y = 0; input.z = 0; input.w = 0
    input.brakes = false; input.special = false
    this.masked = true
  }

  /** Undo `hold`'s mask once the controller has run. */
  release(input: InputState): void {
    if (!this.masked) return
    this.masked = false
    Object.assign(input, this.raw)
  }

  /** A press inside the ball: hop if on (or near) the ground or a liquid and off cooldown. */
  /** Off the ground and off any liquid: where a hop needs `zorb.airHops`. */
  private airborne(): boolean { return this.contact <= 0 && !this.onLiquid }

  /** Returns whether it hopped. */
  private tryHop(): boolean {
    if (this.hopCooldown > 0 || this.radius < this.target * 0.5) return false
    if (!zorbAirHops.value && this.airborne()) return false
    this.hopCooldown = zorbHopCooldown.value
    this.hopPending = true
    this.hops++
    this.pulse = 1
    if (pulseListeners.size) { const c = this.centre(new THREE.Vector3()); for (const fn of pulseListeners) fn(this, c) }
    return true
  }

  /**
   * The hop's lift, after the controller (so a controller that integrates its own velocity
   * does not overwrite it). Only bodies simulated here.
   *
   * A pop: a velocity change along the surface normal blended with world up (on a slope it
   * kicks the ball off the slope, not straight up), sized so the ball rises `zorb.hopHeight` at
   * any gravity and mass. It brings the upward speed to sqrt(2 g h) and never adds to upward
   * motion beyond that, so a hop timed on a bounce cannot climb higher and higher. Rolling
   * momentum carries on, and a tumble set spinning about the travel direction's side axis makes
   * the vehicle visibly turn over inside the shield through the hop.
   */
  private applyHop(): void {
    // The tumble goes on a step after the lift, once the ball is off the ground: spun while
    // still pressed into it, friction turned some of the lift into rolling.
    if (this.tumble.lengthSq() > 0) {
      if (this.collider && !this.body.isKinematic()) { const w = this.body.angvel(); this.body.setAngvel({ x: w.x + this.tumble.x, y: w.y, z: w.z + this.tumble.z }, true) }
      this.tumble.set(0, 0, 0)
    }
    if (!this.hopPending) return
    this.hopPending = false
    if (!this.collider || this.body.isKinematic()) return
    const g = Math.max(0.1, -this.world.gravity.y)
    const v = this.body.linvel()
    const launch = Math.sqrt(2 * g * zorbHopHeight.value)
    // contactDir points from the centre to the ground: its reverse is the surface normal.
    const kick = hopKick.set(0, 1, 0)
    if (this.contact > 0) kick.addScaledVector(this.contactDir, -1)
    kick.normalize()
    if (kick.y < 0.5) kick.set(0, 1, 0)
    // The vehicle rises the slider's height: sqrt(2 g h), plus the one step of gravity the
    // integrator takes off before it leaves the ground. The ball around it swings by up to the
    // keel offset (0.35 m) with the tumble.
    const s = Math.max(0, launch + g * FIXED_DT - v.y) / kick.y
    if (s > 0) {
      this.body.applyImpulse({ x: kick.x * s * this.body.mass(), y: kick.y * s * this.body.mass(), z: kick.z * s * this.body.mass() }, true)
      // Not a collision: keep the hop out of the impact flare (`observe`).
      this.lastVelocity.addScaledVector(kick, s)
      this.tumble.copy(this.tumbleFor(v, Math.min(1, s / launch)))
    }
  }

  /** Tumble: a forward roll about the side axis of travel (of the body's own side at rest). */
  private tumbleFor(v: { x: number; z: number }, share: number): THREE.Vector3 {
    const travel = hopTravel.set(v.x, 0, v.z)
    if (travel.lengthSq() < 1) { const r = this.body.rotation(); travel.set(0, 0, -1).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)).setY(0) }
    if (travel.lengthSq() < 1e-6) return hopTumble.set(0, 0, 0)
    return hopTumble.copy(travel.normalize()).cross(hopUp).multiplyScalar(-HOP_TUMBLE * share)
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
   * Runs after the controller on every zorbed step, so it also gives a pending hop its lift.
   */
  float(terrain: ZorbLiquidTerrain, state: LiquidState, dt: number): void {
    this.applyHop()
    state.lavaDepth = 0
    state.stuck = false
    state.heat = Math.max(0, state.heat - dt / lavaCoolingTime.value)
    state.wingLiftAvailable = false
    state.wingLiftSurface = -Infinity
    state.wingLiftSpeed = 0
    state.wingLaunchSpeed = 0
    state.fastWingContact = false
    state.wasImmersed = false
    if (!this.collider) { this.onLiquid = false; return }
    const p = this.centre(tmpC)
    const surface = terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity
    this.onLiquid = surface - (p.y - Math.max(MIN_RADIUS, this.radius)) > -HOP_LIQUID_REACH
    if (this.body.isKinematic()) return
    const kind = Number.isFinite(surface) ? liquidKind(terrain as Terrain, p.x, p.z) : null
    if (!kind) return
    if(kind === 'water' && waterSinking.value){
      applyWaterForces(this.body,this.world,terrain as Terrain,'zorb',dt,Math.max(MIN_RADIUS,this.radius),p)
      return
    }
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
    // Closing: the shrinking ball lowering the car, and the car settling onto its wheels or a
    // slope, are not blows. Flaring for them lit the fading shield up again (the owner's
    // "flash where it turns green and gets larger and then smaller" when closing).
    if (this.hasVelocity && this.on) {
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

  /** Read and clear the strength of a hop's pulse not yet shown. */
  takePulse(): number {
    const p = this.pulse
    this.pulse = 0
    return p
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
    this.masked = false
    this.armed = false
    this.hopPending = false
    this.tumble.set(0, 0, 0)
    this.buffered = 0
    this.damp = 0
    this.onLiquid = false
    // Nothing of this ball carries to the next one (a fresh world, see Vehicle.resetForWorld).
    this.hopCooldown = 0
    this.pulse = 0
    this.lastSpecial = false
    this.shrinkSpeed = 0
    this.contact = 0
    this.impact = 0
  }
}

// ---------------------------------------------------------------------------------------------
// Visual: one additive sphere per zorbed vehicle, sharing two materials and one geometry.
// ---------------------------------------------------------------------------------------------

/** Brightness calibration for our tone mapped pipeline; Unity 2 drew it untonemapped. */
const SHIELD_GAIN = 3.6
/** How much of the scene behind the shield its brightest parts hold back, so the tint reads in daylight. */
const SHIELD_COVER = 2.4
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
  // The original was pure additive in an untonemapped frame. Over a sunlit scene here that
  // washes toward white, so the shield also holds back a little of what is behind it
  // (premultiplied: source + destination * (1 - coverage)). The tint then survives at noon,
  // and at night, where there is little behind it, the result is the additive look as before.
  const strength = colour.mul(alpha)
  material.blending = THREE.CustomBlending
  material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  material.colorNode = tint.mul(strength).mul(SHIELD_GAIN).mul(hotExposureNode())
  material.opacityNode = clamp(strength.mul(SHIELD_COVER), 0, 0.7)
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
  /** A hop's swell, as a fraction of the radius, easing back to 0. */
  swell = 0
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
    // Read both either way, so nothing left over flares a later shield. Once switched off the
    // shield only fades and shrinks: no flare, no swell.
    const impact = ball.takeImpact()
    const pulse = ball.takePulse()
    if (!on) this.swell = 0
    if (on && impact > 3) this.alpha = Math.max(this.alpha, ZORB_REST_ALPHA + impact * 0.1)
    // A hop's pulse: the same flare as an impact, set by `zorb.pulseBrightness`, and a swell.
    // Both ease back on the shield's own rates, so it needs no new uniform or material.
    if (on && pulse > 0) { this.alpha = Math.max(this.alpha, ZORB_REST_ALPHA + zorbPulseBrightness.value * pulse); this.swell = PULSE_SWELL * pulse }
    this.swell *= Math.exp(-PULSE_EASE * dt)
    this.alpha = THREE.MathUtils.lerp(this.alpha, on ? ZORB_REST_ALPHA : 0, Math.min(1, dt * 3))
    const size = Math.max(MIN_RADIUS, ball.radius) * (1 + this.swell)
    if (on) this.mesh.scale.setScalar(size)
    // Closing, the shield never grows. Once the collider is gone it keeps shrinking at the
    // closing speed while it fades, instead of hanging round the car at its last size.
    else this.mesh.scale.setScalar(Math.max(MIN_RADIUS, Math.min(this.mesh.scale.x, ball.active ? size : this.mesh.scale.x - ZORB_SHRINK_SPEED * dt)))
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
