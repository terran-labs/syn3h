import {beforeAll,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {ClassicBuggy} from '../../src/vehicles/ClassicBuggy'
import {harness} from './harness'
beforeAll(initPhysics)
for(const [name,Kind] of [['syn3h',Syn3hBuggy],['classic',ClassicBuggy]] as const){
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
 it(`${name} lifts, releases into wing flight, then crosses 200 metres of open water`,()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=> 'water'
  const v=new Kind(h.game,h.terrain,new T.Vector3(0,9.5,0));v.isLocal=false
  try{
   h.step(v,100);v.input.special=true;v.input.y=1
   let released=false,releaseZ=0,releaseHeight=0
   for(let i=0;i<600;i++){h.step(v);if(v.body.translation().y>18&&!Number.isFinite(v.liquidState.wingLiftSurface)){released=true;releaseZ=v.body.translation().z;releaseHeight=v.body.translation().y;break}}
   console.log(name,"release",released,v.body.translation(),v.body.rotation(),v.body.linvel(),v.liquidState);expect(released).toBe(true);v.input.y=0
   let low=Infinity
   for(let i=0;i<1000;i++){h.step(v);low=Math.min(low,v.body.translation().y);expect(v.liquidState.wingLiftSurface).toBe(-Infinity);if(v.body.translation().z<releaseZ-200)break}
   console.log(name,'flight',releaseHeight,low,releaseZ-v.body.translation().z)
   expect(v.body.translation().z).toBeLessThan(releaseZ-200);expect(low).toBeGreaterThan(10.25)
  }finally{v.dispose();h.world.free()}
 })
}
