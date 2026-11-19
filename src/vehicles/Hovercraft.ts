import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam } from '../../shared/params'
import { defaultPreset, definePresets } from '../../shared/presets'
import { seaLevel } from '../world/seaLevel'
import { Vehicle } from './Vehicle'
import { UnityBody } from './unityBody'
import { GameHover } from './hover/GameHover'
import { LOWWING_SPEC } from './hover/lowwing'

// Settings.js slider defaults. Thrust is the
// exception: Settings.js has 220, raised to 320 with the livelier glide (see below). Set it back
// to 220 together with hover.assist 0 for the source feel.
export const hoverHeight = defineParam({id:'hover.height',label:'Height',group:'Hovercraft',scope:'world',default:15,min:5,max:25,step:.1})
export const hoverForce = defineParam({id:'hover.force',label:'Hover force',group:'Hovercraft',scope:'world',default:100,min:20,max:180,step:1})
export const hoverRepel = defineParam({id:'hover.repel',label:'Repel',group:'Hovercraft',scope:'world',default:2.5,min:.5,max:4.5,step:.1})
export const hoverThrust = defineParam({id:'hover.thrust',label:'Thrust',group:'Hovercraft',scope:'world',default:320,min:20,max:420,step:1})

// Zero restores the source controller. Assistance is a demo adaptation, not recovered Unity code.
export const hoverAssist = defineParam({id:'hover.assist',label:'Glide assistance',group:'Hovercraft',scope:'world',default:1,min:0,max:1,step:1})
export const hoverClearance = defineParam({id:'hover.clearance',label:'Glide clearance',group:'Hovercraft',scope:'world',default:2.5,min:.5,max:10,step:.1})
export const hoverStability = defineParam({id:'hover.stability',label:'Glide stability',group:'Hovercraft',scope:'world',default:8,min:0,max:15,step:.1})
export const hoverBrakeTime = defineParam({id:'hover.brakeTime',label:'Brake time to 90% stop',group:'Hovercraft',scope:'world',default:1.5,min:.3,max:3,step:.1})
// Glide handling, tunable live. Like the rest of the glide this is a demo adaptation, not Unity
// code. The glide first shipped with turn 46, grip .8, drag .12, thrust 220 (Settings.js) and
// brake 1 s; the owner chose the livelier set below on 14 Nov 2026 from harness measurements:
// a 90 degree turn's path settles in 2.2 s instead of 3.8 s, 90% of top speed in 11.5 s not 19 s.
/** Yaw rate the craft settles at with full steering, in degrees per second. */
export const hoverTurnRate = defineParam({id:'hover.turnRate',label:'Glide turn rate (deg/s)',group:'Hovercraft',scope:'world',default:70,min:20,max:140,step:1})
/** Sideways velocity damping per second: low slides like a puck, high tracks like a car. */
export const hoverGrip = defineParam({id:'hover.grip',label:'Glide sideways grip',group:'Hovercraft',scope:'world',default:1.5,min:0,max:6,step:.1})
/** Horizontal air drag per second. Top speed is thrust / (mass * drag). */
export const hoverDrag = defineParam({id:'hover.drag',label:'Glide air drag',group:'Hovercraft',scope:'world',default:.2,min:.02,max:.6,step:.01})
/** Lean into a turn at full steering, in degrees. */
export const hoverBank = defineParam({id:'hover.bank',label:'Glide bank angle (deg)',group:'Hovercraft',scope:'world',default:12,min:0,max:35,step:1})
/** Handling presets for the Hovercraft's Handling dropdown. Default is the settings above. */
const HOVER_HANDLING = ['hover.assist', 'hover.turnRate', 'hover.grip', 'hover.drag', 'hover.thrust', 'hover.brakeTime']
export const HOVER_PRESETS = definePresets('Hovercraft', [
  defaultPreset(HOVER_HANDLING, 'Default', 'The glide the owner chose on 14 November: lively turns and quick to top speed.'),
  { name: 'Gentle', description: 'The glide as it first shipped: slower turns, more slide, gentler thrust and brakes.', values: { 'hover.assist': 1, 'hover.turnRate': 46, 'hover.grip': 0.8, 'hover.drag': 0.12, 'hover.thrust': 220, 'hover.brakeTime': 1 } },
  { name: 'Raw', description: 'No glide assistance: the original hovercraft controller, floating and drifting on its own.', values: { 'hover.assist': 0, 'hover.turnRate': 70, 'hover.grip': 1.5, 'hover.drag': 0.2, 'hover.thrust': 320, 'hover.brakeTime': 1.5 } },
])

