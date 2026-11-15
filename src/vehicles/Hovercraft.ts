import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam, worldLavaAltitude } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { UnityBody } from './unityBody'
import { VehicleModel } from './skins/VehicleModel'
import { setRole } from './skins/showroom'

// Settings.js slider defaults, documented in docs/architecture/mars-explorer.md. Thrust is the
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

/** The assisted glide keeps every point of the hull envelope at least this far above the surface, in metres. */
const HULL_GUARD=.4

/** Hovercraft.js 12-61, with world-down probing and Unity's explicit damping rule. */
export class Hovercraft extends Vehicle {
  readonly kind = 'hovercraft' as const
  readonly camOffset = 2
  readonly ridePosition = new THREE.Object3D()
  private paint?: THREE.MeshStandardMaterial
  private accent?: THREE.MeshStandardMaterial
  private glowMaterial?: THREE.MeshStandardMaterial
  private readonly model: VehicleModel
  get modelReady(): Promise<void> {return this.model.ready}
  private readonly visualMaterials: THREE.Material[] = []
  private readonly unity: UnityBody
  private readonly chassis: RAPIER.Collider
  private assisted = -1
  /** Diagnostic count of terrain penetration corrections, independent of the hover force. */
  clearanceCorrections = 0
  private lastDistance = 0
  private targetHeight = 0
  private readonly material = new THREE.MeshStandardMaterial({color:0xd2a142,roughness:.45,metalness:.35})
  private readonly geometry = new THREE.CylinderGeometry(1.5,1.8,.6,8)

  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0) {
    super(game,terrain,position,heading)
    // Hovercraft.prefab RideCamera local transform.
    this.ridePosition.position.set(.000051,.56284,-.497794);this.object.add(this.ridePosition)
    this.chassis=this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,1.5).setTranslation(0,.4,0).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    // Hovercraft.js 14-18 explicitly overrides collider-derived inertia.
    this.body.setAdditionalMassProperties(50,{x:0,y:-.3,z:0},{x:15,y:15,z:15},{x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
    this.unity=new UnityBody(this.body,game.world,0,4)
    this.configureChassis()
    const hull = new THREE.Mesh(this.geometry,this.material)
    hull.scale.z = 1.35; hull.castShadow = hull.receiveShadow = true
    this.object.add(hull)
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(.8,.4,1.2),new THREE.MeshStandardMaterial({color:0x203745,metalness:.5,roughness:.2}))
    cockpit.position.set(0,.4,-.3); cockpit.castShadow = true; this.object.add(cockpit)
    const modelRoot=new THREE.Group();modelRoot.add(hull,cockpit);this.object.add(modelRoot)
    this.model = new VehicleModel(modelRoot,'/models/hovercraft.glb',scene=>{
      // Keep the prefab silhouette; shared roles supply procedural paint and live colours.
      const paint=setRole(new THREE.MeshStandardMaterial({color:0x315d99,metalness:.85,roughness:.2}), 'paint')
      const chrome=setRole(new THREE.MeshStandardMaterial({color:0xcccccc,metalness:1,roughness:.178}), 'chrome')
      const glass=setRole(new THREE.MeshStandardMaterial({color:0x892ba7,metalness:.35,roughness:.12}), 'glass')
      const accent=setRole(new THREE.MeshStandardMaterial({color:0x515151,metalness:0,roughness:.48}), 'accent')
      // Keep the cockpit separate so higher tiers can render transparent glass.
      glass.userData.separate=true
      this.paint=paint;this.accent=accent
      this.visualMaterials.push(paint,chrome,glass,accent)
      scene.traverse(o=>{if(o instanceof THREE.Mesh){
        (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())
        o.material=o.name==='Cockpit'?glass:/Chrome|Spoilers/.test(o.name)?chrome:o.name==='Accent'?accent:paint
      }})
      // Prefab rear glow at (0,.692654,-1.218035), reflected into our frame.
      // The shared glow role supplies procedural light; emissive also lights the base tier.
      const glowMaterial=setRole(new THREE.MeshStandardMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,emissive:0xffffff,emissiveIntensity:3}), 'glow')
      this.glowMaterial=glowMaterial;this.applyColors()
      this.visualMaterials.push(glowMaterial)
      const glow=new THREE.Mesh(new THREE.CircleGeometry(.25,24),glowMaterial)
      glow.position.set(0,.692654,1.218035);scene.add(glow)
    })
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
    const liquidDistance = Math.max(0,position.y-(this.terrain.liquidHeightAt?.(position.x,position.z)??worldLavaAltitude.value))
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
    // Syn3h GLB bounds x +/-1.2593, y .0167..1.0196, z -1.6346..1.5155.
    // Original prefab cuboid 2x1x3 leaves the spoilers and nose outside collision.
    this.chassis.setShape(new RAPIER.Cuboid(mode?1.27:1,mode?.515:.5,mode?1.59:1.5))
    this.chassis.setTranslationWrtParent({x:0,y:mode?.515:.4,z:mode?-.06:0})
    this.chassis.setFriction(mode?.1:.5)
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
    const point=this.gP
    // World-up component of the craft's own up axis.
    const roof=1-2*(q.x*q.x+q.z*q.z)<.9
    let clearance=Infinity
    for(let ix=0;ix<=8;ix+=2)for(let iz=0;iz<=12;iz+=2)for(let layer=0;layer<(roof?2:1);layer++){
      point.set(-1.27+2.54*ix/8,layer?1.03:0,-1.65+3.18*iz/12).applyQuaternion(q).add(p)
      clearance=Math.min(clearance,point.y-this.surface(point.x,point.z))
    }
    if(clearance>=HULL_GUARD+.5)return clearance
    clearance=Infinity
    for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=12;iz++)for(const y of [0,1.03]){
      point.set(-1.27+2.54*ix/8,y,-1.65+3.18*iz/12).applyQuaternion(q).add(p)
      clearance=Math.min(clearance,point.y-this.surface(point.x,point.z))
    }
    return clearance
  }
  override postPhysics(dt:number):void {
    if(hoverAssist.value&&!this.body.isKinematic()&&!this.zorbed){
      const p=this.gA.copy(this.body.translation()),q=this.gQ.copy(this.body.rotation())
      const clearance=this.hullClearance(p,q)
      if(clearance<HULL_GUARD){
        p.y+=HULL_GUARD-clearance;this.body.setTranslation(p,true);this.clearanceCorrections++
        const v=this.body.linvel();if(v.y<0)this.body.setLinvel({x:v.x,y:0,z:v.z},true)
      }
    }
    super.postPhysics(dt)
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    // Interpolating two valid poses can cut through a sharp crest; keep the rendered hull clear too.
    if(hoverAssist.value){const c=this.hullClearance(this.object.position,this.object.quaternion);if(c<HULL_GUARD)this.object.position.y+=HULL_GUARD-c}
  }

  protected override applyColors():void {
    this.paint?.color.set(this.colors.body);this.accent?.color.set(this.colors.accent)
    this.glowMaterial?.color.set(this.colors.accent)
    this.glowMaterial?.emissive.set(this.colors.accent)
  }
  override teleport(position: THREE.Vector3, heading = 0): void {
    super.teleport(position,heading); this.lastDistance = 0; this.targetHeight = 0
  }
  override dispose(): void {
    this.model.dispose();this.visualMaterials.forEach(m=>m.dispose())
    super.dispose()
  }
}
