import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { GameJet } from './jetgen/GameJet'

export const jetHoverDrag = defineParam({id:'jet.hoverDrag',label:'Hover drag',group:'Jet',scope:'world',default:.01,min:.005,max:.015,step:.0001})
export const jetDrag = defineParam({id:'jet.drag',label:'Flight drag',group:'Jet',scope:'world',default:.0001,min:.00005,max:.00015,step:.00001})
export const jetSteer = defineParam({id:'jet.steer',label:'Steering',group:'Jet',scope:'world',default:20,min:5,max:35,step:1})
export const jetLift = defineParam({id:'jet.lift',label:'Lift',group:'Jet',scope:'world',default:.5,min:.1,max:.9,step:.01})
export const jetStall = defineParam({id:'jet.stall',label:'Stall speed',group:'Jet',scope:'world',default:20,min:1,max:39,step:1})
// Digital keys otherwise demand a near-loop from a half-second tap in the full-size port.
export const jetControlResponse = defineParam({id:'jet.controlResponse',label:'Control response',group:'Jet',scope:'world',default:.3,min:.1,max:1,step:.05})
// Not in Syn3h: its Throttle axis was momentary (VhiclMe.cs 16), so keyboard hover was climb or fall.
// 0 is the original; 1 holds altitude when no throttle key is down. On by default: the owner chose it for the demo.
export const jetHoverHold = defineParam<number>({id:'jet.hoverHold',label:'Hover altitude hold',group:'Jet',scope:'world',default:1,min:0,max:1,step:.05})
// terra.jet.prefab flightThrustFactor=2: full throttle pushes at twice the jet's weight, and
// Syn3h's drag barely opposes it, so speed keeps building. Lower this for a slower jet.
export const jetFlightThrust = defineParam<number>({id:'jet.flightThrust',label:'Flight thrust',group:'Jet',scope:'world',default:2,min:.25,max:3,step:.05})
// How far the main nozzle swivels, as a share of VhiclJet.cs 161-162 (20 degrees of pitch at a
// standstill, easing to 5 at speed). Below stall speed the wings have little authority, so this
// is what steers the jet there. It is separate from jet.controlResponse, which only scales the
// aerodynamic control torques.
export const jetVectorResponse = defineParam<number>({id:'jet.vectorResponse',label:'Thrust vectoring',group:'Jet',scope:'world',default:.3,min:.1,max:1,step:.05})
const clamp = THREE.MathUtils.clamp
const lerp = (a:number,b:number,t:number)=>THREE.MathUtils.lerp(a,b,clamp(t,0,1))
const hullVertices = new Float32Array([-1.086619, -0.316382, -1.978747, 0.0, 0.543169, -2.110775, 0.0, -0.324233, -3.398361, 0.0, 0.482615, 1.50864, -3.851598, 0.125607, 1.143191, 0.0, -0.589476, -2.522558, 0.0, -0.636839, 0.479384, 0.0, -0.166176, 2.98234, -2.551439, 0.855675, 3.431675, 1.086619, -0.316382, -1.978747, 3.851598, 0.125607, 1.143191, 2.551439, 0.855675, 3.431675])
const nozzlePosition = new THREE.Vector3(0,0,2.971839)

/** Syn3h VhiclJet.cs 84-211, terra.jet.prefab and CoreSettings.cs 52-56. */
export class Jet extends Vehicle {
  readonly kind = 'jet' as const
  readonly camOffset = 5
  readonly ridePosition = new THREE.Object3D()
  private readonly model: GameJet
  private gearAmount = 0
  private readonly gearCollider: RAPIER.Collider
  private readonly smoothed = new THREE.Vector4()
  private vectorPitch = 0
  private vectorYaw = 0
  readonly modelReady = Promise.resolve()
  /** Input defaults false, so false means the original startup hover mode. */
  get hoverMode(): boolean {return !this.input.special}
  atmosDensity = 1.225
  stallFactor = 1

