import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, GROUP_LIQUID, GROUP_ALL, groups, unityTorque } from '../core/physics'
import { defineParam, worldLavaAltitude } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { VehicleModel } from './skins/VehicleModel'

export const jetHoverDrag = defineParam({id:'jet.hoverDrag',label:'Hover drag',group:'Jet',scope:'world',default:.01,min:.005,max:.015,step:.0001})
export const jetDrag = defineParam({id:'jet.drag',label:'Flight drag',group:'Jet',scope:'world',default:.001,min:.0005,max:.0015,step:.0001})
export const jetSteer = defineParam({id:'jet.steer',label:'Steering',group:'Jet',scope:'world',default:20,min:5,max:35,step:1})
export const jetLift = defineParam({id:'jet.lift',label:'Lift',group:'Jet',scope:'world',default:.5,min:.1,max:.9,step:.01})
export const jetStall = defineParam({id:'jet.stall',label:'Stall speed',group:'Jet',scope:'world',default:20,min:1,max:39,step:1})
const clamp = THREE.MathUtils.clamp
const lerp = (a:number,b:number,t:number)=>THREE.MathUtils.lerp(a,b,clamp(t,0,1))
const floatPoints = [-1,1].flatMap(x=>[-2,0,2].map(z=>new THREE.Vector3(x,-.35,z)))

/** Jet.js 102-204; constants use the readable Jet.prefab overrides, not unused declarations. */
export class Jet extends Vehicle {
  private readonly model: VehicleModel
  private gear?: THREE.Object3D
  private gearAmount = 1
  /** Input defaults false, so false means the original startup hover mode. */
  get hoverMode(): boolean {return !this.input.special}
  atmosDensity = 1.225
  stallFactor = 1

