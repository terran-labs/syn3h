/** Indestructible vehicles: viscous lava, cooling paint and legacy water buoyancy. */
import * as THREE from 'three/webgpu'
import { applyWaterForces, waterSinking, hasWaterContact, planingShare, waterProfiles } from './buoyancy'
import { defineParam } from '../../shared/params'
import type { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { type UnityBody, signedAngle, unityEulerAngles } from './unityBody'

export const buggyLavaFloat = defineParam({
  id: 'buggy.lavaFloat', label: 'Float on water', group: 'Buggy', scope: 'world',
  default: true,
})

const tmpP = new THREE.Vector3()
const tmpF = new THREE.Vector3()
const tmpE = new THREE.Vector3()

export interface LavaInput {
  x: number
  y: number
  wingsOpen: boolean
}

/**
 * Apply floating or diving forces. Returns true when the vehicle is in the liquid, in which case
 * the original also set angular drag 2 (done here).
 */
export function applyLava(
  ub: UnityBody,
  points: readonly THREE.Vector3[],
  liquidAt: (x: number, z: number) => number,
  input: LavaInput,
): boolean {
  const terrain=liquidTerrains.get(ub.body)
  if (terrain && liquidKind(terrain,ub.pos.x,ub.pos.z)!=='water') return false
  // The shared hydrodynamic pass owns forces, but controllers still need contact for motor drag.
  if (waterSinking.value) return terrain ? hasWaterContact(ub.body, terrain) : false
  if (!buggyLavaFloat.value) return false
  // Wings open in water: the shared pass pushes along the nose (applyVehicleLiquid). A fast
  // winged touch keeps the skim support that preserves cruise speed (commit c28eafb).
  const state=liquidStates.get(ub.body)
  const wet=Number.isFinite(liquidAt(ub.pos.x,ub.pos.z))&&ub.pos.y<liquidAt(ub.pos.x,ub.pos.z)+.25
  if(input.wingsOpen&&liquidWingLift.value>0&&wet&&state&&(state.fastWingContact||(!state.wasImmersed&&state.entrySpeed>=8))){
    const velocity=ub.body.linvel(),depth=Math.max(0,liquidAt(ub.pos.x,ub.pos.z)-ub.pos.y)
    ub.addForce(tmpF.set(0,ub.body.mass()*(-ub.world.gravity.y+Math.max(0,-velocity.y)*8+depth*20),0))
    return true
  }
  const b = ub.body
  const pos = ub.pos
  const h = liquidAt(pos.x, pos.z)
  if (!Number.isFinite(h)) return false
  const mass = b.mass()
  const g = -ub.world.gravity.y
  const weight = mass * g

  // Floating, Buggy.js 436-469.
  if (pos.y < h + 0.1 && pos.y - h > -3) {
    // The original's `hit.distance` here is from a ray cast 3 m above the body down to the surface.
    const hitDistance = pos.y + 3 - h
    // The original pushed straight up (400) with wings open; wings now push along the nose.
    const e = unityEulerAngles(ub.q, tmpE)
    const roll = signedAngle(e.z)
    const pitch = signedAngle(e.x)
    ub.angularDrag = 2

    const n = points.length
    for (const local of points) {
      tmpP.copy(local).applyQuaternion(ub.q).add(pos)
      const depth = liquidAt(tmpP.x, tmpP.z) - tmpP.y
      if (depth <= 0) continue
      const v = b.velocityAtPoint(tmpP)
      const speed = Math.hypot(v.x, v.y, v.z)
      // Static lift by depth (changed), skip force by speed (original), drag (original).
      const lift = (weight * 1.6 * Math.min(1, depth / 0.5)) / n
      const skip = (1.8 * speed * (speed > 15 ? 100 : 15)) / n
      tmpF.set(-v.x * 200 / n, lift + skip - (v.y * 200) / n, -v.z * 200 / n)
      ub.addForceAtPosition(tmpF, tmpP)
    }
    if (input.y >= 0) {
      ub.addRelativeTorque(
        -input.y * 500 * ((70 - Math.min(70, Math.max(1, -pitch))) / 70),
        input.y * input.x * 300,
        roll * -3 + input.y * input.x * -50,
      )
    }
    if (!input.wingsOpen && hitDistance < 3) ub.addRelativeForce(0, 0, input.y * 1200)
    return true
  }

  // Diving, Buggy.js 472-475: the original's upward push (200, or 400 with wings) was below the
  // buggy's weight; 1.5 times the weight brings it back up to the float band.
  if (pos.y < h) {
    const v = b.linvel()
    ub.addForce(tmpF.set(-v.x * 8, -v.y * 8 + weight * (input.wingsOpen ? 2 : 1.5), -v.z * 8))
    ub.angularDrag = 2
    return true
  }
  return false
}

/**
 * Float points: Mars Explorer's twelve (Buggy.prefab "Floats", scale 0.25), stretched to a
 * body footprint. Our frame: -Z forward.
 */
export function floatPoints(halfWidth: number, halfLength: number, yLow: number, yHigh: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(new THREE.Vector3(sx * halfWidth * 0.5, yLow, sz * halfLength * 0.875))
    pts.push(new THREE.Vector3(sx * halfWidth * 0.5, yHigh, sz * halfLength * 0.875))
    pts.push(new THREE.Vector3(sx * halfWidth, yLow - 0.2, sz * halfLength))
  }
  return pts
}


