import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {createVehicle} from '../../src/vehicles'
import {Vehicle} from '../../src/vehicles/Vehicle'
import {harness} from './harness'
beforeAll(initPhysics)
/** The Moon planet sets world.gravity to about 0.3 g. Earth is the control. */
const GRAVITIES:[string,number][]=[['Earth',9.81],['Moon',2.94]]

describe.each(GRAVITIES)('shared vehicle behaviour under %s gravity',(_name,g)=>{
 it('a vehicle put under the ground is back on it one step later and stays there',()=>{
  for(const kind of ['buggy','jet','hovercraft','tank'] as const){
   const h=harness(g),v=createVehicle(h.game,h.terrain,kind,new T.Vector3(0,2,0),0);v.isLocal=false
   try{h.step(v,80);const p=v.body.translation();v.body.setTranslation({x:p.x,y:-2.5,z:p.z},true);v.body.setLinvel({x:0,y:-6,z:-40},true)
    h.step(v);expect(v.body.translation().y,`${kind} one step later`).toBeGreaterThan(0)
    let low=Infinity;for(let i=0;i<150;i++){h.step(v);low=Math.min(low,v.body.translation().y)}
    expect(low,`${kind} afterwards`).toBeGreaterThan(-.3)}finally{v.dispose();h.world.free()}
  }
 })
 it('wings lift a buggy clear of water and hold it about ten metres up',()=>{
  const h=harness(g);h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>'water'
  const v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,9.5,0),0);v.isLocal=false
  try{h.step(v,100);v.input.special=true
   let clearAt=-1,peak=-Infinity;for(let i=0;i<400;i++){h.step(v);const y=v.body.translation().y;if(clearAt<0&&y>11)clearAt=i;if(i>250)peak=Math.max(peak,y)}
   // Clear of the surface by a metre within a second, then held near the field's height, not drifting off.
   expect(clearAt).toBeGreaterThan(-1);expect(clearAt*.02).toBeLessThan(1)
   expect(peak).toBeGreaterThan(18);expect(peak).toBeLessThan(22)}finally{v.dispose();h.world.free()}
 })
 it('a buggy stuck on its roof is set upright after three seconds',()=>{
  const h=harness(g),v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,1.2,0),0);v.isLocal=true
  try{v.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI*.97),true)
   // Low gravity means a longer settle before it is slow enough to count as stuck.
   h.step(v,Math.round((Vehicle.STUCK_SECONDS+6)/.02))
   const r=v.body.rotation(),upY=1-2*(r.x*r.x+r.z*r.z);expect(upY).toBeGreaterThan(.7)}finally{v.dispose();h.world.free()}
 })
})
