import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam, worldLavaAltitude } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { UnityBody } from './unityBody'
import { VehicleModel } from './skins/VehicleModel'

// Settings.js slider defaults, documented in docs/architecture/mars-explorer.md.
export const hoverHeight = defineParam({id:'hover.height',label:'Height',group:'Hovercraft',scope:'world',default:15,min:5,max:25,step:.1})
export const hoverForce = defineParam({id:'hover.force',label:'Hover force',group:'Hovercraft',scope:'world',default:100,min:20,max:180,step:1})
export const hoverRepel = defineParam({id:'hover.repel',label:'Repel',group:'Hovercraft',scope:'world',default:2.5,min:.5,max:4.5,step:.1})
export const hoverThrust = defineParam({id:'hover.thrust',label:'Thrust',group:'Hovercraft',scope:'world',default:220,min:20,max:420,step:1})

// Zero restores the source controller. Assistance is a demo adaptation, not recovered Unity code.
export const hoverAssist = defineParam({id:'hover.assist',label:'Glide assistance',group:'Hovercraft',scope:'world',default:1,min:0,max:1,step:1})
export const hoverClearance = defineParam({id:'hover.clearance',label:'Glide clearance',group:'Hovercraft',scope:'world',default:2.5,min:.5,max:10,step:.1})
export const hoverStability = defineParam({id:'hover.stability',label:'Glide stability',group:'Hovercraft',scope:'world',default:8,min:0,max:15,step:.1})
export const hoverBrakeTime = defineParam({id:'hover.brakeTime',label:'Brake time to 90% stop',group:'Hovercraft',scope:'world',default:1,min:.3,max:3,step:.1})

