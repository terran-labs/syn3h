import {applyVehicleLiquid,createLiquidState,registerLiquidTerrain} from './lava'
/**
 * Vehicle base class.
 *
 * A vehicle is one Rapier rigid body plus a Three.js object. Subclasses implement
 * `applyForces`, which is the port of the original script's FixedUpdate: read `this.input`
 * and the shared parameters, cast rays, add forces. Nothing else moves the body.
 *
 * Local and remote vehicles are the same class. A local vehicle copies the player's input
 * each step. A remote one has its `input` and target state written by the network layer,
 * which is why all control state lives in `input` and `getState`/`setState` here.
 */
import * as THREE from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { type InputState, emptyInput } from '../core/Input'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, GROUP_VEHICLE, RAPIER, groups } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { graphicsLevel, levelNumber } from '../core/quality'
import type { VehicleDetail } from './skins/mergeStatic'
import type { VehicleKind } from './index'
import { ZORB_CHEAP_DISTANCE, ZORB_DEFAULT_CAM_OFFSET, ZorbBall, ZorbShield, zorbSpeed } from './zorb'

/** Everything needed to reproduce a vehicle on another client. Plain numbers for the wire. */
export interface VehicleState {
  p: [number, number, number]
  q: [number, number, number, number]
  /** Linear velocity. */
  v: [number, number, number]
  /** Angular velocity. */
  w: [number, number, number]
  input: InputState
}

/** Per wheel contact state for skidmarks and dust. See `Vehicle.getWheelEffects`. */
export interface WheelEffect {
  /** The wheel's suspension ray hit something this step. */
  grounded: boolean
  /** World space contact point (last hit; stale while not grounded). */
  readonly point: THREE.Vector3
  /** World space surface normal at the contact (last hit; stale while not grounded). */
  readonly normal: THREE.Vector3
  /** Sideways speed of the wheel over the ground in m/s, absolute. 0 while not grounded. */
  slip: number
}

export function createWheelEffects(count = 4): WheelEffect[] {
  return Array.from({ length: count }, () => ({
    grounded: false, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), slip: 0,
  }))
}

export abstract class Vehicle implements System {
  readonly object = new THREE.Group()
  private readonly visualDetails=new Set<VehicleDetail>()
  readonly liquidState=createLiquidState()
  get lavaDepth():number {return this.liquidState.lavaDepth}
  get stuck():boolean {return this.liquidState.stuck}
  /** HUD hint: a wet buggy with closed wings and the shared escape lift enabled. */
  get canLiftOut():boolean {return !this.wingsOpen&&this.liquidState.wingLiftAvailable}
  readonly body: RAPIER.RigidBody
  /** Control state for this step. Written by the player or by the network layer. */
  readonly input: InputState = emptyInput()
  /** True when this client simulates and owns the vehicle. */
  isLocal = true
  /**
   * Wind acceleration in m/s^2, applied at the centre of mass at the end of each fixed step.
   * Zero by default. The weather system (src/world/weather) sets it on the vehicles this
   * client simulates; remote copies keep zero because their owner already applied it.
   */
  readonly wind = new THREE.Vector3()
  /** Display name and stable id, set by whoever spawns it. */
  id = ''
  name = ''
  /** Which vehicle this is, so networking can create the same kind on other clients. */
  abstract readonly kind: VehicleKind
  /** Wheels (or tracks) touching the ground this step. For audio and effects. */
  wheelsGrounded = 0
  /** True while wings (or a flight mode) are deployed. For audio and effects. */
  wingsOpen = false
  /** True on the fixed step the wheels touched down after being fully airborne. For effects. */
  landedThisStep = false
  /** Downward speed in m/s at the last touchdown (valid when `landedThisStep`). For effects. */
  landingImpact = 0
  /**
   * Zorb mode ball (see zorb.ts). Its collider exists while `input.zorb` is on and the world's
   * zorb.speed is above zero, on local and remote copies alike.
   */
  readonly zorb: ZorbBall
  /**
   * Camera rotation the zorb drive is relative to (VehicleMe.js 80-87). The owner copies the
   * game camera here each step; remote copies leave it null and are never driven; headless
   * tests set it directly.
   */
  zorbView: THREE.Quaternion | null = null
  private zorbShield: ZorbShield | null = null
  /** True while the zorb ball collider exists. Controllers skip self righting while it does. */
  get zorbed(): boolean { return this.zorb.active }

