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
 it('open wings float a sunk buggy to the surface and no higher',()=>{
  const h=harness(g);h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>'water'
  const v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,2,0),0);v.isLocal=false
  try{v.input.special=true
   let peak=-Infinity;for(let i=0;i<1500;i++){h.step(v);peak=Math.max(peak,v.body.translation().y)}
   // Floating, not flying: only the rise's momentum carries it past the surface.
   expect(Math.abs(v.body.translation().y-10)).toBeLessThan(1);expect(peak).toBeLessThan(12)}finally{v.dispose();h.world.free()}
 })
 it('a buggy stuck on its roof is set upright after three seconds',()=>{
  const h=harness(g),v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,1.2,0),0);v.isLocal=true
  try{v.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI*.97),true)
   // Low gravity means a longer settle before it is slow enough to count as stuck.
   h.step(v,Math.round((Vehicle.STUCK_SECONDS+6)/.02))
   const r=v.body.rotation(),upY=1-2*(r.x*r.x+r.z*r.z);expect(upY).toBeGreaterThan(.7)}finally{v.dispose();h.world.free()}
 })
})