/** Hovercraft.js 12-61, with world-down probing and Unity's explicit damping rule. */
export class Hovercraft extends Vehicle {
  readonly kind = 'hovercraft' as const
  readonly camOffset = 2
  readonly ridePosition = new THREE.Object3D()
  private paint?: THREE.MeshPhysicalMaterial
  private accent?: THREE.MeshStandardMaterial
  private glowMaterial?: THREE.MeshBasicMaterial
  private readonly model: VehicleModel
  get modelReady(): Promise<void> {return this.model.ready}
  private readonly textures: THREE.Texture[] = []
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
      // Syn3h Hovercraft.prefab LOD0: chrome spoilers, purple cockpit and textured paint.
      const paint=new THREE.MeshPhysicalMaterial({color:0x315d99,metalness:.85,roughness:.2,clearcoat:1,clearcoatRoughness:.15})
      const chrome=new THREE.MeshPhysicalMaterial({color:0xcccccc,metalness:1,roughness:.178})
      const glass=new THREE.MeshPhysicalMaterial({color:0x892ba7,metalness:.35,roughness:.12,clearcoat:1,iridescence:.3})
      const accent=new THREE.MeshStandardMaterial({color:0x515151,metalness:0,roughness:.48})
      this.paint=paint;this.accent=accent
      this.visualMaterials.push(paint,chrome,glass,accent)
      const texture=new THREE.TextureLoader().load('/models/textures/armor-scales.jpg')
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(15,15)
      paint.bumpMap=texture;paint.bumpScale=.008;this.textures.push(texture)
      scene.traverse(o=>{if(o instanceof THREE.Mesh){
        (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())
        o.material=o.name==='Cockpit'?glass:/Chrome|Spoilers/.test(o.name)?chrome:o.name==='Accent'?accent:paint
      }})
      // Prefab rear glow at (0,.692654,-1.218035), reflected into our frame.
      const glowMap=new THREE.TextureLoader().load('/models/textures/thruster-glow.png');this.textures.push(glowMap)
      const glowMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(3,2,4),map:glowMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide})
      this.glowMaterial=glowMaterial;this.applyColors()
      this.visualMaterials.push(glowMaterial)
      const glow=new THREE.Mesh(new THREE.PlaneGeometry(.5,.5),glowMaterial)
      glow.position.set(0,.692654,1.218035);scene.add(glow)
    })
  }

  protected applyForces(dt: number): void {
    if (this.body.isKinematic()) return
    this.configureChassis();this.unity.begin()
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

  private applyGlide(dt:number):void {
    const u=this.unity,q=u.q,p=u.pos,v=u.velocity,mass=this.body.mass()
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(q);forward.y=0;forward.normalize()
    const right=new THREE.Vector3(1,0,0).applyQuaternion(q);right.y=0;right.normalize()
    // Four footprint samples anticipate slopes instead of letting a centre ray miss the nose.
    const points=[[-1,-1.3],[1,-1.3],[-1,1.3],[1,1.3]].map(([x,z])=>new THREE.Vector3(x,0,z).applyQuaternion(q).add(p))
    const heights=points.map(a=>this.surface(a.x,a.z))
    const distance=points.reduce((sum,a,i)=>sum+a.y-heights[i],0)/4
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
      u.addForce(new THREE.Vector3(0,accel*mass,0))
    }
    const horizontal=new THREE.Vector3(v.x,0,v.z)
    if(this.input.brakes){
      // Exponential braking: 90% speed loss in the selected time, without arresting gravity.
      const decay=Math.exp(-Math.LN10*dt/hoverBrakeTime.value)
      u.setVelocity(new THREE.Vector3(v.x*decay,v.y,v.z*decay))
    }else{
      u.addForce(forward.clone().multiplyScalar(Math.max(0,this.input.y)*hoverThrust.value))
      u.addForce(right.clone().multiplyScalar(-horizontal.dot(right)*mass*.8))
      u.addForce(horizontal.multiplyScalar(-mass*.12))
    }
    // Follow gentle terrain pitch and bank at most 12 degrees into a turn, even over a jump.
    const pitch=under?THREE.MathUtils.clamp(((heights[2]+heights[3])-(heights[0]+heights[1]))/5.2,-.3,.3):0
    const desiredUp=new THREE.Vector3(0,1,0).addScaledVector(forward,pitch).addScaledVector(right,this.input.x*.21).normalize()
    const up=new THREE.Vector3(0,1,0).applyQuaternion(q),w=new THREE.Vector3().copy(this.body.angvel())
    const error=up.clone().cross(desiredUp)
    // The antiparallel case has no cross product; choose a deterministic recovery axis.
    if(up.dot(desiredUp)<-.95)error.copy(right)
    const strength=hoverStability.value
    const acceleration=error.multiplyScalar(strength*2).add(new THREE.Vector3(-w.x*strength*.7,0,-w.z*strength*.7))
    acceleration.y=(-this.input.x*.8-w.y)*4
    u.addTorqueAcceleration(acceleration,dt)
    u.drag=0;u.angularDrag=0;u.flush(dt)
  }

  /** Conservative hull-envelope check also covers narrow terrain crests between the hover rays. */
  private hullClearance(p:THREE.Vector3,q:THREE.Quaternion):number {
    let clearance=Infinity
    const point=new THREE.Vector3()
    for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=12;iz++)for(const y of [0,1.03]){
      point.set(-1.27+2.54*ix/8,y,-1.65+3.18*iz/12).applyQuaternion(q).add(p)
      clearance=Math.min(clearance,point.y-this.surface(point.x,point.z))
    }
    return clearance
  }
  override postPhysics(dt:number):void {
    if(hoverAssist.value&&!this.body.isKinematic()){
      const p=new THREE.Vector3().copy(this.body.translation()),q=new THREE.Quaternion().copy(this.body.rotation())
      const clearance=this.hullClearance(p,q)
      if(clearance<.4){
        p.y+=.4-clearance;this.body.setTranslation(p,true);this.clearanceCorrections++
        const v=this.body.linvel();if(v.y<0)this.body.setLinvel({x:v.x,y:0,z:v.z},true)
      }
    }
    super.postPhysics(dt)
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    // Interpolating two valid poses can cut through a sharp crest; keep the rendered hull clear too.
    if(hoverAssist.value){const c=this.hullClearance(this.object.position,this.object.quaternion);if(c<.4)this.object.position.y+=.4-c}
  }

  protected override applyColors():void {
    this.paint?.color.set(this.colors.body);this.accent?.color.set(this.colors.accent)
    this.glowMaterial?.color.set(this.colors.accent).multiplyScalar(3)
  }
  override teleport(position: THREE.Vector3, heading = 0): void {
    super.teleport(position,heading); this.lastDistance = 0; this.targetHeight = 0
  }
  override dispose(): void {
    this.model.dispose();this.textures.forEach(t=>t.dispose());this.visualMaterials.forEach(m=>m.dispose())
    super.dispose()
  }
}
