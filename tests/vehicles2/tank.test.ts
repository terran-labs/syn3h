import {beforeAll,describe,it,expect} from 'vitest'
import * as THREE from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Tank} from '../../src/vehicles/Tank'
import {harness} from './harness'
import {params} from '../../shared/params'
import {RAPIER,groups,GROUP_TERRAIN,GROUP_ALL} from '../../src/core/physics'
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
 it('rests its pods level with the hull and tucks them in the air',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,2,0));v.isLocal=false;h.step(v,400)
  const pods=v.object.children.slice(1)
  // TankTrack.prefab: a 1.37 m pod centred on the hull origin puts the ground 0.685 m below it.
  expect(v.body.translation().y).toBeCloseTo(.685,1);for(const pod of pods)expect(Math.abs(pod.position.y)).toBeLessThan(.05)
  v.teleport(new THREE.Vector3(0,100,0));h.step(v,50)
  for(const pod of pods){expect(pod.position.y).toBeLessThan(-.15);expect(pod.position.y).toBeGreaterThan(-.3)}
  v.dispose();h.world.free()
 })
 it('refuses a 60 degree face unless the climb limit is turned off',()=>{
  const climbed=(limit:number)=>{
   params.set('tank.climb',limit)
   const h=harness(),tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/3)
   // A ramp rising toward -Z (forward), its lower edge buried at z=-6.
   h.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.5,40).setTranslation(0,40*Math.sin(Math.PI/3)-.5,-6-40*Math.cos(Math.PI/3)).setRotation(tilt).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
   h.world.step()
   const v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false;h.step(v,100)
   v.input.y=1;h.step(v,400);const y=v.body.translation().y;v.dispose();h.world.free();return y
  }
  try{expect(climbed(45)).toBeLessThan(4);expect(climbed(90)).toBeGreaterThan(10)}finally{params.set('tank.climb',45)}
 })
})
