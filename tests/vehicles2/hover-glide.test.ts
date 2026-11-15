import {beforeAll,describe,it,expect} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Hovercraft,hoverBrakeTime} from '../../src/vehicles/Hovercraft'
import {harness} from './harness'
beforeAll(initPhysics)
describe('assisted hovercraft',()=>{
 it('holds a damped clearance above liquid without a ground collider',()=>{
  const h=harness(9.81,false);h.terrain.heightAt=()=>-30;h.terrain.liquidHeightAt=()=>5
  const v=new Hovercraft(h.game,h.terrain,new T.Vector3(0,6,0));v.isLocal=false
  h.step(v,500);expect(v.body.translation().y).toBeCloseTo(7.5,1);expect(Math.abs(v.body.linvel().y)).toBeLessThan(.1)
  v.dispose();h.world.free()
 })
 it('brakes gradually while preserving vertical motion',()=>{
  const h=harness(0,false);h.terrain.heightAt=()=>-100
  // The 90% rule is checked at one second, whatever the shipped default is.
  const brake=hoverBrakeTime as {value:number},shipped=brake.value;brake.value=1
  const v=new Hovercraft(h.game,h.terrain,new T.Vector3(0,100,0));v.isLocal=false;v.input.brakes=true
  v.body.setLinvel({x:10,y:-2,z:0},true);h.step(v)
  expect(v.body.linvel().x).toBeGreaterThan(9);expect(v.body.linvel().y).toBeCloseTo(-2)
  h.step(v,49);expect(v.body.linvel().x).toBeCloseTo(1,1)
  brake.value=shipped
  v.dispose();h.world.free()
 })
 it('levels after a jump rather than continually pitching with throttle',()=>{
  const h=harness(0,false);h.terrain.heightAt=()=>-100
  const v=new Hovercraft(h.game,h.terrain,new T.Vector3(0,100,0));v.isLocal=false;v.input.y=1
  v.body.setRotation(new T.Quaternion().setFromEuler(new T.Euler(.8,0,.5)),true)
  h.step(v,300);const up=new T.Vector3(0,1,0).applyQuaternion(v.body.rotation())
  expect(up.y).toBeGreaterThan(.99);expect(Math.abs(v.body.angvel().x)).toBeLessThan(.1)
  v.dispose();h.world.free()
 })
 it('keeps the visible hull above a narrow crest and banks into a turn',()=>{
  const h=harness(9.81,false);h.terrain.heightAt=(x,z)=>Math.max(0,4-Math.abs(z)*3)+x*.2
  const v=new Hovercraft(h.game,h.terrain,new T.Vector3(0,2,0));v.isLocal=false;v.input.x=1;v.input.y=1
  let min=Infinity
  for(let i=0;i<300;i++){
   h.step(v);const p=v.body.translation(),q=v.body.rotation(),a=new T.Vector3()
   for(let x=-1.26;x<=1.26;x+=.21)for(let z=-1.63;z<=1.52;z+=.21){a.set(x,.0167,z).applyQuaternion(q).add(p);min=Math.min(min,a.y-h.terrain.heightAt(a.x,a.z))}
  }
  expect(min).toBeGreaterThanOrEqual(0);expect(v.body.angvel().y).toBeLessThan(0)
  expect(new T.Vector3(0,1,0).applyQuaternion(v.body.rotation()).y).toBeGreaterThan(.9)
  v.dispose();h.world.free()
 })
 it('follows a sustained climb without relying on penetration correction',()=>{
  const h=harness(9.81,false);h.terrain.heightAt=(_x,z)=>-z*.35
  const v=new Hovercraft(h.game,h.terrain,new T.Vector3(0,2.5,0));v.isLocal=false;v.input.y=1
  h.step(v,500)
  expect(v.clearanceCorrections).toBeLessThan(5)
  const p=v.body.translation();expect(p.y-h.terrain.heightAt(p.x,p.z)).toBeGreaterThan(1)
  v.dispose();h.world.free()
 })

})