  constructor(game:Game,terrain:Terrain,position:THREE.Vector3,heading=0) {
    super(game,terrain,position,heading)
    this.object.add(this.ridePosition)
    // Prefab MeshCollider uses the original convex Collider mesh at Y=-.1.
    const hull=RAPIER.ColliderDesc.convexHull(hullVertices)
    if(!hull) throw new Error('Invalid Syn3h jet collider')
    const collider=this.game.world.createCollider(hull.setMass(200).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.body.recomputeMassPropertiesFromColliders()
    const inertia=new THREE.Vector3().copy(this.body.principalInertia()).multiplyScalar(.75)
    const inertiaFrame=this.body.principalInertiaLocalFrame()
    collider.setDensity(0)
    this.body.setAdditionalMassProperties(200,{x:0,y:0,z:0},inertia,inertiaFrame,true)
    this.body.recomputeMassPropertiesFromColliders()
    // The prefab's landing-gear cube is 3.5 x 1 x 3.5, under the animated gear transform.
    this.gearCollider=this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1.75,.5,1.75).setTranslation(0,-.783,-.3).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.gearCollider.setEnabled(false)
    this.model = new GameJet()
    this.object.add(this.model.object)
    this.ridePosition.position.copy(this.model.near.ridePosition!.position)
    this.object.userData.cockpit = true
    this.model.attach()
    this.applyColors()
  }

