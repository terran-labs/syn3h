import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER, groups, GROUP_TERRAIN, GROUP_ALL } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { ClassicBuggy } from '../../src/vehicles/ClassicBuggy'
import { Tank } from '../../src/vehicles/Tank'
import { harness } from './harness'
beforeAll(initPhysics)
it.each([['syn3h',Syn3hBuggy],['classic',ClassicBuggy],['tank',Tank]] as const)('%s hands lava crawl back to ground drive on a beach', (_name, Vehicle) => {
 const h=harness(9.81,false),slope=Math.tan(9*Math.PI/180)
 h.terrain.heightAt=(_x,z)=>-z*slope
 h.terrain.liquidHeightAt=()=>0
 h.terrain.liquidKindAt=(_x,z)=>z>0?'lava':null
 h.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array([-100,100*slope,-100,100,100*slope,-100,-100,-100*slope,100,100,-100*slope,100]),new Uint32Array([0,2,1,1,2,3])).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
 const v=new Vehicle(h.game,h.terrain,new THREE.Vector3(0,-.4,3));v.isLocal=false;v.input.y=1
 try{
  let touchedLava=false,leftLava=false,exitZ=Infinity
  for(let i=0;i<1600;i++){
   h.step(v);touchedLava ||= v.lavaDepth>0
   if(touchedLava&&v.body.translation().z<0&&!leftLava){leftLava=true;exitZ=v.body.translation().z}
   if(leftLava&&v.body.translation().z<exitZ-8)break
  }
  expect(touchedLava).toBe(true);expect(leftLava).toBe(true)
  expect(v.body.translation().z).toBeLessThan(exitZ-8)
  expect(v.lavaDepth).toBe(0);expect(v.stuck).toBe(false)
 }finally{v.dispose();h.world.free()}
})
