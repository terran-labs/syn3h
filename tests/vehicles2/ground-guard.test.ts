import {afterEach,beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics,FIXED_DT,createWorld,RAPIER} from '../../src/core/physics'
import {emptyInput} from '../../src/core/Input'
import {heightfieldDesc} from '../../src/world/terrain/collider'
import type {TerrainData} from '../../src/world/terrain/generate'
import type {Game} from '../../src/core/Game'
import type {Terrain} from '../../src/world/Terrain'
import {createVehicle,type VehicleKind} from '../../src/vehicles'
import {Vehicle} from '../../src/vehicles/Vehicle'
beforeAll(initPhysics)
afterEach(()=>{Vehicle.groundGuard=true})
const N=257,CELL=4,SIZE=(N-1)*CELL
const hill=(x:number,z:number)=>18*Math.sin(x/37)*Math.cos(z/41)+9*Math.sin(x/11+z/13)
/** Hilly ground as the real heightfield collider, with a height function over the same grid. */
function land(){
 const world=createWorld(9.81),heights=new Float32Array(N*N)
 for(let iz=0;iz<N;iz++)for(let ix=0;ix<N;ix++)heights[iz*N+ix]=hill(-SIZE/2+ix*CELL,-SIZE/2+iz*CELL)
 const data={resolution:N,cell:CELL,size:SIZE,heights} as unknown as TerrainData
 let collider=world.createCollider(heightfieldDesc(data,0))
 const heightAt=(x:number,z:number)=>{const fx=Math.min(N-1.001,Math.max(0,(x+SIZE/2)/CELL)),fz=Math.min(N-1.001,Math.max(0,(z+SIZE/2)/CELL)),ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz
  const h=(a:number,b:number)=>heights[b*N+a];return (h(ix,iz)*(1-tx)+h(ix+1,iz)*tx)*(1-tz)+(h(ix,iz+1)*(1-tx)+h(ix+1,iz+1)*tx)*tz}
 const normalAt=(x:number,z:number,out:T.Vector3)=>out.set(heightAt(x-1,z)-heightAt(x+1,z),2,heightAt(x,z-1)-heightAt(x,z+1)).normalize()
 const game={world,scene:new T.Scene(),input:{state:emptyInput()}} as unknown as Game
 const terrain={size:SIZE,heightAt,normalAt,spawnPoint:()=>({position:new T.Vector3(0,heightAt(0,0)+2,0),heading:0}),dispose(){}} as unknown as Terrain
 world.step()
 return {world,game,terrain,heightAt,rebuild(){world.removeCollider(collider,true);collider=world.createCollider(heightfieldDesc(data,0))}}
}
type Land=ReturnType<typeof land>
const step=(l:Land,v:Vehicle)=>{v.fixedUpdate(FIXED_DT);l.world.step();v.postPhysics(FIXED_DT)}
/** Steps the last `fly` spent with the centre more than half a metre under the surface. */
let stepsUnder=0
/** Lowest height of the vehicle's centre above the ground under it, while inside the map. */
function fly(l:Land,v:Vehicle,steps:number,each?:()=>void){
 let lowest=Infinity;stepsUnder=0
 for(let i=0;i<steps;i++){each?.();step(l,v);const p=v.body.translation();expect(Number.isFinite(p.y)).toBe(true)
  if(Math.abs(p.x)<SIZE/2-8&&Math.abs(p.z)<SIZE/2-8){const c=p.y-l.heightAt(p.x,p.z);lowest=Math.min(lowest,c);if(c<-.5)stepsUnder++}}
 return lowest
}
function launch(l:Land,kind:VehicleKind,speed:number,dive:number){
 const v=createVehicle(l.game,l.terrain,kind,new T.Vector3(3,l.heightAt(3,100)+(dive?25:1.2),100),0);v.isLocal=false
 const a=dive*Math.PI/180;v.body.setLinvel({x:0,y:-Math.sin(a)*speed,z:-Math.cos(a)*speed},true);return v
}
const KINDS=['buggy','buggy-classic','jet','hovercraft','tank'] as const