/**
 * The hovercraft's body: one generated design (src/vehicles/hover/lowwing.ts), with its
 * cockpit and three detail levels. Nothing is loaded; the body is built from parameters when
 * the first hovercraft is created and its geometry is shared by the rest. The game ships
 * exactly one design: Lowwing, which the owner approved on 15 Nov 2026 as "good enough to
 * ship" for now.
 */
export const HOVER_DESIGN = LOWWING_SPEC

/** Hull envelope in the craft's frame: x and z start and extent, floor and roof height, in metres. */
interface Envelope {x:number;w:number;y0:number;y1:number;z:number;l:number}

/** The assisted glide keeps every point of the hull envelope at least this far above the surface, in metres. */
const HULL_GUARD=.4

/**
 * A correction deeper than this is not a hull grazing a crest or a wave: the craft is under a
 * liquid (it sank, or a rising sea came over it). The guard then leaves it to buoyancy and
 * its own lift instead of setting it on the surface in one step, which shot a craft on a lava
 * bed 59 m straight up. The owner's rule of 18 November 2026: only physics moves a player
 * for where they drove (AGENTS.md). In metres.
 */
const HULL_GUARD_REACH=1

/** Hovercraft.js 12-61, with world-down probing and Unity's explicit damping rule. */
export class Hovercraft extends Vehicle {
  readonly kind = 'hovercraft' as const
  readonly camOffset = 2
  readonly ridePosition = new THREE.Object3D()
  private readonly study: GameHover
  private readonly envelope: Envelope
  readonly modelReady = Promise.resolve()
  private readonly unity: UnityBody
  private readonly chassis: RAPIER.Collider
  private assisted = -1
  /** Diagnostic count of terrain penetration corrections, independent of the hover force. */
  clearanceCorrections = 0
  private lastDistance = 0
  private targetHeight = 0

  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0) {
    super(game,terrain,position,heading)
    this.object.add(this.ridePosition)
    this.chassis=this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,1.5).setTranslation(0,.4,0).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    // Hovercraft.js 14-18 explicitly overrides collider-derived inertia.
    this.body.setAdditionalMassProperties(50,{x:0,y:-.3,z:0},{x:15,y:15,z:15},{x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
    this.unity=new UnityBody(this.body,game.world,0,4)
    const study=this.study=new GameHover(HOVER_DESIGN)
    this.object.add(study.object);study.attach()
    this.ridePosition.position.copy(study.eye)
    // The driver sits in a real cockpit, so the ride camera hides nothing (PATTERN.md rule 3).
    this.object.userData.cockpit=true
    // The body carries its own lit headlamp bar and tail bars, so the shared effects must not
    // add their white lamp spheres: those sit at points for a generic nose and hung in the air
    // ahead of this one (the owner, 15 Nov 2026: "two balls floating in front of it").
    this.object.userData.ownLamps=true
    // The collision hull and the clearance guard cover the body's whole outline.
    const b=study.bounds
    this.envelope={x:b.min.x,w:b.max.x-b.min.x,y0:Math.max(0,b.min.y),y1:b.max.y,z:b.min.z,l:b.max.z-b.min.z}
    this.configureChassis()
    this.applyColors()
  }

  protected applyForces(dt: number): void {
    if (this.body.isKinematic()) return
    this.configureChassis();this.unity.begin()
    // Inside a zorb ball the craft rides passively. Its glide support, grip, drag and levelling
    // damp the ball to a third of its speed, and the legacy 15 m hover would float the ball.
    if(this.zorbed){this.wheelsGrounded=0;return}
    if(hoverAssist.value){this.applyGlide(dt);return}
    const q = new THREE.Quaternion().copy(this.body.rotation()), inv = q.clone().invert()
    const velocity = new THREE.Vector3().copy(this.body.linvel()), speed = velocity.length()
    const local = velocity.clone().applyQuaternion(inv)
    const up = new THREE.Vector3(0,1,0).applyQuaternion(q)
    let drag = 0, angularDrag = 4
    if (!this.input.brakes) this.unity.addForce(new THREE.Vector3(-local.x*10,0,-Math.max(0,this.input.y)*hoverThrust.value).applyQuaternion(q))
    else {drag = speed > 5 ? 1.5 : 100; angularDrag = 20}
    const position = this.body.translation()
    const cast = (direction: THREE.Vector3, distance: number) => this.game.world.castRayAndGetNormal(new RAPIER.Ray(position,direction),distance,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
    const hit = cast(new THREE.Vector3(0,-1,0),30)
    let distance = hit?.timeOfImpact ?? Infinity
    let normal = hit ? new THREE.Vector3().copy(hit.normal) : new THREE.Vector3(0,1,0)
    // Hovercraft.js 34-38 treats the nearest liquid plane as supporting terrain.
    const liquidDistance = Math.max(0,position.y-(this.terrain.liquidHeightAt?.(position.x,position.z)??seaLevel()))
    if (liquidDistance < 30 && liquidDistance < distance) {distance = liquidDistance; normal.set(0,1,0)}
    if (distance <= 30) {
      // Hovercraft.js 40-43: duck toward five metres under an overhang.
      if (cast(new THREE.Vector3(0,1,0),5)) this.targetHeight = Math.max(5,this.targetHeight-dt*3)
      else this.targetHeight = Math.min(hoverHeight.value,this.targetHeight+dt*3)
      if (distance < this.targetHeight) {
        this.unity.addForce(up.clone().multiplyScalar((this.targetHeight-distance)*hoverForce.value))
        if (this.lastDistance > distance) this.unity.setVelocity(this.unity.velocity.addScaledVector(normal,Math.min((this.lastDistance-distance)*hoverRepel.value,10)))
      }
      const angle = up.angleTo(normal)*180/Math.PI
      this.unity.addTorque(up.clone().cross(normal).multiplyScalar(angle*.2*(40-Math.min(40,distance))))
      this.lastDistance = distance
    } else angularDrag = .5
    const roll = new THREE.Euler().setFromQuaternion(q,'YXZ').z*180/Math.PI
    const bank = this.input.x > 0 ? (roll < 40 ? this.input.x : 0) : (roll > -40 ? this.input.x : 0)
    this.unity.addTorque(new THREE.Vector3().copy(unityTorque(this.input.y*30,this.input.x*100,-bank*200)).applyQuaternion(q))
    // Hovercraft.js 22-30: PhysX damps after force integration, including gravity.
    this.unity.drag=drag;this.unity.angularDrag=angularDrag;this.unity.flush(dt)
  }

  private configureChassis():void {
    const mode=Number(hoverAssist.value>0);if(mode===this.assisted)return
    this.assisted=mode
    // The original prefab cuboid 2x1x3 would leave the spoiler and nose outside collision, so
    // the assisted glide collides with the body's whole envelope.
    const e=this.envelope
    this.chassis.setShape(mode?new RAPIER.Cuboid(e.w/2,(e.y1-e.y0)/2,e.l/2):new RAPIER.Cuboid(1,.5,1.5))
    this.chassis.setTranslationWrtParent(mode?{x:e.x+e.w/2,y:(e.y0+e.y1)/2,z:e.z+e.l/2}:{x:0,y:.4,z:0})
    this.chassis.setFriction(mode?.1:.5)
    // Mass, centre and inertia stay those of the original hull, so the generated body drives
    // exactly as the original did and only what it touches differs.
    this.body.setAdditionalMassProperties(50,{x:0,y:mode?.25:-.3,z:mode?-.06:0},
      mode?{x:50*(1.03**2+3.18**2)/12,y:50*(2.54**2+3.18**2)/12,z:50*(2.54**2+1.03**2)/12}:{x:15,y:15,z:15},
      {x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
  }

  private surface(x:number,z:number):number {
    return Math.max(this.terrain.heightAt(x,z),this.terrain.liquidHeightAt?.(x,z)??-Infinity)
  }

  // Scratch vectors: the glide and its clearance guard run for every hovercraft on every
  // physics step and render frame, so they allocate nothing.
  private readonly gForward=new THREE.Vector3()
  private readonly gRight=new THREE.Vector3()
  private readonly gPoints=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()]
  private readonly gHeights=[0,0,0,0]
  private readonly gA=new THREE.Vector3()
  private readonly gB=new THREE.Vector3()
  private readonly gUp=new THREE.Vector3()
  private readonly gW=new THREE.Vector3()
  private readonly gP=new THREE.Vector3()
  private readonly gQ=new THREE.Quaternion()

  private applyGlide(dt:number):void {
    const u=this.unity,q=u.q,p=u.pos,v=u.velocity,mass=this.body.mass()
    const forward=this.gForward.set(0,0,-1).applyQuaternion(q);forward.y=0;forward.normalize()
    const right=this.gRight.set(1,0,0).applyQuaternion(q);right.y=0;right.normalize()
    // Four footprint samples anticipate slopes instead of letting a centre ray miss the nose.
    const points=this.gPoints,heights=this.gHeights
    let distance=0
    for(let i=0;i<4;i++){
      const a=points[i].set(i&1?1:-1,0,i<2?-1.3:1.3).applyQuaternion(q).add(p)
      heights[i]=this.surface(a.x,a.z)
      distance=distance+a.y-heights[i]
    }
    distance/=4
    const under=distance<30
    this.wheelsGrounded=under?4:0
    const target=hoverClearance.value
    if(under){
      // Critically damped support in world-up avoids converting lift into runaway thrust.
      const spring=12,damping=2*Math.sqrt(spring)
      const forwardSlope=((heights[0]+heights[1])-(heights[2]+heights[3]))/5.2
      const rightSlope=((heights[1]+heights[3])-(heights[0]+heights[2]))/4
      const surfaceVelocity=THREE.MathUtils.clamp(forwardSlope*v.dot(forward)+rightSlope*v.dot(right),-12,12)
      // Damp relative to the rising ground, so a sustained climb does not consume hover clearance.
      const accel=Math.max(0,Math.min(45,-this.game.world.gravity.y+(target-distance)*spring-(v.y-surfaceVelocity)*damping))
      u.addForce(this.gA.set(0,accel*mass,0))
    }
    const horizontal=this.gB.set(v.x,0,v.z)
    if(this.input.brakes){
      // Exponential braking: 90% speed loss in the selected time, without arresting gravity.
      const decay=Math.exp(-Math.LN10*dt/hoverBrakeTime.value)
      u.setVelocity(this.gA.set(v.x*decay,v.y,v.z*decay))
    }else{
      u.addForce(this.gA.copy(forward).multiplyScalar(Math.max(0,this.input.y)*hoverThrust.value))
      u.addForce(this.gA.copy(right).multiplyScalar(-horizontal.dot(right)*mass*hoverGrip.value))
      u.addForce(horizontal.multiplyScalar(-mass*hoverDrag.value))
    }
    // Follow gentle terrain pitch and bank into a turn (12 degrees by default), even over a jump.
    const pitch=under?THREE.MathUtils.clamp(((heights[2]+heights[3])-(heights[0]+heights[1]))/5.2,-.3,.3):0
    const desiredUp=this.gB.set(0,1,0).addScaledVector(forward,pitch).addScaledVector(right,this.input.x*Math.tan(hoverBank.value*Math.PI/180)).normalize()
    const up=this.gUp.set(0,1,0).applyQuaternion(q),w=this.gW.copy(this.body.angvel())
    const error=this.gA.copy(up).cross(desiredUp)
    // The antiparallel case has no cross product; choose a deterministic recovery axis.
    if(up.dot(desiredUp)<-.95)error.copy(right)
    const strength=hoverStability.value
    const acceleration=error.multiplyScalar(strength*2).add(this.gB.set(-w.x*strength*.7,0,-w.z*strength*.7))
    acceleration.y=(-this.input.x*hoverTurnRate.value*Math.PI/180-w.y)*4
    u.addTorqueAcceleration(acceleration,dt)
    u.drag=0;u.angularDrag=0;u.flush(dt)
  }

  /**
   * Conservative hull-envelope check also covers narrow terrain crests between the hover rays.
   *
   * The full check samples the surface under 9 x 13 points on the hull's floor and roof: 234
   * lookups, twice per frame, for every hovercraft. Measured on generated terrain that was
   * 473 lookups and about 230 microseconds per step per craft (tests/vehicles2/hover-cost).
   * The terrain is linear across 4 m cells, so a quarter of the floor points (every second
   * one each way, 0.64 m by 0.53 m apart) already bounds it closely: between two of them the
   * ground cannot rise 0.5 m unless it is steeper than 57 degrees on both sides of a crest
   * narrower than the gap. So when that coarse pass clears the 0.4 m guard by half a metre
   * the full pass is skipped. The roof joins the coarse pass once the craft tilts past about
   * 25 degrees. Anything closer falls through to the original full check, unchanged, so a
   * correction is computed from exactly the same samples as before.
   */
  private hullClearance(p:THREE.Vector3Like,q:THREE.QuaternionLike):number {
    const point=this.gP,e=this.envelope
    // World-up component of the craft's own up axis.
    const roof=1-2*(q.x*q.x+q.z*q.z)<.9
    let clearance=Infinity
    for(let ix=0;ix<=8;ix+=2)for(let iz=0;iz<=12;iz+=2)for(let layer=0;layer<(roof?2:1);layer++){
      point.set(e.x+e.w*ix/8,layer?e.y1:e.y0,e.z+e.l*iz/12).applyQuaternion(q).add(p)
      clearance=Math.min(clearance,point.y-this.surface(point.x,point.z))
    }
    if(clearance>=HULL_GUARD+.5)return clearance
    clearance=Infinity
    for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=12;iz++)for(let layer=0;layer<2;layer++){
      point.set(e.x+e.w*ix/8,layer?e.y1:e.y0,e.z+e.l*iz/12).applyQuaternion(q).add(p)
      clearance=Math.min(clearance,point.y-this.surface(point.x,point.z))
    }
    return clearance
  }
  override postPhysics(dt:number):void {
    if(hoverAssist.value&&!this.body.isKinematic()&&!this.zorbed){
      const p=this.gA.copy(this.body.translation()),q=this.gQ.copy(this.body.rotation())
      const clearance=this.hullClearance(p,q)
      if(clearance<HULL_GUARD&&HULL_GUARD-clearance<=HULL_GUARD_REACH){
        p.y+=HULL_GUARD-clearance;this.body.setTranslation(p,true);this.clearanceCorrections++
        const v=this.body.linvel();if(v.y<0)this.body.setLinvel({x:v.x,y:0,z:v.z},true)
      }
    }
    super.postPhysics(dt)
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    const rest=this.zorbed
    this.study.update(rest?0:this.input.x,rest?0:Math.max(0,this.input.y),!rest&&this.input.brakes,!rest,dt)
    // Interpolating two valid poses can cut through a sharp crest; keep the rendered hull clear too.
    if(hoverAssist.value){const c=this.hullClearance(this.object.position,this.object.quaternion);if(c<HULL_GUARD&&HULL_GUARD-c<=HULL_GUARD_REACH)this.object.position.y+=HULL_GUARD-c}
  }

  protected override applyColors():void {
    // The base constructor tints before the body exists.
    this.study?.setColors(this.colors.body,this.colors.accent)
  }
  override teleport(position: THREE.Vector3, heading = 0): void {
    super.teleport(position,heading); this.lastDistance = 0; this.targetHeight = 0
  }
  override dispose(): void {
    this.study.dispose()
    super.dispose()
  }
}
