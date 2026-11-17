import {beforeAll,describe,it,expect} from 'vitest'
import * as THREE from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Tank} from '../../src/vehicles/Tank'
import {previewTankBody} from '../../src/vehicles/tankDesigns/preview'
import {mergedSurfaces} from '../../src/vehicles/skins/mergeStatic'
import {harness} from './harness'
import {params} from '../../shared/params'
import {RAPIER,groups,GROUP_TERRAIN,GROUP_ALL} from '../../src/core/physics'
beforeAll(initPhysics)
describe('Sherpa tank with six shape casts',()=>{
 it('starts in the shared player palette and repaints existing surfaces without rebuilding',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,2,0))
  try {
   const hull=v.object.getObjectByName('Hull and cabin') as THREE.Mesh
   const packed=hull.material as THREE.Material
   const surfaces=mergedSurfaces.get(packed)!
   const paint=surfaces.find(m=>m.userData.showroom==='paint') as THREE.MeshStandardMaterial
   const accent=surfaces.find(m=>m.userData.showroom==='accent') as THREE.MeshStandardMaterial
   const canopy=(v.object.getObjectByName('Cabin windows') as THREE.Mesh).material as THREE.MeshStandardMaterial
   expect(paint.color.getHexString()).toBe(v.colors.body.slice(1))
   expect(accent.color.getHexString()).toBe(v.colors.accent.slice(1))
   const geometry=hull.geometry
   for(const [body,trim] of [['#b42632','#49e6ff'],['#1768b4','#e9f4ff']]) {
    v.setColors(body,trim)
    expect(paint.color.getHexString()).toBe(body.slice(1))
    expect(accent.color.getHexString()).toBe(trim.slice(1))
    expect(accent.emissive.getHexString()).toBe(trim.slice(1))
    expect(canopy.color.getHexString()).toBe(trim.slice(1))
    expect(hull.geometry).toBe(geometry);expect(hull.material).toBe(packed)
    expect(v.object.userData.ownLamps).toBe(true)
   }
   expect(canopy.userData.showroom).toBe('canopy')
   expect(canopy.forceSinglePass).toBe(true)
  } finally {v.dispose();h.world.free()}
 })
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
  const pods=Array.from(v.podLift)
  // TankTrack.prefab: a 1.37 m pod centred on the hull origin puts the ground 0.685 m below it.
  expect(v.body.translation().y).toBeCloseTo(.685,1);for(const lift of pods)expect(Math.abs(lift)).toBeLessThan(.05)
  v.teleport(new THREE.Vector3(0,100,0));h.step(v,50)
  for(const lift of v.podLift){expect(lift).toBeLessThan(-.15);expect(lift).toBeGreaterThan(-.3)}
  v.dispose();h.world.free()
 })
 it('wears a generated body with a cockpit, and swaps bodies in place',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new THREE.Vector3(0,2,0));v.isLocal=false;h.step(v,300)
  const meshes=()=>{const out:THREE.Mesh[]=[];v.object.traverse(o=>{if(o instanceof THREE.Mesh)out.push(o)});return out}
  try{
   // Normal entry must suppress the shared floating lamp spheres too.
   expect(v.object.userData.ownLamps).toBe(true)
   expect(v.object.userData.cockpit).toBe(true)
   previewTankBody('r8-dart')
   // A generated design: its own lamps, a cabin to sit in, the eye inside the hull.
   expect(v.object.userData.cockpit).toBe(true);expect(v.object.userData.ownLamps).toBe(true)
   expect(v.ridePosition.position.y).toBeGreaterThan(.6);expect(Math.abs(v.ridePosition.position.z)).toBeLessThan(2)
   const first=meshes().length;expect(first).toBeGreaterThan(0)
   // The model stands on the ground the physics rests on.
   v.update(0,1);v.object.updateMatrixWorld(true)
   const hull=meshes().find(m=>m.name==='Hull and cabin')!,box=new THREE.Box3().setFromObject(hull)
   expect(box.min.y).toBeGreaterThan(.3);expect(box.max.z-box.min.z).toBeGreaterThan(5)
   const height=v.body.translation().y
   previewTankBody('r8-wasp');expect(meshes().length).toBe(first);expect(v.body.translation().y).toBe(height)
   h.step(v,100);expect(v.groundedTracks).toBe(6);expect(v.body.mass()).toBeCloseTo(241)
   // No study id wears the shipped Sherpa again: always a generated body, never a model file.
   previewTankBody(null);expect(meshes().length).toBeGreaterThan(0);expect(v.object.userData.cockpit).toBe(true)
   h.step(v,100);expect(v.groundedTracks).toBe(6)
  }finally{previewTankBody()}
  v.dispose();h.world.free()
 })
 it('tilts each pod to the ground under it and runs its belt with the ground',()=>{
  const h=harness(),slope=.2,tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),slope)
  // A ramp rising toward -Z (forward) out of the flat floor, its foot at z=-3.
  h.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.5,10).setTranslation(0,10*Math.sin(slope)-.5*Math.cos(slope),-3-10*Math.cos(slope)-.5*Math.sin(slope)).setRotation(tilt).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
  h.world.step()
  const v=new Tank(h.game,h.terrain,new THREE.Vector3(0,1.2,5));v.isLocal=false;h.step(v,200)
  const rock=(v as unknown as {podRock:Float32Array}).podRock,run=(v as unknown as {podRun:Float64Array}).podRun
  for(const r of rock)expect(Math.abs(r)).toBeLessThan(.02)
  // As the front axle meets the ramp its pods pitch nose up while the rear ones are still flat.
  let front=0,rear=0
  v.input.y=1
  for(let i=0;i<150;i++){h.step(v);if(rock[0]>front){front=rock[0];rear=Math.abs(rock[4])}}
  expect(front).toBeGreaterThan(.05);expect(rear).toBeLessThan(front*.6)
  // Forward travel runs every belt forward by about the distance covered.
  const travelled=5-v.body.translation().z;expect(travelled).toBeGreaterThan(3)
  for(const r of run){expect(r).toBeGreaterThan(travelled*.6);expect(r).toBeLessThan(travelled*1.4)}
  v.dispose();h.world.free()
 })
})
