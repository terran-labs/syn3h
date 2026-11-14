import {describe,it,expect} from 'vitest'
import * as T from 'three/webgpu'
import {RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'
import {ParticleBatch} from '../../src/vehicles/effects/ParticleBatch'
import {effectNoise} from '../../src/vehicles/effects'
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
  const map=new T.Texture(),p=new ParticleBatch(8,map),v=new T.Vector3(),c=new T.Color()
  for(let i=0;i<500;i++)p.emit(v,v,.3,1,2,c)
  expect(p.mesh.geometry.instanceCount).toBe(8);expect(p.mesh.geometry.attributes.fxOrigin.count).toBe(8)
  expect(p.emitted).toBe(500);p.dispose();map.dispose()
 })
 it('has repeatable cosmetic variation',()=>{
  expect(effectNoise(42)).toBe(effectNoise(42));expect(effectNoise(42)).not.toBe(effectNoise(43))
  for(let i=0;i<100;i++){expect(effectNoise(i)).toBeGreaterThanOrEqual(0);expect(effectNoise(i)).toBeLessThan(1)}
 })
})
