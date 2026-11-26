/** Shared water forces. Native controllers and Rapier seabed contacts retain ownership of drive. */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../shared/params'
import type { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'

export const waterSinking = defineParam<boolean>({ id:'water.sinking', label:'Sinking physics', group:'Water', scope:'world', default:true })
export const waterLinearDrag=defineParam({id:'water.linearDrag',label:'Linear drag (1/s)',group:'Water',scope:'world',default:.35,min:0,max:3,step:.05})
export const waterQuadraticDrag=defineParam({id:'water.quadraticDrag',label:'Quadratic drag (1/m)',group:'Water',scope:'world',default:.06,min:0,max:.5,step:.01})
function tuning(kind:string, buoyancy:number, friction=1, keep=1) {
 return {
  buoyancy:defineParam({id:`water.${kind}.buoyancy`,label:`${kind} buoyancy / weight`,group:'Water',scope:'world',default:buoyancy,min:0,max:4,step:.05}),
  // A factor on the planing speed derived from the vehicle's weight and footprint (skip.ts), so
  // one vehicle can be made to skip more or less without touching the others. It replaced the
  // absolute water.<kind>.planingSpeed, whose old values are ignored wherever they still arrive.
  planing:defineParam({id:`water.${kind}.planing`,label:`${kind} planing speed factor`,group:'Water',scope:'world',default:1,min:.25,max:4,step:.05}),
  // Factors on the shared skip friction and energy kept (skip.ts), default 1: the zorb's ball
  // keeps the feel it had before vehicles skipped, a lighter friction and a softer bounce.
  skipFriction:defineParam({id:`water.${kind}.skipFriction`,label:`${kind} skip friction factor`,group:'Water',scope:'world',default:friction,min:0,max:4,step:.05}),
  skipKeep:defineParam({id:`water.${kind}.skipKeep`,label:`${kind} skip energy kept factor`,group:'Water',scope:'world',default:keep,min:.1,max:1.4,step:.01}),
 }
}
// Sealed craft displace more than their weight; dense tracked armour has no reserve lift.
export const waterProfiles = { buggy:tuning('buggy',1.6,2.5,.3), tank:tuning('tank',0), hovercraft:tuning('hovercraft',1.1), jet:tuning('jet',.65), zorb:tuning('zorb',2,.2,.5/.7) }
/** A vehicle kind's water profile; a kind with no entry floats like a hovercraft and plans at factor 1. */
export function waterProfileOf(kind:string){return kind.includes('buggy')?waterProfiles.buggy:waterProfiles[kind as keyof typeof waterProfiles]??waterProfiles.hovercraft}
/** A vehicle kind's factors on the shared skip friction and energy kept: its own settings, or 1 for a kind with none. */
export function skipFactors(kind:string):{friction:number;keep:number}{const p=kind.includes('buggy')?waterProfiles.buggy:waterProfiles[kind as keyof typeof waterProfiles];return p?{friction:p.skipFriction.value,keep:p.skipKeep.value}:{friction:1,keep:1}}
/** The planing speed factor for a vehicle kind: its own setting, or 1 for a kind with none. */
export function planingFactor(kind:string):number{const p=kind.includes('buggy')?waterProfiles.buggy:waterProfiles[kind as keyof typeof waterProfiles];return p?p.planing.value:1}
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
/**
 * A box's four displacement columns, or the sealed field's shallow support envelope. `bulk`
 * scales the drag and heave damping (not the buoyancy): a skipping zorb gives them way to its
 * own skimming lift (zorb.ts `skimForce`).
 */
export function applyWaterForces(body:RAPIER.RigidBody,world:RAPIER.World,terrain:Terrain,kind:string,dt:number, radius=0,centre?:THREE.Vector3,bulk=1):void {
 if(body.isKinematic())return
 const profile=waterProfileOf(kind)
 const p=centre??body.translation(),r=body.rotation();q.set(r.x,r.y,r.z,r.w)
 const mass=body.mass(),g=-world.gravity.y,n=radius?1:4
 for(let i=0;i<n;i++){
  if(radius)point.copy(p)
  else point.set(i&1? .8:-.8,0,i&2?1.2:-1.2).applyQuaternion(q).add(p)
  const surface=terrain.liquidHeightAt?.(point.x,point.z)??-Infinity
  if(!Number.isFinite(surface)||terrain.liquidKindAt?.(point.x,point.z)!=='water')continue
  const depth=surface-point.y
  const fraction=radius?THREE.MathUtils.clamp((depth+radius)/(2*ZORB_SUPPORT_DEPTH),0,1):THREE.MathUtils.clamp(depth+.5,0,1)
  if(fraction<=0)continue
  flow.x=0;flow.z=0;terrain.liquidFlowAt?.(point.x,point.z,flow)
  // The surface's own rise and fall: its waves, and the sea gliding to a new level (terrain).
  const surfaceSpeed=terrain.liquidVerticalSpeedAt?.(point.x,point.z)??0
  // Sample the actual surface, including shoaling and geometric waves only.
  const hx=terrain.liquidHeightAt?.(point.x+.25,point.z)??surface
  const hz=terrain.liquidHeightAt?.(point.x,point.z+.25)??surface
  slope.x=Number.isFinite(hx)?(hx-surface)/.25:0
  slope.z=Number.isFinite(hz)?(hz-surface)/.25:0
  const v=body.velocityAtPoint(point),vx=v.x-flow.x,vy=v.y-surfaceSpeed,vz=v.z-flow.z
  const speed=Math.hypot(vx,vy,vz)
  // F/m = -(linear + quadratic |v|) v. Limit only the numerical decay per step.
  const drag=Math.min(.8/Math.max(dt,.001),waterLinearDrag.value+waterQuadraticDrag.value*speed)*fraction*bulk*mass/n
  const buoy=profile.buoyancy.value*mass*g*fraction/n
  // Planing lift is not here: every vehicle's skip and planing is skip.ts `applySkip`.
  // Heave damping: water resists a hull bobbing up and down far more than drag along it.
  // About critical for the buoyancy spring (omega = sqrt(lift per metre / mass) ~ 4.5 /s).
  // Only while the hull is crossing the surface: fully under, it sinks at its drag speed.
  const heave=6*4*fraction*(1-fraction)*bulk*mass/n
  body.addForceAtPoint({x:-vx*drag-buoy*slope.x,y:buoy-vy*drag-vy*heave,z:-vz*drag-buoy*slope.z},point,true)
 }
}
