import { beforeAll, expect, it } from 'vitest'
import { Color, Vector3 } from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Jet } from '../../src/vehicles/Jet'
import { harness } from './harness'

beforeAll(initPhysics)
it('publishes a fitted headlight only while the jet can show it and clears it on disposal',()=>{
 const h=harness(),jet=new Jet(h.game,h.terrain,new Vector3(0,100,0))
 const source=jet.object.userData.headlights
 const p=new Vector3(),d=new Vector3(),c=new Color()
 try{
  expect(source.count).toBe(1);expect(source.needsGlow()).toBe(false)
  expect(source.sample(0,p,d,c)).toBe(true)
  expect(p.x).toBe(0);expect(p.y).toBeCloseTo(-.02);expect(p.z).toBeCloseTo(-3.502);expect(d.toArray()).toEqual([0,0,-1])
  jet.object.visible=false;expect(source.sample(0,p,d,c)).toBe(false)
  jet.object.visible=true;jet.object.userData.materializing=true
  expect(source.sample(0,p,d,c)).toBe(false)
  delete jet.object.userData.materializing
  jet.input.zorb=true;h.step(jet)
  expect(jet.zorbed).toBe(true);expect(source.sample(0,p,d,c)).toBe(false)
 }finally{jet.dispose();h.world.free()}
 expect(jet.object.userData.headlights).toBeUndefined()
 expect(source.sample(0,p,d,c)).toBe(false)
})