describe('vehicles and the ground at speed',()=>{
 it('every vehicle stays above ground from 80 to 300 m/s, and the guard never has to act in ordinary flight',()=>{
  for(const kind of KINDS)for(const speed of [80,300])for(const dive of [0,20,60]){
   const l=land(),v=launch(l,kind,speed,dive)
   const lowest=fly(l,v,150)
   expect(lowest,`${kind} ${speed} m/s dive ${dive}`).toBeGreaterThan(-0.3)
   expect(v.groundGuardHits,`${kind} ${speed} m/s dive ${dive} guard hits`).toBe(0)
   v.dispose();l.world.free()
  }
 },120000)
 it('a zorbed buggy stays above ground at 300 m/s',()=>{
  const l=land(),v=createVehicle(l.game,l.terrain,'buggy',new T.Vector3(3,l.heightAt(3,100)+2,100),0);v.isLocal=false;v.input.zorb=true
  for(let i=0;i<150;i++)step(l,v)
  v.body.setTranslation({x:3,y:l.heightAt(3,100)+30,z:100},true);v.body.setLinvel({x:0,y:-150,z:-260},true)
  expect(fly(l,v,150)).toBeGreaterThan(1);expect(v.groundGuardHits).toBe(0)
  v.dispose();l.world.free()
 })
 for(const kind of KINDS){
  it(`${kind}: put under the surface at speed, it travels underground without the guard and is back on the ground with it`,()=>{
   // The terrain is a surface with no inside. This is the fault the guard exists for: nothing
   // in the engine pushes a body back up through it, so it keeps going under the ground
   // until the land happens to dip below it, or for good where the land is flat.
   const run=(guard:boolean)=>{
    Vehicle.groundGuard=guard
    const l=land(),v=launch(l,kind,0,0)
    for(let i=0;i<60;i++)step(l,v)
    const p=v.body.translation();v.body.setTranslation({x:p.x,y:l.heightAt(p.x,p.z)-2.5,z:p.z},true);v.body.setLinvel({x:0,y:-8,z:-60},true)
    step(l,v)
    const first=v.body.translation(),firstClear=first.y-l.heightAt(first.x,first.z)
    const lowest=fly(l,v,120),under=stepsUnder,hits=v.groundGuardHits
    v.dispose();l.world.free();return {firstClear,lowest,under,hits}
   }
   const without=run(false),guarded=run(true)
   // The hovercraft's own hull clearance correction already lifts it; the others stay under.
   if(kind!=='hovercraft'){expect(without.lowest,'without the guard').toBeLessThan(-2);expect(without.under).toBeGreaterThan(5)}
   expect(without.hits).toBe(0)
   // Back above the surface on the very next step, and it stays there.
   expect(guarded.firstClear,'one step later').toBeGreaterThan(0)
   expect(guarded.lowest,'afterwards').toBeGreaterThan(-0.3);expect(guarded.under).toBe(0)
   if(kind!=='hovercraft')expect(guarded.hits).toBeGreaterThan(0)
  })
 }
 it('keeps the speed along the surface and removes only the part going into the ground',()=>{
  const l=land(),v=launch(l,'buggy',0,0);v.body.setGravityScale(0,true)
  const p=v.body.translation(),n=l.terrain.normalAt(p.x,p.z-1.2,new T.Vector3())
  v.body.setTranslation({x:p.x,y:l.heightAt(p.x,p.z)-1,z:p.z},true);v.body.setLinvel({x:0,y:-20,z:-60},true)
  // One bare physics step and the guard, without the vehicle's own forces, so only the guard changes the velocity.
  l.world.step();v.postPhysics(FIXED_DT)
  const after=v.body.linvel(),into=after.x*n.x+after.y*n.y+after.z*n.z
  expect(v.groundGuardHits).toBe(1)
  expect(into).toBeGreaterThan(-1.5)
  expect(Math.hypot(after.x,after.y,after.z)).toBeGreaterThan(40)
  v.dispose();l.world.free()
 })
 it('recovers a vehicle that starts a step underground and carries on along the surface',()=>{
  const l=land(),v=createVehicle(l.game,l.terrain,'buggy',new T.Vector3(3,l.heightAt(3,100)+1,100),0);v.isLocal=false
  for(let i=0;i<50;i++)step(l,v)
  // Move it under the surface in small steps, as a bad physics step would, not as a teleport.
  const p=v.body.translation();v.body.setTranslation({x:p.x,y:l.heightAt(p.x,p.z)-3,z:p.z},true);v.body.setLinvel({x:0,y:-5,z:-30},true)
  step(l,v)
  const q=v.body.translation()
  expect(q.y-l.heightAt(q.x,q.z)).toBeGreaterThan(0);expect(v.groundGuardHits).toBe(1)
  expect(fly(l,v,100)).toBeGreaterThan(-0.3)
  v.dispose();l.world.free()
 })
 it('holds while the terrain collider is rebuilt under a fast vehicle every step',()=>{
  for(const kind of ['buggy','tank'] as const){
   const l=land(),v=launch(l,kind,90,0)
   expect(fly(l,v,200,()=>l.rebuild()),kind).toBeGreaterThan(-0.3)
   console.log(kind,'guard hits while the collider was rebuilt every step:',v.groundGuardHits)
   v.dispose();l.world.free()
  }
 })
 it('recovers a remote copy that turns dynamic while its interpolated position is underground',()=>{
  const l=land(),v=createVehicle(l.game,l.terrain,'buggy',new T.Vector3(3,l.heightAt(3,100)+1,100),0);v.isLocal=false
  v.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true)
  // A straight line between two network samples cuts through a hill.
  for(let i=0;i<20;i++){v.body.setNextKinematicTranslation({x:3,y:l.heightAt(3,100-i)-2,z:100-i});step(l,v)}
  expect(v.groundGuardHits).toBe(0)
  v.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);v.body.setLinvel({x:0,y:0,z:-40},true)
  expect(fly(l,v,100)).toBeGreaterThan(-2.1)
  const p=v.body.translation();expect(p.y-l.heightAt(p.x,p.z)).toBeGreaterThan(0);expect(v.groundGuardHits).toBeGreaterThan(0)
  v.dispose();l.world.free()
 })
 it('does not act on a teleport, a long snap, or beyond the edge of an unwrapped world',()=>{
  const l=land(),v=createVehicle(l.game,l.terrain,'buggy',new T.Vector3(0,l.heightAt(0,0)+1,0),0);v.isLocal=false
  for(let i=0;i<20;i++)step(l,v)
  v.teleport(new T.Vector3(200,l.heightAt(200,-200)+1,-200));step(l,v)
  // A move of more than 25 m in one step is a respawn or a network snap, not motion to sweep.
  v.body.setTranslation({x:-150,y:l.heightAt(-150,150)+1,z:150},true);step(l,v)
  expect(v.groundGuardHits).toBe(0)
  // Far outside the map there is no collider: the vehicle must be allowed to fall away.
  v.teleport(new T.Vector3(SIZE/2+400,5,0));for(let i=0;i<200;i++)step(l,v)
  expect(v.groundGuardHits).toBe(0);expect(v.body.translation().y).toBeLessThan(-50)
  v.dispose();l.world.free()
 })
})
