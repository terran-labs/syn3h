import {beforeEach,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import type {Game,System} from '../../src/core/Game'
import type {Terrain} from '../../src/world/Terrain'
import {Vehicle} from '../../src/vehicles/Vehicle'
import {RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'
import {ParticleBatch} from '../../src/vehicles/effects/ParticleBatch'
import {dustSprite} from '../../src/vehicles/effects/sprites'
import {attachVehicleEffects} from '../../src/vehicles/effects'
import {buggyHeadlights,headlightsEnabled} from '../../src/vehicles/effects/headlights'
import {params} from '../../shared/params'

/** Effects that follow the player across a world seam. */
const TILE=400
const read=(a:T.BufferAttribute|T.InstancedBufferAttribute)=>Array.from(a.array as Float32Array)

describe('shared effect batches shift with a world seam',()=>{
 it('moves every ribbon vertex by exactly the vector and uploads the whole buffer',()=>{
  const r=new RibbonBatch(8),side=new T.Vector3(1,0,0),c=new T.Color()
  for(let i=0;i<5;i++)r.add(new T.Vector3(190+i,.1,i),new T.Vector3(190.5+i,.1,i+.5),side,.5,60,.25,c)
  const pos=r.mesh.geometry.attributes.position as T.BufferAttribute,before=read(pos),version=pos.version
  r.shift(-TILE,TILE)
  const after=read(pos)
  for(let i=0;i<before.length;i+=3){expect(after[i]).toBe(Math.fround(before[i]-TILE));expect(after[i+1]).toBe(before[i+1]);expect(after[i+2]).toBe(Math.fround(before[i+2]+TILE))}
  expect(pos.version).toBeGreaterThan(version)
  expect(pos.updateRanges).toEqual([{start:0,count:before.length}])
  // A mark added after the shift lands where asked, and the full range survives beside it.
  r.add(new T.Vector3(-205,.1,400),new T.Vector3(-204.5,.1,400.5),side,.5,60,.25,c)
  expect(pos.getY(5*4)).toBeCloseTo(.1);expect(pos.getX(5*4)).toBeCloseTo(-204.75);expect(pos.getZ(5*4)).toBeCloseTo(400)
  expect(pos.updateRanges[0]).toEqual({start:0,count:before.length})
  expect(r.used).toBe(6);r.dispose()
 })
 it('moves every particle origin by exactly the vector; velocities and later emits are untouched',()=>{
  const p=new ParticleBatch(6,dustSprite),c=new T.Color(),geo=p.mesh.geometry
  for(let i=0;i<6;i++)p.emit(new T.Vector3(195+i,1+i,-3*i),new T.Vector3(i,2,-i),1,.3,2,c)
  const origin=geo.attributes.fxOrigin as T.InstancedBufferAttribute,velocity=geo.attributes.fxVelocity as T.InstancedBufferAttribute
  const before=read(origin),vBefore=read(velocity)
  p.shift(-TILE,0)
  const after=read(origin)
  for(let i=0;i<before.length;i+=3){expect(after[i]).toBe(Math.fround(before[i]-TILE));expect(after[i+1]===before[i+1]&&after[i+2]===before[i+2]).toBe(true)}
  expect(read(velocity)).toEqual(vBefore)
  expect(origin.updateRanges).toEqual([{start:0,count:18}])
  p.emit(new T.Vector3(-210,3,7),new T.Vector3(),1,.3,2,c)
  expect([origin.getX(0),origin.getY(0),origin.getZ(0)]).toEqual([-210,3,7])
  // The shift did not run twice: the other slots still hold the shifted values.
  expect(origin.getX(1)).toBe(Math.fround(196-TILE))
  p.dispose()
 })
})

/** A stand-in buggy: the real Vehicle.shiftBy on a minimal body, with wheel contacts on flat ground. */
function stand(){
 const object=new T.Group(),speed=10
 let x=0,y=.5,z=0
 const body={translation:()=>({x,y,z}),setTranslation:(t:{x:number,y:number,z:number})=>{x=t.x;y=t.y;z=t.z},linvel:()=>({x:speed,y:0,z:0})}
 const contacts=[[-1,-1.3],[1,-1.3],[-1,1.3],[1,1.3]].map(()=>({grounded:true,point:new T.Vector3(),normal:new T.Vector3(0,1,0),slip:3}))
 const offsets=[[-1.1,-1.3],[1.1,-1.3],[-1.1,1.3],[1.1,1.3]]
 const v={kind:'buggy',object,body,prevPos:new T.Vector3(),currPos:new T.Vector3(),input:{x:0,y:1,z:1,brakes:false,special:false},colors:{accent:'#40c0ff'},
  wheelsGrounded:4,wingsOpen:false,landedThisStep:false,landingImpact:0,
  getWheelEffects(){contacts.forEach((c,i)=>c.point.set(object.position.x+offsets[i][0],0,object.position.z+offsets[i][1]));return contacts},
  shiftBy(dx:number,dz:number){Vehicle.prototype.shiftBy.call(this as unknown as Vehicle,dx,dz)},
  /** Advance along +X as physics would, keeping body and drawn position together. */
  drive(dt:number){x+=speed*dt;object.position.set(x,y,z)},
 }
 object.position.set(x,y,z)
 return v
}
function scene(){
 const systems:System[]=[],camera=new T.PerspectiveCamera()
 const game={scene:new T.Scene(),camera,renderer:{toneMappingExposure:1},add(s:System){systems.push(s);return s},remove(s:System){systems.splice(systems.indexOf(s),1);s.dispose?.()}} as unknown as Game
 const terrain={size:TILE,heightAt:()=>0,normalAt:(_x:number,_z:number,o:T.Vector3)=>o.set(0,1,0)} as unknown as Terrain
 const effects=()=>game.scene.userData.vehicleEffects as {marks:number}
 const world=()=>systems[0] as unknown as {marks:RibbonBatch,dust:ParticleBatch,update(dt:number):void}
 return {game,terrain,systems,effects,world}
}

describe('buggy headlights',()=>{
 beforeEach(()=>{headlightsEnabled.value=true;return ()=>{headlightsEnabled.value=false}})
 it('uses two lamp positions, shares the night intensity, and turns both off by day',()=>{
  const s=scene(),v=stand()
  const sky=Object.assign(new T.Object3D(),{sunDirection:{value:new T.Vector3(0,-1,0)}})
  s.game.scene.add(sky)
  const dispose=attachVehicleEffects(s.game,s.terrain,v as unknown as Vehicle,{local:true})
  const beams:T.SpotLight[]=[]
  s.game.scene.add(v.object)
  s.game.scene.traverse(o=>{if(o instanceof T.SpotLight)beams.push(o)})
  expect(beams).toHaveLength(2)
  expect(beams[0].position.x).toBeLessThan(0)
  expect(beams[1].position.x).toBe(-beams[0].position.x)
  for(const beam of beams){expect(beam.position.z).toBeLessThan(0);expect(beam.target.position.z).toBeLessThan(beam.position.z);expect(beam.castShadow).toBe(false)}
  const updateLights=()=>{s.world().update(0);s.game.scene.updateMatrixWorld()}
  updateLights()
  headlightsEnabled.value=false;updateLights()
  expect(beams.every(beam=>beam.intensity===0)).toBe(true)
  headlightsEnabled.value=true;updateLights()
  // Both beams share the night strength, which follows the headlight setting (headlights.ts).
  const night=beams.map(b=>b.intensity)
  expect(night[0]).toBeGreaterThan(0);expect(night[1]).toBe(night[0])
  v.object.visible=false;s.game.scene.updateMatrixWorld()
  expect(beams.map(b=>b.intensity)).toEqual([0,0])
  const visible:T.Object3D[]=[];s.game.scene.traverseVisible(o=>visible.push(o))
  expect(beams.every(b=>visible.includes(b)&&visible.includes(b.target))).toBe(true)
  v.object.visible=true;s.game.scene.updateMatrixWorld()
  expect(beams.map(b=>b.intensity)).toEqual(night)
  params.set(buggyHeadlights.def.id,1);updateLights();const full=beams[0].intensity
  params.set(buggyHeadlights.def.id,.5);updateLights();expect(beams[0].intensity).toBeCloseTo(full/2,6)
  params.set(buggyHeadlights.def.id,buggyHeadlights.def.default)
  sky.sunDirection.value.y=1;updateLights()
  expect(beams.map(b=>b.intensity)).toEqual([0,0])
  let disposed=0
  for(const beam of beams)beam.addEventListener('dispose',()=>disposed++)
  dispose();dispose()
  expect(disposed).toBe(2)
  expect(v.object.getObjectByName('Vehicle effects')).toBeUndefined()
 })
 it('does not allocate road lights for remote vehicles',()=>{
  const s=scene(),v=stand(),dispose=attachVehicleEffects(s.game,s.terrain,v as unknown as Vehicle,{local:false})
  const beams:T.SpotLight[]=[];s.game.scene.traverse(o=>{if(o instanceof T.SpotLight)beams.push(o)})
  expect(beams).toHaveLength(0);dispose()
 })
})
/** Drive a stand-in buggy 40 m along +X from x=180, shifting it back a tile at x=204 if asked. */
function run(local:boolean,shift:boolean){
 const s=scene(),v=stand(),dispose=attachVehicleEffects(s.game,s.terrain,v as unknown as Vehicle,{local})
 v.object.position.x=180;v.body.setTranslation({x:180,y:.5,z:0})
 let shifted=false,marksBefore=0,positionsBefore:number[]=[]
 for(let i=0;i<80;i++){
  v.drive(.05)
  if(shift&&!shifted&&v.object.position.x>204){
   marksBefore=s.world().marks.used;positionsBefore=read(s.world().marks.mesh.geometry.attributes.position as T.BufferAttribute)
   v.shiftBy(-TILE,0);shifted=true
  }
  s.game.camera.position.copy(v.object.position)
  s.world().update(.05)
 }
 const w=s.world()
 const out={marks:w.marks.used,positions:read(w.marks.mesh.geometry.attributes.position as T.BufferAttribute),dust:read(w.dust.mesh.geometry.attributes.fxOrigin as T.InstancedBufferAttribute),marksBefore,positionsBefore}
 dispose();return out
}
/** Longest quad in the ring, from the midpoints of its two ends. */
function longestQuad(positions:number[],used:number){
 let longest=0
 for(let q=0;q<used;q++){const o=q*12,ax=(positions[o]+positions[o+3])/2,az=(positions[o+2]+positions[o+5])/2,bx=(positions[o+6]+positions[o+9])/2,bz=(positions[o+8]+positions[o+11])/2;longest=Math.max(longest,Math.hypot(bx-ax,bz-az))}
 return longest
}

describe('vehicle effects across a world seam',()=>{
 it('Vehicle.shiftBy announces the move on its object after moving',()=>{
  const v=stand(),seen:{dx:number,dz:number,x:number}[]=[]
  v.object.addEventListener('tileshift' as never,((e:{dx:number,dz:number})=>seen.push({dx:e.dx,dz:e.dz,x:v.object.position.x})) as never)
  v.object.position.x=201;v.body.setTranslation({x:201,y:.5,z:0});v.shiftBy(-TILE,TILE)
  expect(seen).toEqual([{dx:-TILE,dz:TILE,x:201-TILE}])
  expect(v.body.translation()).toEqual({x:201-TILE,y:.5,z:TILE});expect(v.prevPos.x).toBe(-TILE);expect(v.currPos.z).toBe(TILE)
 })
 it('the local player keeps its marks and dust behind it, unbroken, as if no seam were there',()=>{
  const straight=run(true,false),crossed=run(true,true)
  expect(crossed.marksBefore).toBeGreaterThan(40)
  // No reset: exactly as many marks as the same drive with no seam, and none bridges the tile.
  expect(crossed.marks).toBe(straight.marks)
  expect(longestQuad(crossed.positions,crossed.marks)).toBeLessThan(1.2)
  // Everything drawn, before and after the seam, is the seamless drive moved by one tile.
  for(let i=0;i<crossed.positions.length;i+=3){expect(crossed.positions[i]).toBeCloseTo(straight.positions[i]-TILE,3);expect(crossed.positions[i+2]).toBeCloseTo(straight.positions[i+2],5)}
  expect(crossed.dust.some(x=>x!==0)).toBe(true)
  for(let i=0;i<crossed.dust.length;i+=3)if(straight.dust[i]!==0)expect(crossed.dust[i]).toBeCloseTo(straight.dust[i]-TILE,3)
 })
 it('a re-imaged vehicle that is not the player leaves its marks where they were and restarts its own',()=>{
  const crossed=run(false,true),n=crossed.marksBefore
  expect(n).toBeGreaterThan(40)
  // Marks made before the re-image are untouched.
  expect(crossed.positions.slice(0,n*12)).toEqual(crossed.positionsBefore.slice(0,n*12))
  // New marks start fresh near the new position: no quad spans the jump.
  expect(crossed.marks).toBeGreaterThan(n)
  expect(longestQuad(crossed.positions,crossed.marks)).toBeLessThan(1.2)
  for(let q=n;q<crossed.marks;q++)expect(crossed.positions[q*12]).toBeLessThan(-150)
 })
})

describe("other vehicles' headlights on the ground",()=>{
 beforeEach(()=>{headlightsEnabled.value=true;return ()=>{headlightsEnabled.value=false}})
 const night=(s:ReturnType<typeof scene>,y:number)=>{const sky=Object.assign(new T.Object3D(),{sunDirection:{value:new T.Vector3(0,y,0)}});s.game.scene.add(sky);return sky}
 const pools=(s:ReturnType<typeof scene>)=>(s.game.scene.userData.vehicleEffects as {pools:number}).pools
 it('a bot or other player lights the ground ahead of it at night, on the ground, not by day',()=>{
  const s=scene(),sky=night(s,-1),v=stand(),dispose=attachVehicleEffects(s.game,s.terrain,v as unknown as Vehicle,{local:false})
  s.world().update(0)
  expect(pools(s)).toBe(1)
  // The patch lies on the ground (height 0 here) ahead of the vehicle (-z), not floating or sunk.
  const mesh=s.game.scene.getObjectByName("Other vehicles' headlight pools") as T.Mesh,pos=mesh.geometry.attributes.position
  const n=mesh.geometry.drawRange.count/3,ys=[],zs=[]
  for(let i=0;i<Math.min(pos.count,84);i++){ys.push(pos.getY(i));zs.push(pos.getZ(i))}
  expect(n).toBeGreaterThan(0)
  for(const y of ys)expect(Math.abs(y)).toBeLessThan(.2)
  expect(Math.min(...zs)).toBeLessThan(-10)
  sky.sunDirection.value.y=1;s.world().update(0)
  expect(pools(s)).toBe(0)
  dispose()
 })
 it('never for your own vehicle (it has real lights), nor with the setting off',()=>{
  const s=scene();night(s,-1)
  const own=stand(),disposeOwn=attachVehicleEffects(s.game,s.terrain,own as unknown as Vehicle,{local:true})
  s.world().update(0)
  expect(pools(s)).toBe(0)
  const other=stand(),disposeOther=attachVehicleEffects(s.game,s.terrain,other as unknown as Vehicle,{local:false})
  params.set('light.groundPools',0);s.world().update(0)
  expect(pools(s)).toBe(0)
  params.set('light.groundPools',1);s.world().update(0)
  expect(pools(s)).toBe(1)
  disposeOther();disposeOwn()
 })
 it('none from a vehicle high above the ground, such as a jet in flight',()=>{
  const s=scene();night(s,-1)
  const v=stand(),dispose=attachVehicleEffects(s.game,s.terrain,v as unknown as Vehicle,{local:false})
  v.object.position.y=40;s.world().update(0)
  expect(pools(s)).toBe(0)
  dispose()
 })
})