  constructor(game:Game,terrain:Terrain,position:THREE.Vector3,heading=0) {
    super(game,terrain,position,heading)
    // Deterministic simplified fuselage collision, independent of async visual loading.
    this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(.9,.45,3).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(3.7,.12,1.2).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    // Jet.js 98 scales the initial tensor by .75; use the compound hull's box estimate.
    this.body.setAdditionalMassProperties(200,{x:0,y:0,z:0},{x:460.125,y:490.5,z:50.625},{x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
    const fallback=new THREE.Mesh(new THREE.ConeGeometry(1,6,4),new THREE.MeshStandardMaterial({color:0xc8d5df,metalness:.5,roughness:.35}))
    fallback.rotation.x=-Math.PI/2;fallback.castShadow=true;this.object.add(fallback)
    this.model=new VehicleModel(this.object,'/models/jet.glb',scene=>{
      scene.traverse(o=>{if(/collider|simple/i.test(o.name)) o.visible=false})
      // Original cockpit sits on source +Z and the model is offset in its authoring scene.
      scene.rotation.y=Math.PI;scene.position.set(.54015,0,.58475)
      this.gear=scene.getObjectByName('Landing_Gear')
    })
  }

  protected applyForces(dt:number):void {
    if(this.body.isKinematic()) return
    const q=new THREE.Quaternion().copy(this.body.rotation()), inv=q.clone().invert()
    const velocity=new THREE.Vector3().copy(this.body.linvel()), speed=velocity.length()
    const local=velocity.clone().applyQuaternion(inv), up=new THREE.Vector3(0,1,0).applyQuaternion(q)
    const position=new THREE.Vector3().copy(this.body.translation()), mass=this.body.mass()
    const weight=Math.max(0,-this.game.world.gravity.y)*mass
    const torque=(x:number,y:number,z:number)=>this.body.addTorque(new THREE.Vector3().copy(unityTorque(x,y,z)).applyQuaternion(q),true)
    let drag=0,angularDrag=3
    this.gearAmount=clamp(this.gearAmount+(this.hoverMode?dt:-dt),0,1)
    if(this.hoverMode){
      // Serialized hoverThrustFactor=2, hoverSteerFactor=4, hoverAngDrag=1.
      this.body.addForce(up.clone().multiplyScalar(this.input.z*2*weight),true)
      this.body.addTorque(up.clone().cross(new THREE.Vector3(0,1,0)).multiplyScalar(up.angleTo(new THREE.Vector3(0,1,0))*180/Math.PI*.2*mass),true)
      torque(this.input.y*mass*4,clamp(this.input.x+this.input.w,-1,1)*mass*4,-this.input.x*mass*4)
      drag=jetHoverDrag.value*speed*(this.input.brakes?7:1)
      angularDrag=this.input.brakes?5:1
    }else{
      // Jet.js 143-151 preserves the original clamped two-piece atmosphere and stall curves.
      this.atmosDensity=position.y<5000?lerp(1.225,.18756,position.y/5000):lerp(.18756,.017102,position.y/10000)
      const aoa=speed>1e-8?local.y/speed:0
      this.stallFactor=speed<jetStall.value?lerp(1,0,((speed-jetStall.value*.8)/jetStall.value)*10):clamp(Math.abs(aoa)-.65,0,.1)*10
      const thrustPitch=-this.input.y*lerp(20,5,speed/(jetStall.value*5))*Math.PI/180
      const thrustYaw=(-this.input.x+clamp(-local.x*(this.input.w===0?1:.5),-10,10)-this.input.w*15)*Math.PI/180
      // Mirror Unity's local quaternion: axial X and Y signs reverse in our frame.
      const thrustRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(-thrustPitch,-thrustYaw,0,'YXZ'))
      const thrust=new THREE.Vector3(0,0,-1).applyQuaternion(thrustRotation).applyQuaternion(q).multiplyScalar((this.input.brakes?0:this.input.z)*2*weight*.99)
      const nozzle=new THREE.Vector3(0,0,2.5).applyQuaternion(q).add(position)
      this.body.addForceAtPoint(thrust,nozzle,true)
      const authority=lerp(0,1,speed/jetStall.value*.7)*this.atmosDensity*(local.z<0?1:-1)
      torque(this.input.y*mass*jetSteer.value*.2*authority,0,-this.input.x*mass*jetSteer.value*.75*authority)
      if(this.stallFactor<1){
        // Jet.js 170 has an asymmetric negative-AoA clamp; preserve it for the port.
        const coefficient=aoa>0?-Math.min(.3,aoa):Math.max(-.3,-aoa)
        this.body.addForce(up.clone().multiplyScalar(jetLift.value*this.atmosDensity*local.z*local.z*15*coefficient*(1-this.stallFactor)),true)
      }
      if(this.stallFactor>=.5){
        const forward=new THREE.Vector3(0,0,-1).applyQuaternion(q)
        const angle=speed>1e-8?velocity.angleTo(forward)*180/Math.PI:0
        drag=speed*lerp(jetDrag.value,jetDrag.value*5,angle/90)*this.atmosDensity
      }else{
        // Jet.js 187 is VelocityChange, so it is deliberately not multiplied by dt.
        const dv=new THREE.Vector3(-local.x*3,-local.y*3,-local.z).multiplyScalar(jetDrag.value*this.atmosDensity*(this.input.brakes?5:1)).applyQuaternion(q)
        this.body.applyImpulse(dv.multiplyScalar(mass),true)
      }
    }
    // Jet.js 196-204: six equal float samples replace the collider's many vertices.
    for(const localPoint of floatPoints){
      const p=localPoint.clone().applyQuaternion(q).add(position)
      const liquid=this.game.world.castRay(new RAPIER.Ray({x:p.x,y:p.y+200,z:p.z},{x:0,y:-1,z:0}),200,true,undefined,groups(GROUP_ALL,GROUP_LIQUID),undefined,this.body)
      const surface=Math.max(worldLavaAltitude.value,liquid?p.y+200-liquid.timeOfImpact:-Infinity)
      if(p.y>=surface) continue
      const pv=new THREE.Vector3().copy(this.body.velocityAtPoint(p))
      const dv=pv.clone().multiplyScalar(-jetDrag.value*70)
      dv.y+=.1*Math.min(6,3+surface-p.y)*lerp(1.3,5,Math.hypot(pv.x,pv.z)/20)
      this.body.applyImpulseAtPoint(dv.multiplyScalar(mass/floatPoints.length),p,true)
    }
    this.body.setLinvel(new THREE.Vector3().copy(this.body.linvel()).multiplyScalar(Math.max(0,1-drag*dt)),true)
    this.body.setAngvel(new THREE.Vector3().copy(this.body.angvel()).multiplyScalar(Math.max(0,1-angularDrag*dt)),true)
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    if(this.gear){this.gear.visible=this.gearAmount>0;this.gear.scale.x=this.gear.scale.y=Math.max(.001,this.gearAmount)}
  }
  override dispose():void {this.model.dispose();super.dispose()}
}
