import {describe,it,expect} from 'vitest'
import * as T from 'three/webgpu'
import {RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'
import {ParticleBatch} from '../../src/vehicles/effects/ParticleBatch'
import {dustSprite} from '../../src/vehicles/effects/sprites'
import {DUST_WIND,EXHAUST_WIND,effectNoise,hideUnusedLamps,writeVehicleLamps} from '../../src/vehicles/effects'
describe('bounded vehicle effects',()=>{
 it('caps the quad ring and rejects teleport bridges',()=>{
  const r=new RibbonBatch(4),a=new T.Vector3(),b=new T.Vector3(0,0,1),side=new T.Vector3(1,0,0),color=new T.Color()
  for(let i=0;i<20;i++)r.add(a,b,side,.5,60,.25,color)
  expect(r.used).toBe(4);expect(r.mesh.geometry.drawRange.count).toBe(24)
  expect(r.mesh.geometry.attributes.position.count).toBe(16)
  r.clear();r.add(a,new T.Vector3(0,0,1000),side,.5,60,.25,color);expect(r.used).toBe(0)
  r.dispose()
 })
 it('overwrites fixed particle slots without growing buffers',()=>{
  const p=new ParticleBatch(8,dustSprite),v=new T.Vector3(),c=new T.Color()
  for(let i=0;i<500;i++)p.emit(v,v,.3,1,2,c)
  expect(p.mesh.geometry.instanceCount).toBe(8);expect(p.mesh.geometry.attributes.fxOrigin.count).toBe(8)
  expect(p.emitted).toBe(500);p.dispose()
 })
 it('has repeatable cosmetic variation',()=>{
  expect(effectNoise(42)).toBe(effectNoise(42));expect(effectNoise(42)).not.toBe(effectNoise(43))
  for(let i=0;i<100;i++){expect(effectNoise(i)).toBeGreaterThanOrEqual(0);expect(effectNoise(i)).toBeLessThan(1)}
 })
 it('skips lamp blobs for a vehicle whose skin has its own lamps and collapses the spare slots',()=>{
  const batch=new T.InstancedMesh(new T.BufferGeometry(),new T.MeshBasicMaterial(),512);batch.count=8
  const head=new T.Color(1,1,.8),tail=new T.Color(1,0,0),m=new T.Matrix4(),p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3()
  const vehicle=(x:number,own:boolean)=>{const object=new T.Object3D();object.position.x=x;if(own)object.userData.ownLamps=true
   const points=[0,1,2,3].map(i=>{const point=new T.Object3D();point.position.z=i;object.add(point);return point});object.updateWorldMatrix(true,true);return {object,points}}
  const plain=vehicle(10,false),own=vehicle(20,true)
  // Stale data from an earlier frame, when both vehicles still drew blobs.
  for(let i=0;i<8;i++)batch.setMatrixAt(i,new T.Matrix4().makeTranslation(99,0,0))
  let index=writeVehicleLamps(batch,0,own.object,own.points,head,tail)
  expect(index).toBe(0)
  index=writeVehicleLamps(batch,index,plain.object,plain.points,head,tail)
  expect(index).toBe(4)
  hideUnusedLamps(batch,index)
  for(let i=0;i<4;i++){batch.getMatrixAt(i,m);m.decompose(p,q,scale);expect(p.x).toBe(10);expect(p.z).toBe(i);expect(scale.x).toBe(1)}
  const c=new T.Color();batch.getColorAt(0,c);expect(c.g).toBeCloseTo(1);batch.getColorAt(1,c);expect(c.g).toBe(0)
  // Three's decompose reports unit scale for a singular matrix, so read the element itself.
  for(let i=4;i<8;i++){batch.getMatrixAt(i,m);expect(m.elements[0]).toBe(0);expect(m.elements[12]).toBe(0)}
  // The flag is read every frame: a skin that sets it after loading stops its blobs.
  plain.object.userData.ownLamps=true
  index=writeVehicleLamps(batch,0,plain.object,plain.points,head,tail);hideUnusedLamps(batch,index)
  expect(index).toBe(0);batch.getMatrixAt(0,m);expect(m.elements[0]).toBe(0)
  batch.geometry.dispose();batch.material.dispose()
 })
 it('gives a new particle its share of the wind at its birth position, once',()=>{
  const p=new ParticleBatch(4,dustSprite),at=new T.Vector3(10,2,-30),v=new T.Vector3(1,3,0),c=new T.Color(),asked:number[][]=[]
  const velocity=()=>Array.from((p.mesh.geometry.getAttribute('fxVelocity') as T.BufferAttribute).array as Float32Array)
  // No share: untouched, and the wind is not even asked.
  p.drift=(x,y,z,out)=>{asked.push([x,y,z]);out.x=4;out.z=-2};p.emit(at,v,1,1,0,c)
  expect(velocity().slice(0,3)).toEqual([1,3,0]);expect(asked.length).toBe(0)
  p.windShare=.5;p.emit(at,v,1,1,0,c)
  expect(velocity().slice(3,6)).toEqual([3,3,-1]);expect(asked).toEqual([[10,2,-30]])
  // A calm world, or a wind function that fails, leaves the particle as emitted.
  p.drift=(_x,_y,_z,out)=>{out.x=0;out.z=0};p.emit(at,v,1,1,0,c);expect(velocity().slice(6,9)).toEqual([1,3,0])
  p.drift=(_x,_y,_z,out)=>{out.x=NaN;out.z=NaN};p.emit(at,v,1,1,0,c);expect(velocity().slice(9,12)).toEqual([1,3,0])
  p.dispose()
 })
 it('dust takes more of the wind than exhaust',()=>{expect(DUST_WIND).toBeCloseTo(.6);expect(EXHAUST_WIND).toBeCloseTo(.3)})
})
