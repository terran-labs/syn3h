import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER, groups, GROUP_TERRAIN, GROUP_ALL } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { ClassicBuggy } from '../../src/vehicles/ClassicBuggy'
import { harness } from './harness'
beforeAll(initPhysics)
it.each([['syn3h', Syn3hBuggy], ['classic', ClassicBuggy]] as const)('%s paddles onto a nine degree beach and drives away', (_name, Vehicle) => {
 const h=harness(9.81,false),slope=Math.tan(9*Math.PI/180)
 h.terrain.heightAt=(_x,z)=>-z*slope
 h.terrain.liquidHeightAt=()=>0
 h.terrain.liquidKindAt=()=> 'water'
 h.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array([-100,100*slope,-100,100,100*slope,-100,-100,-100*slope,100,100,-100*slope,100]),new Uint32Array([0,2,1,1,2,3])).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
 const v=new Vehicle(h.game,h.terrain,new THREE.Vector3(0,0,20));v.isLocal=false
 try{
  h.step(v,100);v.input.y=1
  for(let i=0;i<1000;i++){h.step(v);if(v.body.translation().z < -12)break}
  const p=v.body.translation()
  expect(p.z).toBeLessThan(-12)
  expect(p.y).toBeGreaterThan(h.terrain.heightAt(p.x,p.z)+.3)
  expect(v.wheelsGrounded).toBeGreaterThanOrEqual(2)
  expect(v.liquidState.heat).toBe(0)
 }finally{v.dispose();h.world.free()}
})
