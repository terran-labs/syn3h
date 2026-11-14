import {beforeAll,describe,it,expect} from 'vitest'
import * as THREE from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Tank} from '../../src/vehicles/Tank'
import {harness} from './harness'
beforeAll(initPhysics)
describe('legacy tank with six shape casts',()=>{
 it('folds six track masses into one body and rests on all contacts',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,2,0));v.isLocal=false
  expect(v.body.mass()).toBeCloseTo(241);expect(h.world.bodies.len()).toBe(1)
  h.step(v,400);expect(v.groundedTracks).toBe(6);expect(v.body.translation().y).toBeGreaterThan(.3)
  expect(Math.abs(v.body.linvel().y)).toBeLessThan(.05);v.dispose();h.world.free()
 })
 it('drives forward and reverses using terrain contacts',()=>{
  for(const direction of [1,-1]){
   const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false;h.step(v,150)
   v.input.y=direction;h.step(v,150);expect(v.body.linvel().z*direction).toBeLessThan(-1)
   expect(Number.isFinite(v.body.rotation().w)).toBe(true);v.dispose();h.world.free()
  }
 })
 it('pivots right and cannot drive in midair',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false;h.step(v,150)
  v.input.x=1;h.step(v,10);expect(v.body.angvel().y).toBeLessThan(0)
  v.teleport(new THREE.Vector3(0,100,0));v.input.x=0;v.input.y=1;h.step(v,10)
  expect(v.groundedTracks).toBe(0);expect(v.body.linvel().z).toBeCloseTo(0);v.dispose();h.world.free()
 })
 it('recovers an overturned hull without nonfinite state',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false
  v.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI),true)
  h.step(v,500);const up=new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion().copy(v.body.rotation()))
  expect(up.y).toBeGreaterThan(.5);expect(Number.isFinite(v.body.translation().y)).toBe(true);v.dispose();h.world.free()
 })
 it('holds low-speed braking and clears motor state on teleport',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false;h.step(v,150)
  v.body.setLinvel({x:1,y:0,z:1},true);v.input.brakes=true;h.step(v,20)
  expect(Math.abs(v.body.linvel().x)).toBeLessThan(.05);expect(Math.abs(v.body.linvel().z)).toBeLessThan(.05)
  v.teleport(new THREE.Vector3(0,10,0));expect(v.body.linvel().z).toBe(0);v.dispose();h.world.free()
 })
})