/**
 * Wings in liquid. Holding the wings open in water or lava pushes the vehicle along its nose
 * and adds a share of wing lift that grows with forward speed. Nothing pushes straight up:
 * a level vehicle surges forward, a nose-up one climbs out. Both buggies only (the others
 * have no wings); remote vehicles and bots run the same pass in Vehicle.fixedUpdate.
 */
export const liquidWingLift=defineParam({id:'liquid.wingLift',label:'Wing push in liquid (m/s²)',group:'Liquid',scope:'world',default:18,min:0,max:40,step:1})
export const liquidWingPushSpeed=defineParam({id:'liquid.wingPushSpeed',label:'Wing push fades out by (m/s)',group:'Liquid',scope:'world',default:12,min:2,max:40,step:1})
export const liquidWingEffect=defineParam({id:'liquid.wingEffect',label:'Wing lift in liquid (share of weight)',group:'Liquid',scope:'world',default:.6,min:0,max:1.5,step:.05})
export const liquidWingPitchRate=defineParam({id:'liquid.wingPitchRate',label:'Wing pitch rate in liquid (rad/s)',group:'Liquid',scope:'world',default:1,min:0,max:4,step:.1})
export const lavaWingPush=defineParam({id:'lava.wingPush',label:'Wing push in lava (times the liquid push)',group:'Lava',scope:'world',default:3,min:0,max:6,step:.1})
export const liquidWingLiftSpeed=defineParam({id:'liquid.wingLiftSpeed',label:'Speed for full wing lift in liquid (m/s)',group:'Liquid',scope:'world',default:12,min:2,max:40,step:1})

// Lava is wadeable: a viscous drag that grows with depth and speed, and a crawl push that
// always beats it at low speed. Full throttle at the resting depth settles near
// crawlPower / (viscosity * (1 + sinkDepth)), 3 m/s with these defaults.
export const lavaViscosity=defineParam({id:'lava.viscosity',label:'Viscosity',group:'Lava',scope:'world',default:6,min:0,max:20,step:.1})
export const lavaSinkDepth=defineParam({id:'lava.sinkDepth',label:'Sink depth (m)',group:'Lava',scope:'world',default:.45,min:.1,max:2,step:.05})
export const lavaCrawlPower=defineParam({id:'lava.crawlPower',label:'Crawl power (m/s²)',group:'Lava',scope:'world',default:26,min:0,max:40,step:.5})
export const lavaTurnRate=defineParam({id:'lava.turnRate',label:'Turn rate (rad/s)',group:'Lava',scope:'world',default:.6,min:.1,max:2,step:.05})
export const lavaCoolingTime=defineParam({id:'lava.coolingTime',label:'Cooling time (s)',group:'Lava',scope:'world',default:20,min:1,max:120,step:1})
const liquidTerrains=new WeakMap<RAPIER.RigidBody,Terrain>()
const liquidStates=new WeakMap<RAPIER.RigidBody,LiquidState>()
export function registerLiquidTerrain(body:RAPIER.RigidBody,terrain:Terrain,state:LiquidState):void {liquidTerrains.set(body,terrain);liquidStates.set(body,state)}
export function liquidKind(terrain:Terrain,x:number,z:number):'lava'|'water'|null {
 return terrain.liquidKindAt?terrain.liquidKindAt(x,z):'lava'
}