  /**
   * Optional: per wheel contact state from the last fixed step, for skidmarks and dust. Returns
   * the same persistent objects every call (no allocation); wheel vehicles list front left,
   * front right, rear left, rear right.
   */
  getWheelEffects?(): readonly WheelEffect[]
  /** Body and accent colours, kept here so networking can replicate them. */
  readonly colors = { body: '#1768b4', accent: '#49e6ff' }

  /** Tint the vehicle. Subclasses apply it to their visuals in `applyColors`. */
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.colors.body = `#${new THREE.Color(body).getHexString()}`
    this.colors.accent = `#${new THREE.Color(accent).getHexString()}`
    this.applyColors()
  }

  protected applyColors(): void {}

  private readonly prevPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly currPos = new THREE.Vector3()
  private readonly currQuat = new THREE.Quaternion()

  constructor(
    protected readonly game: Game,
    protected readonly terrain: Terrain,
    position: THREE.Vector3,
    heading = 0,
  ) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    this.body = game.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(q)
        .setCanSleep(false)
        .setCcdEnabled(true),
    )
    registerLiquidTerrain(this.body,terrain,this.liquidState)
    this.object.userData.vehicleHeat=this.liquidState
    this.currPos.copy(position)
    this.prevPos.copy(position)
    this.currQuat.copy(q)
    this.prevQuat.copy(q)
    this.object.position.copy(position)
    this.object.quaternion.copy(q)
    this.zorb = new ZorbBall(game.world, this.body, () => (this as { camOffset?: number }).camOffset ?? ZORB_DEFAULT_CAM_OFFSET)
    this.object.userData.registerVehicleDetail=(fn:VehicleDetail)=>{this.visualDetails.add(fn);return()=>this.visualDetails.delete(fn)}
    game.scene.add(this.object)
  }

  /** Collision groups for chassis colliders. */
  protected static chassisGroups(): number {
    return groups(GROUP_VEHICLE, GROUP_ALL)
  }

  /** The port of the original FixedUpdate. Called once per fixed step for every vehicle. */
  protected abstract applyForces(dt: number): void

  fixedUpdate(dt: number): void {
    if (this.isLocal) {
      Object.assign(this.input, this.game.input.state)
      this.zorbView = this.game.camera?.quaternion ?? null
      this.localSafety()
    }
    this.body.resetForces(true)
    this.body.resetTorques(true)
    // Before the controller, so its guards see this step's ball. Messaging.js 67: no zorbing
    // while zorbSpeed is 0.
    this.zorb.sync(this.input.zorb && zorbSpeed.value > 0, dt)
    const entryVelocity=this.body.linvel()
    this.liquidState.entrySpeed=Math.hypot(entryVelocity.x,entryVelocity.z)
    // Forward means launch thrust while the escape field owns motion. Feeding it
    // into the flight pitch filter would leave a nose-down command at handover.
    const escapeThrottle=this.input.y
    if(Number.isFinite(this.liquidState.wingLiftSurface))this.input.y=0
    try {this.applyForces(dt)} finally {this.input.y=escapeThrottle}
    if (this.zorbView) this.zorb.drive(this.input, this.zorbView, dt)
    // A zorb ball floats on liquid as a whole; the vehicle inside is shielded (zorb.ts float).
    if(this.zorbed)this.zorb.float(this.terrain,this.liquidState,dt)
    else applyVehicleLiquid(this.body,this.game.world,this.terrain,this.input,this.kind,this.liquidState,dt,this.wingsOpen)
    if(this.lavaDepth>0 && 'inLiquid' in this)(this as unknown as {inLiquid:boolean}).inLiquid=true
    // Last, so the controllers and the liquid pass are untouched and the force still reaches
    // the integrator. A force, never a velocity write: buggies integrate their own accelerations.
    const w=this.wind
    if((w.x!==0||w.y!==0||w.z!==0)&&!this.body.isKinematic()){const m=this.body.mass();this.body.addForce({x:w.x*m,y:w.y*m,z:w.z*m},true)}
  }

  /**
   * Spawn slot used by `localSafety` when the vehicle falls off the world: it respawns at
   * `terrain.spawnPoint(spawnSlot)`. Networking: set this whenever the server assigns the
   * player a slot (the same index you pass to `terrain.spawnPoint` when teleporting the player
   * there), so a fall-off respawn lands on the player's own pad. Defaults to 0.
   */
  spawnSlot = 0
  private readonly safetyRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  /**
   * Owner-side safety nets, run only for the vehicle this client simulates:
   *  - Fell off the world (Syn3h VhiclMe.cs 41-47, Mars Explorer VehicleMe.js 70-76): below
   *    y -300, keep only the direction of travel and return to a spawn point. The originals
   *    used a fixed point; a spawn point works on any seed.
   *  - Underground rescue (Syn3h VhiclLocal.cs, MapMagic block): under the ground surface with
   *    no terrain beneath, put it back on the surface 3 m up (the prefab CamOffset).
   *  - Speed clamp (Mars Explorer VehicleMe.js 77): above 500 m/s, halve the velocity.
   */
  protected localSafety(): void {
    const b = this.body
    const t = b.translation()
    if (t.y < -300) {
      const v = b.linvel()
      const len = Math.hypot(v.x, v.y, v.z) || 1
      const s = this.terrain.spawnPoint(this.spawnSlot)
      this.teleport(s.position, s.heading)
      b.setLinvel({ x: v.x / len, y: v.y / len, z: v.z / len }, true)
      return
    }
    const half = this.terrain.size / 2
    if (Math.abs(t.x) < half && Math.abs(t.z) < half) {
      const ground = this.terrain.heightAt(t.x, t.z)
      if (t.y < ground - 0.5) {
        this.safetyRay.origin = t
        const below = this.game.world.castRay(
          this.safetyRay, 1e4, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          groups(GROUP_ALL, GROUP_TERRAIN), undefined, b,
        )
        if (!below) b.setTranslation({ x: t.x, y: ground + 3, z: t.z }, true)
      }
    }
    const v = b.linvel()
    if (v.x * v.x + v.y * v.y + v.z * v.z > 500 * 500) b.setLinvel({ x: v.x * 0.5, y: v.y * 0.5, z: v.z * 0.5 }, true)
    // A zorbed vehicle tumbles with its ball by design; do not set it upright.
    if (this.zorbed) this.stuckSteps = 0
    else this.uprightRescue()
  }

  /** Fixed steps spent stuck on the roof or side; see `uprightRescue`. */
  stuckSteps = 0
  /** Seconds a vehicle may lie on its roof or side before it is set upright. */
  static readonly STUCK_SECONDS = 3

  /**
   * Timed fallback for a vehicle that cannot right itself (not in either original). Lying flat
   * on its roof the original self righting torque, cross(up, Y) * angle, is near zero and
   * gravity holds the flat roof down, so the player is stuck. Tilted past about 72 degrees,
   * slower than 3 m/s and within 3 m of the ground for 3 s: set it upright in place, keeping
   * its heading, lifted clear of the ground.
   */
  protected uprightRescue(): void {
    const b = this.body
    const r = b.rotation()
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z)
    const t = b.translation()
    const v = b.linvel()
    const ground = this.terrain.heightAt(t.x, t.z)
    const stuck = upY < 0.3 && v.x * v.x + v.y * v.y + v.z * v.z < 9 && t.y - ground < 3
    this.stuckSteps = stuck ? this.stuckSteps + 1 : 0
    if (this.stuckSteps * FIXED_DT < Vehicle.STUCK_SECONDS) return
    this.stuckSteps = 0
    // Heading from the forward axis projected on the ground; fall back to the up axis when the
    // nose points straight up or down.
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w)
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    if (f.x * f.x + f.z * f.z < 0.01) f.set(0, 1, 0).applyQuaternion(q).negate()
    const heading = Math.atan2(-f.x, -f.z)
    this.teleport(new THREE.Vector3(t.x, Math.max(t.y, ground) + 1.5, t.z), heading)
  }

  /**
   * Move by a whole world tile across the seam of a wrapping world. Velocity and rotation
   * are kept and the drawn position moves with the body, so nothing is seen to jump.
   */
  shiftBy(dx: number, dz: number): void {
    const t = this.body.translation()
    this.body.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true)
    this.prevPos.x += dx; this.prevPos.z += dz
    this.currPos.x += dx; this.currPos.z += dz
    this.object.position.x += dx; this.object.position.z += dz
  }

  postPhysics(dt: number): void {
    this.prevPos.copy(this.currPos)
    this.prevQuat.copy(this.currQuat)
    const t = this.body.translation()
    const r = this.body.rotation()
    this.currPos.set(t.x, t.y, t.z)
    this.currQuat.set(r.x, r.y, r.z, r.w)
    if (this.zorb.active) {
      const v = this.body.isKinematic() ? this.zorbVelocity.subVectors(this.currPos, this.prevPos).divideScalar(dt) : this.zorbVelocity.copy(this.body.linvel())
      this.zorb.observe(v, this.zorb.centre(this.zorbCentre), this.game.world.gravity, dt, this.terrain)
    }
  }
  private readonly zorbVelocity = new THREE.Vector3()
  private readonly zorbCentre = new THREE.Vector3()

  update(dt: number, alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha)
    this.object.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha)
    const distance=this.game.camera?.position.distanceTo(this.object.position)??0
    for(const detail of this.visualDetails)detail(distance,!this.isLocal,graphicsLevel.value)
    this.updateZorbShield(dt,distance)
  }

  /** One shield mesh per zorbed vehicle; level 0 and far remote copies get the fresnel-only one. */
  private updateZorbShield(dt:number,distance:number):void {
    if(!this.zorbShield){
      if(!this.zorb.active)return
      this.zorbShield=new ZorbShield(this.game.scene)
    }
    const cheap=levelNumber(graphicsLevel.value)===0||(!this.isLocal&&distance>ZORB_CHEAP_DISTANCE)
    if(!this.zorbShield.update(dt,this.zorb,this.object,this.colors.accent,cheap)){
      this.zorbShield.dispose();this.zorbShield=null
    }
  }

  /** Teleport, clearing motion and interpolation history. */
  teleport(position: THREE.Vector3, heading = 0): void {
    this.liquidState.wingLiftSurface=-Infinity
    this.liquidState.wingLiftSpeed=0
    this.liquidState.wingLiftAvailable=false
    this.liquidState.wasImmersed=false
    this.liquidState.wingWasOpen=this.wingsOpen
    this.liquidState.fastWingContact=false
    this.liquidState.wingLaunchSpeed=0
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    this.body.setTranslation(position, true)
    this.body.setRotation(q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.currPos.copy(position)
    this.prevPos.copy(position)
    this.currQuat.copy(q)
    this.prevQuat.copy(q)
  }

  getState(): VehicleState {
    const p = this.body.translation()
    const q = this.body.rotation()
    const v = this.body.linvel()
    const w = this.body.angvel()
    return {
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      v: [v.x, v.y, v.z],
      w: [w.x, w.y, w.z],
      input: { ...this.input },
    }
  }

  dispose(): void {
    this.zorbShield?.dispose()
    this.zorbShield = null
    this.zorb.remove()
    this.visualDetails.clear()
    this.game.scene.remove(this.object)
    this.game.world.removeRigidBody(this.body)
  }
}

/**
 * A box that drives. Exists only so the foundation runs before the real buggy lands.
 * Not a model for vehicle code: the buggy is a port of the original raycast suspension.
 */
export class PlaceholderVehicle extends Vehicle {
  readonly kind = 'buggy' as const
  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0) {
    super(game, terrain, position, heading)
    this.game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.4, 1.6)
        .setMass(30)
        .setFriction(0.2)
        .setCollisionGroups(Vehicle.chassisGroups()),
      this.body,
    )
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.8, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x35c2ff, roughness: 0.4 }),
    )
    mesh.castShadow = true
    this.object.add(mesh)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0xffd23f }))
    nose.position.set(0, 0.3, -1.6)
    this.object.add(nose)
  }

  protected applyForces(_dt: number): void {
    const q = this.body.rotation()
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
    this.body.addForce({ x: forward.x * this.input.y * 600, y: 0, z: forward.z * this.input.y * 600 }, true)
    this.body.addTorque({ x: 0, y: -this.input.x * 250, z: 0 }, true)
    this.body.setAngularDamping(3)
    this.body.setLinearDamping(this.input.brakes ? 3 : 0.3)
  }
}
