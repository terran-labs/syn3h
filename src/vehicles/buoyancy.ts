/** Shared water forces. Native controllers and Rapier seabed contacts retain ownership of drive. */
import * as THREE from 'three/webgpu'
import { defineParam, worldLavaAltitude } from '../../shared/params'
import type { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { liquidLegacyEscape } from './liquidMode'
import { seaWaves } from '../world/water/seaWaves'

export const waterSinking = defineParam<boolean>({ id:'water.sinking', label:'Sinking physics', group:'Water', scope:'world', default:true })
export const waterLinearDrag=defineParam({id:'water.linearDrag',label:'Linear drag (1/s)',group:'Water',scope:'world',default:.35,min:0,max:3,step:.05})
export const waterQuadraticDrag=defineParam({id:'water.quadraticDrag',label:'Quadratic drag (1/m)',group:'Water',scope:'world',default:.06,min:0,max:.5,step:.01})
// Planing: dynamic lift from speed at the surface. It starts at each kind's planing speed and
// reaches `planingLift` times the weight at about 1.5 times that speed, so only a vehicle that
// arrives fairly fast rides the surface; as it slows the lift fades and it settles and sinks.
export const waterPlaningLift=defineParam({id:'water.planingLift',label:'Planing lift (share of weight)',group:'Water',scope:'world',default:1.2,min:0,max:3,step:.05})
// A planing hull wets far less of itself, so its drag falls with the same curve.
export const waterPlaningDrag=defineParam({id:'water.planingDrag',label:'Hull drag left when planing (share)',group:'Water',scope:'world',default:.25,min:0,max:1,step:.05})
/** Planing share 0..1 for a horizontal speed and planing onset speed: 0 below onset, 1 at about 1.48 times it. */
export function planingShare(horizontal:number,onset:number):number {
 return Math.min(1,Math.max(0,(horizontal/Math.max(.1,onset))**2-1)/1.2)
}
function tuning(kind:string, buoyancy:number, planing:number) {
 return {
  buoyancy:defineParam({id:`water.${kind}.buoyancy`,label:`${kind} buoyancy / weight`,group:'Water',scope:'world',default:buoyancy,min:0,max:4,step:.05}),
  planing:defineParam({id:`water.${kind}.planingSpeed`,label:`${kind} planing speed (m/s)`,group:'Water',scope:'world',default:planing,min:1,max:100,step:1}),
 }
}
// Sealed craft displace more than their weight; dense tracked armour has no reserve lift.
export const waterProfiles = { buggy:tuning('buggy',.85,8), tank:tuning('tank',0,100), hovercraft:tuning('hovercraft',1.1,16), jet:tuning('jet',.65,24), zorb:tuning('zorb',2,100) }
const point=new THREE.Vector3(),q=new THREE.Quaternion(),flow={x:0,z:0},slope={x:0,z:0}
/** Match the four hull columns used by the force pass, including pitched contact. */
export function hasWaterContact(body:RAPIER.RigidBody,terrain:Terrain):boolean {
 const p=body.translation(),r=body.rotation();q.set(r.x,r.y,r.z,r.w)
 for(let i=0;i<4;i++){
  point.set(i&1?.8:-.8,0,i&2?1.2:-1.2).applyQuaternion(q).add(p)
  if(terrain.liquidKindAt?.(point.x,point.z)==='water' &&
     (terrain.liquidHeightAt?.(point.x,point.z)??-Infinity)>point.y-.5)return true
 }
 return false
}
// Match ZORB_FLOAT_DEPTH in zorb.ts: the generated force field rides on its base, rather
// than displacing water like a solid sphere. Keep current-relative drag in the shared pass.
const ZORB_SUPPORT_DEPTH=.4
/** A box's four displacement columns, or the sealed field's shallow support envelope. */
export function applyWaterForces(body:RAPIER.RigidBody,world:RAPIER.World,terrain:Terrain,kind:string,dt:number, radius=0,centre?:THREE.Vector3,scale=1):void {
 if(body.isKinematic()||!body.isEnabled())return
 const profile=kind.includes('buggy')?waterProfiles.buggy:waterProfiles[kind as keyof typeof waterProfiles]??waterProfiles.hovercraft
 const p=centre??body.translation(),r=body.rotation();q.set(r.x,r.y,r.z,r.w)
 if(scale<=0)return
 const mass=body.mass()*Math.min(1,scale),g=-world.gravity.y,n=radius?1:4
 for(let i=0;i<n;i++){
  if(radius)point.copy(p)
  else point.set(i&1? .8:-.8,0,i&2?1.2:-1.2).applyQuaternion(q).add(p)
  const surface=terrain.liquidHeightAt?.(point.x,point.z)??-Infinity
  if(!Number.isFinite(surface)||terrain.liquidKindAt?.(point.x,point.z)!=='water')continue
  const depth=surface-point.y
  const fraction=radius?THREE.MathUtils.clamp((depth+radius)/(2*ZORB_SUPPORT_DEPTH),0,1):THREE.MathUtils.clamp(depth+.5,0,1)
  if(fraction<=0)continue
  flow.x=0;flow.z=0;terrain.liquidFlowAt?.(point.x,point.z,flow)
  const ground=terrain.heightAt(point.x,point.z)
  const level=worldLavaAltitude.value
  // Inland water has its own height and current, not the global ocean's vertical motion.
  const seaSurface=level+seaWaves.offsetAt(point.x,point.z,ground,level)
  const surfaceSpeed=Math.abs(surface-seaSurface)<.01?seaWaves.verticalSpeedAt(point.x,point.z,ground,level):0
  // Sample the actual surface, including shoaling and geometric waves only.
  const hx=terrain.liquidHeightAt?.(point.x+.25,point.z)??surface
  const hz=terrain.liquidHeightAt?.(point.x,point.z+.25)??surface
  slope.x=Number.isFinite(hx)?(hx-surface)/.25:0
  slope.z=Number.isFinite(hz)?(hz-surface)/.25:0
  const v=body.velocityAtPoint(point),vx=v.x-flow.x,vy=v.y-surfaceSpeed,vz=v.z-flow.z
  const speed=Math.hypot(vx,vy,vz),horizontal=Math.hypot(vx,vz)
  // F/m = -(linear + quadratic |v|) v. Limit only the numerical decay per step.
  const planing=kind==='tank'||radius?0:planingShare(horizontal,profile.planing.value)*Math.max(0,1-Math.max(0,depth))
  const hull=liquidLegacyEscape.value?1:1-(1-waterPlaningDrag.value)*planing
  const drag=Math.min(.8/Math.max(dt,.001),(waterLinearDrag.value+waterQuadraticDrag.value*speed)*hull)*fraction*mass/n
  const buoy=profile.buoyancy.value*mass*g*fraction/n
  // Planing is a surface effect, fading within a metre below the hull. No tank planing.
  // Dynamic lift can carry the hull's weight with a little to spare, never more: past that a
  // real hull rises, wets less and loses lift, which the wetted fraction already models, but
  // an uncapped v^2 term in a 60 Hz step overshoots and throws the car into the air.
  const plane=!liquidLegacyEscape.value?mass*g/n*waterPlaningLift.value*planing*fraction:kind==='tank'||radius?0:mass*g/n*Math.min(1.2,Math.max(0,(horizontal/profile.planing.value)**2-1))*fraction*Math.max(0,1-Math.max(0,depth))
  // Heave damping: water resists a hull bobbing up and down far more than drag along it.
  // About critical for the buoyancy spring (omega = sqrt(lift per metre / mass) ~ 4.5 /s).
  // Only while the hull is crossing the surface: fully under, it sinks at its drag speed.
  const heave=6*4*fraction*(1-fraction)*mass/n
  body.addForceAtPoint({x:-vx*drag-buoy*slope.x,y:buoy+plane-vy*drag-vy*heave,z:-vz*drag-buoy*slope.z},point,true)
 }
}