/** Smooth 0..1 wetness from how far the lower chassis is under the surface (0 to .5 m). */
export function liquidWetness(immersion:number):number {
 const x=THREE.MathUtils.clamp(immersion/.5,0,1)
 return x*x*(3-2*x)
}

/**
 * Wing acceleration in a liquid, in m/s². `forward` and `up` are the body's unit axes in world
 * space, `forwardSpeed` the velocity along `forward`. The push lies along the nose and fades
 * as forward speed reaches `pushSpeed`; the lift lies along the body's up axis and grows with
 * the square of forward speed. At rest the result is purely along the nose.
 */
export function wingLiquidAcceleration(forward:THREE.Vector3,up:THREE.Vector3,forwardSpeed:number,wetness:number,gravity:number,out:THREE.Vector3,
 push:number=liquidWingLift.value,pushSpeed:number=liquidWingPushSpeed.value,effect:number=liquidWingEffect.value,liftSpeed:number=liquidWingLiftSpeed.value):THREE.Vector3 {
 const s=Math.max(0,forwardSpeed)
 const thrust=push*wetness*Math.max(0,1-s/Math.max(.1,pushSpeed))
 const lift=effect*gravity*wetness*Math.min(1,(s/Math.max(.1,liftSpeed))**2)
 return out.copy(forward).multiplyScalar(thrust).addScaledVector(up,lift)
}

/**
 * Lava response for one step, as pure numbers: the new velocity after viscous drag, crawl
 * push and the vertical hold toward the resting depth, all scaled by `wetness` so nothing
 * jumps at the surface. Implicit decay keeps it stable at any step length.
 */
export function lavaVelocityStep(v:{x:number;y:number;z:number},forward:{x:number;z:number},throttle:number,wetness:number,lavaDepth:number,heightError:number,wing:{x:number;y:number;z:number},dt:number,
 out:{x:number;y:number;z:number},viscosity=lavaViscosity.value,crawl=lavaCrawlPower.value):{x:number;y:number;z:number} {
 const drag=viscosity*wetness*(1+Math.min(2,lavaDepth))
 const decay=Math.exp(-drag*dt)
 const push=crawl*throttle*wetness
 // Integrate a = F - drag v exactly over the step: v' = v e^{-kt} + a (1 - e^{-kt}) / k.
 const gain=drag>1e-6?(1-decay)/drag:dt
 out.x=v.x*decay+(forward.x*push+wing.x)*gain
 out.z=v.z*decay+(forward.z*push+wing.z)*gain
 // Height: a damped hold toward the resting depth, plus the wings' climb at viscous terminal speed.
 const hold=THREE.MathUtils.clamp(heightError*2,-1.5,2)+wing.y/Math.max(1,drag)
 const blend=(1-Math.exp(-Math.max(3,drag*2)*dt))*wetness
 out.y=THREE.MathUtils.lerp(v.y,hold,blend)
 return out
}

/**
 * Attitude while wings are open in a liquid. The liquid resists the hull turning, so pitch and
 * roll rates are pulled toward what the player commands (throttle pitches, as in flight:
 * forward dives) instead of what the stalled wing's torque would do. Yaw is left alone.
 * `right`, `forward` are the body's unit axes in world space; returns the new angular velocity.
 */
export function wingAttitudeHold(w:THREE.Vector3,right:THREE.Vector3,fwd:THREE.Vector3,pitchInput:number,wetness:number,dt:number,out:THREE.Vector3,rate:number=liquidWingPitchRate.value):THREE.Vector3 {
 const k=1-Math.exp(-12*wetness*dt)
 const pitch=w.dot(right),roll=w.dot(fwd)
 // Positive rotation about the body's right axis raises the nose; forward input lowers it.
 const target=-THREE.MathUtils.clamp(pitchInput,-1,1)*rate
 return out.copy(w).addScaledVector(right,(target-pitch)*k).addScaledVector(fwd,-roll*k)
}

