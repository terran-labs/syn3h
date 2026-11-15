/** Indestructible vehicles: viscous lava, cooling paint and legacy water buoyancy. */
import * as THREE from 'three/webgpu'
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
  if (!buggyLavaFloat.value) return false
  // The shared force field handles wing escape for both buggies, independent of mass.
  if (input.wingsOpen && liquidWingLift.value > 0) return false
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


export const liquidWingLift=defineParam({id:'liquid.wingLift',label:'Wing escape lift (m/s²)',group:'Liquid',scope:'world',default:18,min:0,max:40,step:1})

export const lavaViscosity=defineParam({id:'lava.viscosity',label:'Viscosity',group:'Lava',scope:'world',default:6,min:0,max:20,step:.1})
export const lavaSinkDepth=defineParam({id:'lava.sinkDepth',label:'Sink depth (m)',group:'Lava',scope:'world',default:.45,min:.1,max:2,step:.05})
export const lavaCrawlPower=defineParam({id:'lava.crawlPower',label:'Crawl power (m/s²)',group:'Lava',scope:'world',default:3,min:0,max:15,step:.1})
export const lavaCoolingTime=defineParam({id:'lava.coolingTime',label:'Cooling time (s)',group:'Lava',scope:'world',default:20,min:1,max:120,step:1})
const liquidTerrains=new WeakMap<RAPIER.RigidBody,Terrain>()
export function registerLiquidTerrain(body:RAPIER.RigidBody,terrain:Terrain):void {liquidTerrains.set(body,terrain)}
export function liquidKind(terrain:Terrain,x:number,z:number):'lava'|'water'|null {
 return terrain.liquidKindAt?terrain.liquidKindAt(x,z):'lava'
}
export interface LiquidState {
 lavaDepth:number
 wingLiftAvailable:boolean
 wingLiftSpeed:number
 wingLiftSurface:number
 stuck:boolean
 heat:number
 /** Wet surface plane in the vehicle frame; follows the paint when the car turns. */
 heatNormal:THREE.Vector3
 heatHeight:number
}
export function createLiquidState():LiquidState {return {wingLiftSpeed:0,wingLiftAvailable:false,wingLiftSurface:-Infinity,lavaDepth:0,stuck:false,heat:0,heatNormal:new THREE.Vector3(0,1,0),heatHeight:-100}}
const liquidQ=new THREE.Quaternion(),inverseQ=new THREE.Quaternion(),forward=new THREE.Vector3(),angular=new THREE.Vector3(),upAxis=new THREE.Vector3(),wetNormal=new THREE.Vector3(),globalUp=new THREE.Vector3(0,1,0)

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
 if(!wingsOpen||!buggy||liquidWingLift.value<=0)state.wingLiftSurface=-Infinity
 else if(immersion>0)state.wingLiftSurface=surface
 // A deployed field carries its lift above the surface so the hull clears a wild shore.
 // The ten-metre hover height follows the Syn3h thermal band (VhiclBuggy.cs 459-466).
 // Hold it until wings close; an altitude cutoff stranded stalled buggies on steep banks.
 const escape=wingsOpen&&Number.isFinite(state.wingLiftSurface)
 if(!escape){state.wingLiftSurface=-Infinity;state.wingLiftSpeed=0}
 if(!immersion&&!escape)return
 if(type==='water'){state.heat=0;state.heatHeight=-100}
 if(type==='water'&&buggy&&!escape)return
 const lava=type==='lava',fraction=Math.min(1,immersion/.5)
 const v=body.linvel(),w=body.angvel(),r=body.rotation();liquidQ.set(r.x,r.y,r.z,r.w)
 if(lava&&immersion>0){
  const wasCold=state.heat===0
  state.heat=1
  wetNormal.set(0,1,0).applyQuaternion(inverseQ.copy(liquidQ).invert())
  // Keep the deepest wetted band while hot. A new cold entry starts a fresh band.
  if(state.heatHeight===-100||surface-p.y>state.heatHeight||wasCold){state.heatNormal.copy(wetNormal);state.heatHeight=surface-p.y}
 }
 state.stuck=lava&&state.lavaDepth>=lavaSinkDepth.value*.65&&Math.hypot(v.x,v.z)<1.5
 if(escape)state.stuck=false
 if(body.isKinematic())return
 if(escape){
  // A buoyant force field replaces sticky drag while deployed. The acceleration is
  // mass independent; the speed cap prevents old paddle/thermal forces adding a launch.
  body.resetForces(true);body.resetTorques(true)
  const gain=1-Math.exp(-4*dt)
  forward.set(0,0,-1).applyQuaternion(liquidQ);forward.y=0
  if(forward.lengthSq()>.01)forward.normalize();else forward.set(0,0,-1)
  const throttle=THREE.MathUtils.clamp(input.y,-1,1)
  // Flight controllers can rotate vertical velocity into forward speed each step.
  // Keep the field's climb rate separately so that conversion cannot cancel escape.
  const targetHeight=Math.max(state.wingLiftSurface+10,terrain.heightAt(p.x,p.z)+3)
  const wantedClimb=THREE.MathUtils.clamp((targetHeight-p.y)*2,-2,6)
  state.wingLiftSpeed+=THREE.MathUtils.clamp(wantedClimb-state.wingLiftSpeed,-liquidWingLift.value*dt,liquidWingLift.value*dt)
  const hx=THREE.MathUtils.lerp(v.x,forward.x*throttle*6,gain),hz=THREE.MathUtils.lerp(v.z,forward.z*throttle*6,gain)
  const horizontalLimit=Math.min(1,6/Math.max(.001,Math.hypot(hx,hz)))
  body.setLinvel({x:hx*horizontalLimit,y:state.wingLiftSpeed,z:hz*horizontalLimit},true)
  body.addForce({x:0,y:-world.gravity.y*body.mass(),z:0},true)
  upAxis.set(0,1,0).applyQuaternion(liquidQ);angular.copy(upAxis).cross(globalUp)
  body.setAngvel({x:THREE.MathUtils.lerp(w.x,angular.x*3,gain),y:THREE.MathUtils.lerp(w.y,-input.x*.7,gain),z:THREE.MathUtils.lerp(w.z,angular.z*3,gain)},true)
  return
 }
 // Replace native drive forces only while immersed. Gravity still belongs to Rapier.
 body.resetForces(true);body.resetTorques(true)
 const drag=(lava?lavaViscosity.value:1.2)*fraction*(1+Math.min(2,state.lavaDepth))
 const decay=Math.exp(-drag*dt),verticalBlend=1-Math.exp(-Math.max(3,drag*2)*dt)
 // In shallows, support the chassis above the bed instead of commanding it into the shore.
 const target=Math.max(surface-(lava?lavaSinkDepth.value:0),Math.min(surface+.3,terrain.heightAt(p.x,p.z)+.7))
 const verticalTarget=THREE.MathUtils.clamp((target-p.y)*2,-1.5,2)
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
