import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {createVehicle,type VehicleKind} from '../../src/vehicles'
import type {Vehicle} from '../../src/vehicles/Vehicle'
import {harness} from './harness'
import {params} from '../../shared/params'
import {WeatherSystem,storminess,type WindVehicle} from '../../src/world/weather'
beforeAll(initPhysics)
const TILE=400
type H=ReturnType<typeof harness>
/** What a whole-tile move must leave exactly as it was. */
function snapshot(v:Vehicle){
 const l=v.body.linvel(),w=v.body.angvel(),r=v.body.rotation(),p=v.body.translation(),s=v.liquidState
 return {speed:[l.x,l.y,l.z],spin:[w.x,w.y,w.z],rot:[r.x,r.y,r.z,r.w],y:p.y,x:p.x,z:p.z,wheels:v.wheelsGrounded,wings:v.wingsOpen,zorbed:v.zorbed,radius:v.zorb.radius,
  lavaDepth:s.lavaDepth,stuck:s.stuck,lift:s.wingLiftSurface,liftSpeed:s.wingLiftSpeed,canLift:v.canLiftOut,heat:s.heat,stuckSteps:v.stuckSteps,guard:(v as unknown as {groundGuardHits?:number}).groundGuardHits??0}
}
const near=(a:number[],b:number[],tol:number)=>a.every((x,i)=>Math.abs(x-b[i])<=tol)
/** Drive to the seam, shift a tile as the terrain does (before the step), and compare the steps either side. */
function cross(h:H,v:Vehicle,dx:number,dz:number,settle=150,prepare?:()=>void,back=20){
 h.step(v,settle);prepare?.()
 const ax=Math.sign(dx)*-1,az=Math.sign(dz)*-1
 // Carry it to just past the edge at speed, keeping whatever height and attitude it has.
 const p=v.body.translation();v.body.setTranslation({x:ax?ax*(TILE/2-back):p.x,y:p.y,z:az?az*(TILE/2-back):p.z},true)
 const hold=()=>{const l=v.body.linvel();v.body.setLinvel({x:ax?ax*30:l.x,y:l.y,z:az?az*30:l.z},true)}
 let before=snapshot(v),after=before,usual={speed:0,y:0},crossed=false
 for(let i=0;i<240&&!crossed;i++){
  hold();const prev=snapshot(v)
  const t=v.body.translation(),past=(ax&&ax*t.x>TILE/2+4)||(az&&az*t.z>TILE/2+4)
  if(past){v.shiftBy(dx,dz);before=prev;h.step(v);after=snapshot(v);crossed=true}
  else{h.step(v);const now=snapshot(v);if(i>(back>10?20:2)){usual.speed=Math.max(usual.speed,Math.hypot(...now.speed.map((x,k)=>x-prev.speed[k])));usual.y=Math.max(usual.y,Math.abs(now.y-prev.y-prev.speed[1]*.02))}}
 }
 expect(crossed,'reached the seam').toBe(true)
 return {before,after,usual}
}
function expectUndisturbed(name:string,r:ReturnType<typeof cross>,dx:number,dz:number){
 const {before:b,after:a,usual:u}=r
 // Moved exactly one tile plus one step of travel.
 expect(a.x-b.x-dx,`${name} x`).toBeCloseTo(b.speed[0]*.02,0);expect(a.z-b.z-dz,`${name} z`).toBeCloseTo(b.speed[2]*.02,0)
 // Velocity changes no more than in an ordinary step nearby, with a little slack.
 expect(Math.hypot(...a.speed.map((x,k)=>x-b.speed[k])),`${name} velocity`).toBeLessThan(u.speed*2+1.5)
 expect(near(a.rot,b.rot,.06)||near(a.rot,b.rot.map(x=>-x),.06),`${name} orientation`).toBe(true)
 expect(Math.abs(a.y-b.y-b.speed[1]*.02),`${name} height`).toBeLessThan(u.y*2+.08)
 expect(a.wheels,`${name} ground contact`).toBe(b.wheels)
 expect(a.wings,`${name} wings`).toBe(b.wings);expect(a.zorbed,`${name} zorb`).toBe(b.zorbed);expect(a.radius,`${name} zorb radius`).toBeCloseTo(b.radius,1)
 expect(a.stuck,`${name} stuck`).toBe(b.stuck);expect(a.canLift,`${name} lift hint`).toBe(b.canLift)
 expect(a.guard,`${name} ground guard`).toBe(b.guard)
}
const SEAMS:[string,number,number][]=[['east',-TILE,0],['west',TILE,0],['south',0,-TILE],['north',0,TILE],['corner',-TILE,-TILE]]
const make=(h:H,kind:VehicleKind,y=2)=>{const v=createVehicle(h.game,h.terrain,kind,new T.Vector3(0,y,0),0);v.isLocal=false;return v}