export interface LiquidState {
 lavaDepth:number
 entrySpeed:number
 wasImmersed:boolean
 wingWasOpen:boolean
 fastWingContact:boolean
 /** Retired with the vertical escape field; always zero. Kept for existing readers. */
 wingLaunchSpeed:number
 wingLiftAvailable:boolean
 /** Retired with the vertical escape field; always zero. */
 wingLiftSpeed:number
 /** Retired with the vertical escape field; always -Infinity. */
 wingLiftSurface:number
 stuck:boolean
 heat:number
 /** Wet surface plane in the vehicle frame; follows the paint when the car turns. */
 heatNormal:THREE.Vector3
 heatHeight:number
}
export function createLiquidState():LiquidState {return {entrySpeed:0,wasImmersed:false,wingWasOpen:false,fastWingContact:false,wingLaunchSpeed:0,wingLiftSpeed:0,wingLiftAvailable:false,wingLiftSurface:-Infinity,lavaDepth:0,stuck:false,heat:0,heatNormal:new THREE.Vector3(0,1,0),heatHeight:-100}}
const rightAxis=new THREE.Vector3(),angIn=new THREE.Vector3(),angOut=new THREE.Vector3()
/** With wings open, the wet share of the controller's torque (the stalled wing's pitch-down) gives way to the liquid's hold. */
function holdWingAttitude(body:RAPIER.RigidBody,pitchInput:number,wetness:number,dt:number):void {
 body.userTorque(userT);body.resetTorques(true)
 const keep=1-wetness
 if(keep>0)body.addTorque({x:userT.x*keep,y:userT.y*keep,z:userT.z*keep},true)
 const w=body.angvel();angIn.set(w.x,w.y,w.z)
 wingAttitudeHold(angIn,rightAxis,forward,pitchInput,wetness,dt,angOut)
 body.setAngvel(angOut,true)
}
const liquidQ=new THREE.Quaternion(),inverseQ=new THREE.Quaternion(),forward=new THREE.Vector3(),flat=new THREE.Vector3(),angular=new THREE.Vector3(),upAxis=new THREE.Vector3(),wetNormal=new THREE.Vector3(),globalUp=new THREE.Vector3(0,1,0),wing=new THREE.Vector3(),userF=new THREE.Vector3(),userT=new THREE.Vector3(),nextV={x:0,y:0,z:0}

