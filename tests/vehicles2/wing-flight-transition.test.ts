import {beforeAll,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {harness} from './harness'
beforeAll(initPhysics)
for(const [name,Kind] of [['syn3h',Syn3hBuggy]] as const){
 it(`${name} retains speed on a fast wings-open water touch`,()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=> 'water'
  const v=new Kind(h.game,h.terrain,new T.Vector3(0,15,0));v.isLocal=false;v.input.special=true
  try{
   h.step(v,40);v.body.setTranslation({x:0,y:9.95,z:0},true);v.body.setRotation(new T.Quaternion(),true);v.body.setAngvel({x:0,y:0,z:0},true);v.body.setLinvel({x:0,y:-2,z:-32},true)
   let slowest=Infinity
   for(let i=0;i<25;i++){h.step(v);slowest=Math.min(slowest,Math.hypot(v.body.linvel().x,v.body.linvel().z));expect(v.liquidState.wingLiftSurface).toBe(-Infinity)}
   console.log(name,'skip minimum',slowest)
   expect(slowest).toBeGreaterThan(24)
  }finally{v.dispose();h.world.free()}
 })
}
