import { beforeAll, afterEach, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { Tank } from '../../src/vehicles/Tank'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { Jet } from '../../src/vehicles/Jet'
import { harness } from '../vehicles2/harness'
import { ZORB_FLOAT_DEPTH } from '../../src/vehicles/zorb'
import { waterSinking, applyWaterForces } from '../../src/vehicles/buoyancy'
beforeAll(initPhysics)
afterEach(()=>{waterSinking.value=waterSinking.def.default})
function setup(){
 waterSinking.value=true
 const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=> 'water'
 return h
}
it('syn3h stays up while it paddles and sinks to the bed when it stops',()=>{
 const h=setup(),v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,10.2,0));v.isLocal=false
 try{
  v.input.y=1;const z=v.body.translation().z;h.step(v,300)
  expect(Math.abs(v.body.translation().y-10)).toBeLessThan(1)
  expect(new THREE.Vector3(0,1,0).applyQuaternion(v.object.quaternion).y).toBeGreaterThan(.9)
  expect(v.body.translation().z).toBeLessThan(z-2)
  v.input.y=0;h.step(v,600)
  expect(v.body.translation().y).toBeLessThan(9)
 }finally{v.dispose();h.world.free()}
})
it('switch off retains the legacy float',()=>{
 const h=setup();waterSinking.value=false
 const v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,9,0));v.isLocal=false
 try{h.step(v,900);expect(v.body.translation().y).toBeGreaterThan(9)}finally{v.dispose();h.world.free()}
})
// Isolated rigid bodies distinguish hydrodynamic forces from each vehicle controller.
function bodyTrial(kind:string,y:number,seconds:number,speed=0,flow=0,radius=0){
 const h=setup();h.terrain.liquidFlowAt=(_x,_z,out)=>{out.x=flow;out.z=0;return out}
 const b=h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,y,0))
 h.world.createCollider(RAPIER.ColliderDesc.cuboid(.8,.5,1.2),b)
 b.setLinvel({x:0,y:0,z:speed},true)
 for(let i=0;i<seconds*60;i++){
  b.resetForces(true);b.resetTorques(true)
  // Maintain forward speed as a driven hull would, to measure steady planing support.
  if(speed)b.addForce({x:0,y:0,z:(speed-b.linvel().z)*b.mass()*10},true)
  applyWaterForces(b,h.world,h.terrain,kind,1/60,radius)
  h.world.step()
 }
 const result={p:b.translation(),v:b.linvel()};h.world.free();return result
}
it('buggy at 12 m/s planes near the surface',()=>{expect(bodyTrial('buggy',10,15,12).p.y).toBeGreaterThan(9.3)})
it('tank plunges to the bed',()=>{expect(bodyTrial('tank',10,15).p.y).toBeLessThan(1)})
it('sealed field floats on its base',()=>{expect(bodyTrial('zorb',5,20,0,0,2).p.y).toBeCloseTo(10+2-ZORB_FLOAT_DEPTH,0)})
it('river current carries a submerged hull downstream',()=>{
 const result=bodyTrial('buggy',5,6,0,3)
 expect(result.p.x).toBeGreaterThan(5);expect(result.v.x).toBeGreaterThan(1)
})

it.each([['tank',Tank],['hovercraft',Hovercraft],['jet',Jet]] as const)('%s controller stays finite in deep water',(kind,Kind)=>{
 const h=setup(),v=new Kind(h.game,h.terrain,new THREE.Vector3(0,9,0));v.isLocal=false
 try{
  h.step(v,900)
  const p=v.body.translation(),speed=v.body.linvel()
  expect([p.x,p.y,p.z,speed.x,speed.y,speed.z].every(Number.isFinite)).toBe(true)
  if(kind==='tank')expect(p.y).toBeLessThan(3)
  if(kind==='hovercraft')expect(p.y).toBeGreaterThan(8)
 }finally{v.dispose();h.world.free()}
})

it('actual zorbed buggy floats in the shared model and follows current',()=>{
 const h=setup();h.terrain.liquidFlowAt=(_x,_z,out)=>{out.x=3;out.z=0;return out}
 const v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,6,0));v.isLocal=false;v.input.zorb=true
 try{
  h.step(v,1800)
  expect(v.zorb.active).toBe(true)
  expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(10+v.zorb.radius-ZORB_FLOAT_DEPTH,0)
  expect(v.body.translation().x).toBeGreaterThan(10)
 }finally{v.dispose();h.world.free()}
})