/** Runs after each vehicle controller, so wheel, wing and jet forces cannot skim through lava. */
export function applyVehicleLiquid(body:RAPIER.RigidBody,world:RAPIER.World,terrain:Terrain,input:{x:number;y:number;z:number},kind:string,state:LiquidState,dt:number,wingsOpen=false):void {
 const p=body.translation(),surface=terrain.liquidHeightAt?.(p.x,p.z)??-Infinity
 const type=liquidKind(terrain,p.x,p.z)
 state.lavaDepth=type==='lava'&&Number.isFinite(surface)?Math.max(0,surface-p.y):0
 state.stuck=false
 state.heat=Math.max(0,state.heat-dt/lavaCoolingTime.value)
 // Contact begins when the lower chassis enters, not while a hover vehicle rides above it.
 const immersion=Number.isFinite(surface)&&type?Math.max(0,surface-p.y+.25):0
 const buggy=kind==='buggy'||kind==='buggy-syn3h'||kind==='buggy-classic'
 state.wingLiftAvailable=buggy&&liquidWingLift.value>0&&immersion>0
 state.wingLiftSurface=-Infinity;state.wingLiftSpeed=0;state.wingLaunchSpeed=0
 if(!immersion||!wingsOpen)state.fastWingContact=false
 else if(!state.wasImmersed&&wingsOpen&&state.entrySpeed>=8)state.fastWingContact=true
 state.wasImmersed=immersion>0;state.wingWasOpen=wingsOpen
 if(!immersion&&!(type==='water'&&waterSinking.value))return
 const wetness=liquidWetness(immersion)
 const r=body.rotation();liquidQ.set(r.x,r.y,r.z,r.w)
 forward.set(0,0,-1).applyQuaternion(liquidQ);upAxis.set(0,1,0).applyQuaternion(liquidQ);rightAxis.set(1,0,0).applyQuaternion(liquidQ)
 const wings=buggy&&wingsOpen&&liquidWingLift.value>0&&immersion>0&&!body.isKinematic()
 if(wings){
  const v=body.linvel()
  const push=liquidWingLift.value*(type==='lava'?lavaWingPush.value:1)
  wingLiquidAcceleration(forward,upAxis,v.x*forward.x+v.y*forward.y+v.z*forward.z,wetness,-world.gravity.y,wing,push)
 }else wing.set(0,0,0)
 if(type==='water'){
  state.heat=0;state.heatHeight=-100
  if(wings)body.addForce({x:wing.x*body.mass(),y:wing.y*body.mass(),z:wing.z*body.mass()},true)
  if(!waterSinking.value)return
  // Buoyancy, drag and planing lift are continuous in depth and speed (buoyancy.ts).
  // A fast winged touch skims on its wings without hull drag (commit c28eafb), but only in
  // proportion to its planing share: as it slows the skim support fades, the water forces
  // fade in, and it settles and sinks like any hull.
  const skim=buggy&&wingsOpen&&state.fastWingContact?planingShare(Math.hypot(body.linvel().x,body.linvel().z),waterProfiles.buggy.planing.value):0
  if(skim>0){
   const velocity=body.linvel(),depth=Math.max(0,surface-p.y)
   body.addForce({x:0,y:skim*wetness*body.mass()*(-world.gravity.y+Math.max(0,-velocity.y)*8+depth*20),z:0},true)
  }
  if(skim<1)applyWaterForces(body,world,terrain,kind,dt,0,undefined,1-skim)
  // Water resists the hull turning: with wings open the attitude is held, so a raised nose
  // stays raised against the stalled wing's pitch-down torque.
  if(wings)holdWingAttitude(body,input.y,wetness,dt)
  return
 }
 if(type!=='lava'||!immersion)return
 const v=body.linvel(),w=body.angvel()
 const wasCold=state.heat===0
 state.heat=1
 wetNormal.set(0,1,0).applyQuaternion(inverseQ.copy(liquidQ).invert())
 // Keep the deepest wetted band while hot. A new cold entry starts a fresh band.
 if(state.heatHeight===-100||surface-p.y>state.heatHeight||wasCold){state.heatNormal.copy(wetNormal);state.heatHeight=surface-p.y}
 state.stuck=state.lavaDepth>=lavaSinkDepth.value*.65&&Math.hypot(v.x,v.z)<1.5
 if(body.isKinematic())return
 // The lava owns motion in proportion to wetness: controller forces (wheels, wings, jets)
 // fade out as the chassis goes under and return smoothly as it climbs out.
 const keep=1-wetness
 body.userForce(userF);body.userTorque(userT)
 body.resetForces(true);body.resetTorques(true)
 if(keep>0){body.addForce({x:userF.x*keep,y:userF.y*keep,z:userF.z*keep},true);body.addTorque({x:userT.x*keep,y:userT.y*keep,z:userT.z*keep},true)}
 // Support the chassis above the bed in shallows instead of commanding it into the shore.
 const target=Math.max(surface-lavaSinkDepth.value,Math.min(surface+.3,terrain.heightAt(p.x,p.z)+.7))
 flat.copy(forward);flat.y=0
 if(flat.lengthSq()<.01)flat.set(0,0,-1);else flat.normalize()
 const throttle=THREE.MathUtils.clamp(kind==='jet'?input.z:input.y,-1,1)
 lavaVelocityStep(v,flat,throttle,wetness,state.lavaDepth,target-p.y,wing,dt,nextV)
 body.setLinvel(nextV,true)
 // Gravity still belongs to Rapier; the lava carries the weight it covers.
 body.addForce({x:0,y:-world.gravity.y*body.mass()*wetness,z:0},true)
 // A damped leveller and steady yaw let a vehicle wade out even after a tumble. With wings
 // open the attitude is held rather than levelled, so a raised nose stays raised.
 angular.copy(upAxis).cross(globalUp)
 const drag=lavaViscosity.value*wetness*(1+Math.min(2,state.lavaDepth))
 const turn=-input.x*lavaTurnRate.value*Math.max(.35,Math.abs(throttle))
 const angularBlend=(1-Math.exp(-Math.max(2,drag)*dt))*wetness
 if(wings){
  // Controller torques were already faded above; hold the commanded attitude, steer with yaw.
  body.setAngvel({x:w.x,y:THREE.MathUtils.lerp(w.y,turn,angularBlend),z:w.z},true)
  holdWingAttitude(body,input.y,wetness,dt)
 }else body.setAngvel({x:THREE.MathUtils.lerp(w.x,angular.x,angularBlend),y:THREE.MathUtils.lerp(w.y,turn,angularBlend),z:THREE.MathUtils.lerp(w.z,angular.z,angularBlend)},true)
}