describe('a whole tile shift at a seam leaves a vehicle undisturbed',()=>{
 for(const kind of ['buggy','hovercraft','tank'] as const)for(const [seam,dx,dz] of SEAMS){
  it(`${kind} on the ground, ${seam}`,()=>{
   const h=harness(),v=make(h,kind)
   try{expectUndisturbed(`${kind} ${seam}`,cross(h,v,dx,dz),dx,dz)}finally{v.dispose();h.world.free()}
  })
 }
 for(const [seam,dx,dz] of SEAMS)it(`jet at altitude, ${seam}`,()=>{
  const h=harness(),v=make(h,'jet',80);v.input.special=true;v.input.z=1
  try{expectUndisturbed(`jet ${seam}`,cross(h,v,dx,dz,60),dx,dz)}finally{v.dispose();h.world.free()}
 })
 it('a zorbed buggy keeps its ball, size and roll',()=>{
  const h=harness(),v=make(h,'buggy');v.input.zorb=true
  try{const r=cross(h,v,-TILE,0,250);expect(r.before.zorbed).toBe(true);expect(r.before.radius).toBeGreaterThan(4);expectUndisturbed('zorb',r,-TILE,0)
   expect(Math.hypot(...r.after.spin.map((x,k)=>x-r.before.spin[k]))).toBeLessThan(1)}finally{v.dispose();h.world.free()}
 })
 it('a buggy flying on wings stays in flight',()=>{
  const h=harness(),v=make(h,'buggy',40);v.input.special=true
  try{const r=cross(h,v,0,TILE,40);expect(r.before.wings).toBe(true);expectUndisturbed('wings',r,0,TILE)}finally{v.dispose();h.world.free()}
 })
 for(const liquid of ['water','lava'] as const)it(`a buggy lifting out of ${liquid} on its wings keeps the field's surface and climb`,()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>liquid
  const v=make(h,'buggy',9.5)
  try{
   // The field owns the buggy's motion: at most 6 m/s, along its nose. So cross the seam it
   // is facing (north, -Z), from close by.
   const r=cross(h,v,0,TILE,100,()=>{v.input.special=true;v.input.y=1;h.step(v,12)},1)
   expect(Number.isFinite(r.before.lift),'field armed before the seam').toBe(true)
   expect(r.after.lift).toBe(r.before.lift);expect(Math.abs(r.after.liftSpeed-r.before.liftSpeed)).toBeLessThan(.6)
   expectUndisturbed(`lift ${liquid}`,r,0,TILE)
  }finally{v.dispose();h.world.free()}
 })
 it('a buggy sunk in lava with wings closed stays sunk, hot and hinted',()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>'lava'
  const v=make(h,'buggy',9.2)
  try{const r=cross(h,v,TILE,0,150);expect(r.before.lavaDepth).toBeGreaterThan(0);expect(r.before.canLift).toBe(true)
   expect(Math.abs(r.after.lavaDepth-r.before.lavaDepth)).toBeLessThan(.15);expect(r.after.canLift).toBe(true);expect(Math.abs(r.after.heat-r.before.heat)).toBeLessThan(.05)}finally{v.dispose();h.world.free()}
 })
 it('the upright rescue timer is neither reset nor fired by the shift',()=>{
  const h=harness(),v=make(h,'buggy');v.isLocal=true
  try{h.step(v,60);v.stuckSteps=77;const before=v.stuckSteps;v.shiftBy(-TILE,0);expect(v.stuckSteps).toBe(before)}finally{v.dispose();h.world.free()}
 })
 for(const zorb of [false,true])it(`a ${zorb?'zorbed ':''}buggy crossing in a gale is carried across as cleanly as in still air`,()=>{
  // Wind is on by default in play. It is a force added at the end of the vehicle step, so a
  // tile shift, which only moves positions, must leave it and its effect alone.
  params.set(storminess.def.id,1)
  const base=harness(),v=make(base,'buggy');v.input.zorb=zorb
  const weather=new WeatherSystem(()=>base.terrain,()=>[v as unknown as WindVehicle])
  let strongest=0
  const h={...base,step(vehicle:Vehicle,n=1){for(let i=0;i<n;i++){weather.fixedUpdate();strongest=Math.max(strongest,vehicle.wind.length());base.step(vehicle)}}}
  try{const r=cross(h,v,-TILE,0,zorb?250:150);expect(strongest,'the gale reached the vehicle').toBeGreaterThan(.002);expectUndisturbed(`gale ${zorb?'zorb':'buggy'}`,r,-TILE,0)}
  finally{params.set(storminess.def.id,storminess.def.default);v.dispose();base.world.free()}
 })
})
