/** Indestructible vehicles: viscous lava, cooling paint and legacy water buoyancy. */
import * as THREE from 'three/webgpu'
import { applyWaterForces, waterSinking, hasWaterContact, waterProfiles } from './buoyancy'
import { defineParam } from '../../shared/params'
import type { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { type UnityBody, signedAngle, unityEulerAngles } from './unityBody'
import { applyHull, applyWings, createHullState, type HullInput, type HullProfile, type HullState, type WingProfile } from './liquidHull'

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
    if (input.wingsOpen && hitDistance < 2) ub.addForce(tmpF.set(0, 400, 0))
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


// Open wings in a liquid float the buggy and act as hydrofoils (liquidHull.ts applyWings).
export const liquidWingBuoyancy=defineParam({id:'liquid.wingBuoyancy',label:'Wings: buoyancy / weight',group:'Liquid',scope:'world',default:.9,min:0,max:3,step:.05})
export const liquidWingAuthority=defineParam({id:'liquid.wingAuthority',label:'Wings: underwater authority',group:'Liquid',scope:'world',default:1,min:0,max:3,step:.05})
/** Lava pushes this much harder on a wing than water: a slower, heavier, lazier rise. */
export const LAVA_DENSITY={value:2.5}
const hullInput:HullInput={throttle:0,wheelSpeed:0}
const wingProfile:WingProfile={buoyancy:.9,authority:1,density:1}

export const lavaViscosity=defineParam({id:'lava.viscosity',label:'Viscosity',group:'Lava',scope:'world',default:6,min:0,max:20,step:.1})
export const lavaSinkDepth=defineParam({id:'lava.sinkDepth',label:'Sink depth (m)',group:'Lava',scope:'world',default:.45,min:.1,max:2,step:.05})
export const lavaCrawlPower=defineParam({id:'lava.crawlPower',label:'Crawl power (m/s²)',group:'Lava',scope:'world',default:3,min:0,max:15,step:.1})
// The buggy's lava: a dense, thick liquid it rides half in, paddles through and struggles across.
const L={group:'Lava',scope:'world' as const}
export const lavaThickness=defineParam({...L,id:'lava.thickness',label:'Buggy: thickness (drag)',default:1,min:0,max:4,step:.05})
export const lavaBuoyancy=defineParam({...L,id:'lava.buoyancy',label:'Buggy: buoyancy / weight',default:2,min:.5,max:5,step:.05})
export const lavaPaddle=defineParam({...L,id:'lava.paddle',label:'Buggy: paddle thrust (m/s²)',default:9,min:0,max:30,step:.5})
export const lavaPorpoise=defineParam({...L,id:'lava.porpoise',label:'Buggy: porpoise (0 to 1)',default:.6,min:0,max:1,step:.05})
export const lavaGrip=defineParam({...L,id:'lava.grip',label:'Buggy: wheel grip on the bed (0 to 1)',default:.3,min:0,max:1,step:.05})
export const lavaSteer=defineParam({...L,id:'lava.steer',label:'Buggy: steering (0 to 2)',default:1,min:0,max:2,step:.05})
export const lavaWaddle=defineParam({...L,id:'lava.waddle',label:'Buggy: waddle (0 to 1)',default:.65,min:0,max:1,step:.05})
export const GAIT={lava:.9}
const lavaHull:HullProfile={buoyancy:2,thickness:1,linear:2,quadratic:.3,heave:6,paddle:9,paddleSpeed:12,porpoise:.6,waddle:.5,gait:GAIT.lava,planing:6,skim:.6,planeLift:0,deep:10,steer:1}
function lavaProfile():HullProfile{
 lavaHull.buoyancy=lavaBuoyancy.value;lavaHull.thickness=lavaThickness.value;lavaHull.paddle=lavaPaddle.value
 lavaHull.porpoise=lavaPorpoise.value;lavaHull.waddle=lavaWaddle.value;lavaHull.gait=GAIT.lava;lavaHull.steer=lavaSteer.value
 return lavaHull
}
// The buggy's water: light and quick. It floats half in, paddles and steers, and at speed it
// planes and skips across the top.
const W={group:'Water',scope:'world' as const}
export const waterThickness=defineParam({...W,id:'water.thickness',label:'Buggy: thickness (drag)',default:1,min:0,max:4,step:.05})
export const waterPaddle=defineParam({...W,id:'water.paddle',label:'Buggy: paddle thrust (m/s²)',default:6,min:0,max:30,step:.5})
export const waterPorpoise=defineParam({...W,id:'water.porpoise',label:'Buggy: porpoise (0 to 1)',default:.3,min:0,max:1,step:.05})
export const waterSink=defineParam({...W,id:'water.sink',label:'Buggy: buoyancy when stopped (lower sinks faster)',default:.6,min:0,max:1.5,step:.05})
export const waterLiftSpeed=defineParam({...W,id:'water.liftSpeed',label:'Buggy: speed below which lift is lost (m/s)',default:3,min:.5,max:15,step:.25})
export const waterCoast=defineParam({...W,id:'water.coast',label:'Buggy: coasting drag (1/s)',default:1,min:0,max:6,step:.05})
export const waterSteer=defineParam({...W,id:'water.steer',label:'Buggy: steering (0 to 2)',default:.55,min:0,max:2,step:.05})
export const waterWaddle=defineParam({...W,id:'water.waddle',label:'Buggy: waddle (0 to 1)',default:.2,min:0,max:1,step:.05})
export const waterSkim=defineParam({...W,id:'water.skim',label:'Buggy: planing lift / weight',default:.9,min:0,max:2,step:.05})
export const waterGrip=defineParam({...W,id:'water.grip',label:'Buggy: wheel grip on the bed (0 to 1)',default:.6,min:0,max:1,step:.05})
const waterHull:HullProfile={buoyancy:1.6,thickness:1,linear:.5,quadratic:.04,heave:3,paddle:6,paddleSpeed:8,porpoise:.3,waddle:.2,gait:1.6,planing:10,skim:.3,planeLift:.9,deep:0,steer:.55}
function waterProfile():HullProfile{
 const w=waterProfiles.buggy
 waterHull.buoyancy=w.buoyancy.value;waterHull.planing=w.planing.value;waterHull.thickness=waterThickness.value;waterHull.paddle=waterPaddle.value
 waterHull.porpoise=waterPorpoise.value;waterHull.waddle=waterWaddle.value;waterHull.planeLift=waterSkim.value;waterHull.steer=waterSteer.value;waterHull.liftSpeed=waterLiftSpeed.value;waterHull.coast=waterCoast.value
 return waterHull
}
export const lavaCoolingTime=defineParam({id:'lava.coolingTime',label:'Cooling time (s)',group:'Lava',scope:'world',default:20,min:1,max:120,step:1})
const liquidTerrains=new WeakMap<RAPIER.RigidBody,Terrain>()
const liquidStates=new WeakMap<RAPIER.RigidBody,LiquidState>()
export function registerLiquidTerrain(body:RAPIER.RigidBody,terrain:Terrain,state:LiquidState):void {liquidTerrains.set(body,terrain);liquidStates.set(body,state)}
export function liquidKind(terrain:Terrain,x:number,z:number):'lava'|'water'|null {
 return terrain.liquidKindAt?terrain.liquidKindAt(x,z):'lava'
}
export interface LiquidState {
 lavaDepth:number
 entrySpeed:number
 wasImmersed:boolean
 wingWasOpen:boolean
 fastWingContact:boolean
 wingLaunchSpeed:number
 wingLiftAvailable:boolean
 wingLiftSpeed:number
 wingLiftSurface:number
 stuck:boolean
 heat:number
 /** Wet surface plane in the vehicle frame; follows the paint when the car turns. */
 heatNormal:THREE.Vector3
 heatHeight:number
 /** Corner lag and gait phase of the buggy's liquid hull. */
 hull:HullState
 /** Wheel surface speed along the nose, m/s, set by a wheeled controller each step. */
 wheelSpeed:number
 /** Live wheel geometry, set by a wheeled controller: hub half track, half wheelbase, tyre radius. */
 wheel:{x:number;z:number;radius:number}
 /** Velocity and spin before this step's controller ran. */
 preV:THREE.Vector3
 preW:THREE.Vector3
 /** Mean wetness of the hull last step, 0..1. */
 hullWet:number
}
export function createLiquidState():LiquidState {return {entrySpeed:0,wasImmersed:false,wingWasOpen:false,fastWingContact:false,wingLaunchSpeed:0,wingLiftSpeed:0,wingLiftAvailable:false,wingLiftSurface:-Infinity,lavaDepth:0,stuck:false,heat:0,heatNormal:new THREE.Vector3(0,1,0),heatHeight:-100,hull:createHullState(),wheelSpeed:0,wheel:{x:1.1,z:1.3,radius:.5},preV:new THREE.Vector3(),preW:new THREE.Vector3(),hullWet:0}}
const liquidQ=new THREE.Quaternion(),inverseQ=new THREE.Quaternion(),forward=new THREE.Vector3(),angular=new THREE.Vector3(),upAxis=new THREE.Vector3(),wetNormal=new THREE.Vector3(),globalUp=new THREE.Vector3(0,1,0)

/**
 * Scale what the vehicle's own controller did this step (forces it added and velocity it set) by
 * `grip`: tyres and suspension on a bed under a heavy liquid bite less and carry less.
 */
function softenController(body:RAPIER.RigidBody,state:LiquidState,grip:number):void {
 if(grip>=1)return
 const F=body.userForce(),T=body.userTorque(),v=body.linvel(),w=body.angvel(),a=state.preV,b=state.preW
 body.resetForces(true);body.resetTorques(true)
 body.addForce({x:F.x*grip,y:F.y*grip,z:F.z*grip},true);body.addTorque({x:T.x*grip,y:T.y*grip,z:T.z*grip},true)
 body.setLinvel({x:a.x+(v.x-a.x)*grip,y:a.y+(v.y-a.y)*grip,z:a.z+(v.z-a.z)*grip},true)
 body.setAngvel({x:b.x+(w.x-b.x)*grip,y:b.y+(w.y-b.y)*grip,z:b.z+(w.z-b.z)*grip},true)
}
/** Runs after each vehicle controller, so wheel, wing and jet forces cannot skim through lava. */
export function applyVehicleLiquid(body:RAPIER.RigidBody,world:RAPIER.World,terrain:Terrain,input:{x:number;y:number;z:number;brakes?:boolean},kind:string,state:LiquidState,dt:number,wingsOpen=false):void {
 const p=body.translation(),surface=terrain.liquidHeightAt?.(p.x,p.z)??-Infinity
 const type=liquidKind(terrain,p.x,p.z)
 state.lavaDepth=type==='lava'&&Number.isFinite(surface)?Math.max(0,surface-p.y):0
 state.stuck=false
 state.heat=Math.max(0,state.heat-dt/lavaCoolingTime.value)
 // Contact begins when the lower chassis enters, not while a hover vehicle rides above it.
 const immersion=Number.isFinite(surface)&&type?Math.max(0,surface-p.y+.25):0
 const buggy=kind==='buggy'||kind==='buggy-syn3h'||kind==='buggy-classic'
 // Wings get a buggy out of trouble by floating it, not by a lift field: no escape state.
 state.wingLiftAvailable=buggy&&liquidWingBuoyancy.value>0&&immersion>0
 state.wingLiftSurface=-Infinity;state.wingLiftSpeed=0;state.wingLaunchSpeed=0;state.fastWingContact=false
 state.wasImmersed=immersion>0;state.wingWasOpen=wingsOpen
 if(type==='water'&&immersion>0){state.heat=0;state.heatHeight=-100}
 const lava=type==='lava'
 const v=body.linvel(),w=body.angvel(),r=body.rotation();liquidQ.set(r.x,r.y,r.z,r.w)
 if(lava&&immersion>0){
  const wasCold=state.heat===0
  state.heat=1
  wetNormal.set(0,1,0).applyQuaternion(inverseQ.copy(liquidQ).invert())
  // Keep the deepest wetted band while hot. A new cold entry starts a fresh band.
  if(state.heatHeight===-100||surface-p.y>state.heatHeight||wasCold){state.heatNormal.copy(wetNormal);state.heatHeight=surface-p.y}
 }
 // Out of the liquid the hull is dry: nothing stale may drag the motor or soften the tyres.
 if(buggy&&!(type&&(lava||waterSinking.value))){state.hullWet=0;state.hull.mean=0;state.hull.axle=0}
 if(buggy&&type&&(lava||waterSinking.value)){
  // The buggy's hull columns reach a metre above its centre, so it feels the liquid before its centre is in.
  if(!Number.isFinite(surface)||p.y>surface+1.2+(wingsOpen?1:0)){state.hullWet=0;state.hull.mean=0;state.hull.axle=0;return}
  state.stuck=lava&&state.lavaDepth>=.3&&Math.hypot(v.x,v.z)<1.5
  if(body.isKinematic())return
  // Forces only. Tyres on the bed bite less as the liquid carries the weight; with the wings
  // open the air flight model fades out as the hull goes under and the wings work as hydrofoils.
  softenController(body,state,wingsOpen?1-Math.min(1,state.hull.mean*2):1-(1-(lava?lavaGrip:waterGrip).value)*Math.min(1,state.hullWet*2))
  hullInput.throttle=input.y;hullInput.steer=input.x;hullInput.brakes=!!input.brakes;hullInput.wheelSpeed=state.wheelSpeed;hullInput.wheel=state.wheel
  const profile=lava?lavaProfile():waterProfile()
  // Water holds a buggy up only while it works to stay up; open wings carry it instead.
  if(!lava)profile.sink=wingsOpen?undefined:waterSink.value
  state.hullWet=applyHull(body,world,terrain,type,profile,state.hull,hullInput,dt)
  if(wingsOpen){
   wingProfile.buoyancy=liquidWingBuoyancy.value;wingProfile.authority=liquidWingAuthority.value;wingProfile.density=lava?LAVA_DENSITY.value:1
   applyWings(body,world,terrain,type,wingProfile,state.hull,input,dt)
  }
  return
 }
 if(type==='water'&&waterSinking.value){applyWaterForces(body,world,terrain,kind,dt);return}
 if(!immersion||type==='water')return
 const fraction=Math.min(1,immersion/.5)
 state.stuck=state.lavaDepth>=lavaSinkDepth.value*.65&&Math.hypot(v.x,v.z)<1.5
 if(body.isKinematic())return
 // Replace native drive forces only while immersed. Gravity still belongs to Rapier. The
 // vehicle's own upward lift (a jet's hover thrust, a hovercraft's fans) is kept as a climb
 // through the lava's drag: a vehicle that can climb out under its own power must be able to
 // (the owner's rule of 18 November 2026, AGENTS.md). Its wheels and thrust along the ground
 // stay replaced by the crawl below, so driving through lava feels the same.
 // The lava already carries the weight (the support below), so only lift beyond it climbs.
 const ownLift=Math.max(0,body.userForce().y+world.gravity.y*body.mass())
 body.resetForces(true);body.resetTorques(true)
 const drag=(lava?lavaViscosity.value:1.2)*fraction*(1+Math.min(2,state.lavaDepth))
 const decay=Math.exp(-drag*dt),verticalBlend=1-Math.exp(-Math.max(3,drag*2)*dt)
 // In shallows, support the chassis above the bed instead of commanding it into the shore.
 const target=Math.max(surface-(lava?lavaSinkDepth.value:0),Math.min(surface+.3,terrain.heightAt(p.x,p.z)+.7))
 // The vehicle's own lift climbs at its terminal speed through the lava's drag.
 const verticalTarget=THREE.MathUtils.clamp((target-p.y)*2,-1.5,2)+ownLift/body.mass()/Math.max(1,drag)
 forward.set(0,0,-1).applyQuaternion(liquidQ);forward.y=0
 if(forward.lengthSq()<.01)forward.set(0,0,-1);else forward.normalize()
 const throttle=THREE.MathUtils.clamp(kind==='jet'?input.z:input.y,-1,1)
 const acceleration=(lava?lavaCrawlPower.value:4)*throttle
 body.setLinvel({x:v.x*decay+forward.x*acceleration*dt,y:THREE.MathUtils.lerp(v.y,verticalTarget,verticalBlend),z:v.z*decay+forward.z*acceleration*dt},true)
 body.addForce({x:0,y:-world.gravity.y*body.mass(),z:0},true)
 // A damped leveller and slow yaw permit deliberate crawling out even after a tumble.
 upAxis.set(0,1,0).applyQuaternion(liquidQ);angular.copy(upAxis).cross(globalUp)
 const turn=-input.x*(lava?.35:.7)*Math.max(.25,Math.abs(throttle))
 const angularBlend=1-Math.exp(-Math.max(2,drag)*dt)
 body.setAngvel({x:THREE.MathUtils.lerp(w.x,angular.x,angularBlend),y:THREE.MathUtils.lerp(w.y,turn,angularBlend),z:THREE.MathUtils.lerp(w.z,angular.z,angularBlend)},true)
}