  protected applyForces(dt:number):void {
    this.wingsOpen=!this.hoverMode
    // Vhicl.cs 269 smooths all four axes at fixedDeltaTime * 10.
    this.smoothed.lerp(new THREE.Vector4(this.input.x,this.input.y,this.input.z,this.input.w),Math.min(1,dt*10))
    const input=this.smoothed.clone()
    const vector=this.smoothed.clone().multiplyScalar(jetVectorResponse.value)
    // Keep source force equations; scale digital control authority for demo keyboard use.
    if(!this.hoverMode){input.x*=jetControlResponse.value;input.y*=jetControlResponse.value;input.w*=jetControlResponse.value}
    this.gearAmount=clamp(this.gearAmount+(this.hoverMode?dt:-dt),0,1)
    if(this.body.isKinematic()) return
    const q=new THREE.Quaternion().copy(this.body.rotation()), inv=q.clone().invert()
    const velocity=new THREE.Vector3().copy(this.body.linvel()), speed=velocity.length()
    const local=velocity.clone().applyQuaternion(inv), up=new THREE.Vector3(0,1,0).applyQuaternion(q)
    const position=new THREE.Vector3().copy(this.body.translation()), mass=this.body.mass()
    const weight=Math.max(0,-this.game.world.gravity.y)*mass
    const torque=(x:number,y:number,z:number)=>this.body.addTorque(new THREE.Vector3().copy(unityTorque(x,y,z)).applyQuaternion(q),true)
    let drag=0,angularDrag=3
    this.gearCollider.setEnabled(this.gearAmount>0)
    if(this.gearAmount>0){
      this.gearCollider.setShape(new RAPIER.Cuboid(1.75*this.gearAmount,.5*this.gearAmount,1.75))
      this.gearCollider.setTranslationWrtParent({x:0,y:-.083-.7*this.gearAmount,z:-.3})
    }
    if(this.hoverMode){
      this.vectorPitch = this.vectorYaw = 0
      // Not inside a zorb ball: the hold would thrust along the tumbling jet's up axis and carry
      // the ball off sideways or into the air. Manual throttle still works there.
      if(this.input.z===0&&jetHoverHold.value>0&&!this.zorbed){
        // Half throttle balances weight (hoverThrustFactor 2); tilt and vertical speed correct it.
        const hold=clamp(.5/Math.max(.3,up.y)-velocity.y*.15,0,1)
        // Fade the hold out near the ground. A jet resting on its gear (hull about 1.3 m up)
        // must keep its weight, or it is frictionless and slides down any slope.
        const nearGround=clamp((position.y-this.terrain.heightAt(position.x,position.z)-1.6)/1,0,1)
        input.z=lerp(input.z,hold,jetHoverHold.value*nearGround);this.smoothed.z=input.z
      }
      // terra.jet.prefab: hoverThrustFactor=2, hoverSteerFactor=4, hoverAngDrag=2.
      this.body.addForce(up.clone().multiplyScalar(input.z*2*weight),true)
      this.body.addTorque(up.clone().cross(new THREE.Vector3(0,1,0)).multiplyScalar(up.angleTo(new THREE.Vector3(0,1,0))*180/Math.PI*.2*mass),true)
      torque(input.y*mass*4,clamp(input.x+input.w,-1,1)*mass*4,-input.x*mass*4)
      drag=jetHoverDrag.value*speed*(this.input.brakes?7:1)
      angularDrag=this.input.brakes?10:2
    }else{
      // VhiclJet.cs 151-159 preserves the original clamped two-piece atmosphere and stall curves.
      this.atmosDensity=position.y<15240?lerp(1.225,.18756,position.y/15240):lerp(.18756,.017102,position.y/30480)
      const aoa=speed>1e-8?local.y/speed:0
      this.stallFactor=speed<jetStall.value?lerp(1,0,((speed-jetStall.value*.8)/jetStall.value)*10):clamp(Math.abs(aoa)-.65,0,.1)*10
      const thrustPitch=-vector.y*lerp(20,5,speed/(jetStall.value*5))*Math.PI/180
      const thrustYaw=(-vector.x+clamp(-local.x*(vector.w===0?1:.5),-10,10)-vector.w*15)*Math.PI/180
      // Mirror Unity's local quaternion: axial X and Y signs reverse in our frame.
      const thrustRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(-thrustPitch,-thrustYaw,0,'YXZ'))
      const thrust=new THREE.Vector3(0,0,-1).applyQuaternion(thrustRotation).applyQuaternion(q).multiplyScalar((this.input.brakes?0:input.z)*jetFlightThrust.value*weight*.99)
      // The force equations stay original; only the four nozzle petals move visually.
      this.vectorPitch = thrustPitch; this.vectorYaw = -thrustYaw
      const nozzle=nozzlePosition.clone().applyQuaternion(q).add(position)
      this.body.addForceAtPoint(thrust,nozzle,true)
      const authority=lerp(0,1,speed/jetStall.value*.7)*this.atmosDensity*(local.z<0?1:-1)
      torque(input.y*mass*jetSteer.value*.2*authority,0,-input.x*mass*jetSteer.value*.75*authority)
      if(this.stallFactor<1){
        // VhiclJet.cs 180 has an asymmetric negative-AoA clamp; preserve it for the port.
        const coefficient=aoa>0?-Math.min(.3,aoa):Math.max(-.3,-aoa)
        this.body.addForce(up.clone().multiplyScalar(jetLift.value*this.atmosDensity*local.z*local.z*15*coefficient*(1-this.stallFactor)),true)
      }
      if(this.stallFactor>=.5){
        const forward=new THREE.Vector3(0,0,-1).applyQuaternion(q)
        const angle=speed>1e-8?velocity.angleTo(forward)*180/Math.PI:0
        drag=speed*lerp(jetDrag.value,jetDrag.value*5,angle/90)*this.atmosDensity
      }else{
        // VhiclJet.cs 208 is VelocityChange, so it is deliberately not multiplied by dt.
        const dv=new THREE.Vector3(-local.x*3,-local.y*3,-local.z).multiplyScalar(jetDrag.value*this.atmosDensity*(this.input.brakes?5:1)).applyQuaternion(q)
        this.body.applyImpulse(dv.multiplyScalar(mass),true)
      }
    }
    // Syn3h VhiclJet.cs 213-232 comments out the old liquid buoyancy block.
    this.body.setLinvel(new THREE.Vector3().copy(this.body.linvel()).multiplyScalar(Math.max(0,1-drag*dt)),true)
    this.body.setAngvel(new THREE.Vector3().copy(this.body.angvel()).multiplyScalar(Math.max(0,1-angularDrag*dt)),true)
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    this.model.update(this.gearAmount, this.vectorPitch, this.vectorYaw, Math.max(0, this.smoothed.z))
  }
  protected override applyColors():void {
    this.model?.setColors(this.colors.body, this.colors.accent)
  }
  override teleport(position:THREE.Vector3,heading=0):void {super.teleport(position,heading);this.smoothed.set(0,0,0,0)}
  override dispose():void {
    this.model.dispose()
    super.dispose()
  }
}
