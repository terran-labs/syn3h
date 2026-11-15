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
 it('wings push a nose-up buggy clear of water along its nose',()=>{
  const h=harness(g);h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>'water'
  const v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,9.5,0),0);v.isLocal=false
  try{h.step(v,100);v.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),20*Math.PI/180),true);v.input.special=true
   let clearAt=-1,peak=-Infinity,clearZ=0;for(let i=0;i<400;i++){h.step(v);const y=v.body.translation().y;if(clearAt<0&&y>11){clearAt=i;clearZ=-v.body.translation().z};if(i>250)peak=Math.max(peak,y)}
   // Owner, 15 November 2026: "Tapping spacebar to lift out of water or lava shouldn't automatically hover me straight up. It should instead push me in whatever direction my vehicle is facing."
   // Was: level buggy clear by a metre within 1 s, then held 18 to 22 m up by the field. Now raised 20 degrees: clear within 3 s, moving forward more than up, and not held at the old field height.
   expect(clearAt).toBeGreaterThan(-1);expect(clearAt*.02).toBeLessThan(3)
   expect(clearZ).toBeGreaterThan(1)
   expect(peak).toBeLessThan(18)}finally{v.dispose();h.world.free()}
 })
 it('a buggy stuck on its roof is set upright after three seconds',()=>{
  const h=harness(g),v=createVehicle(h.game,h.terrain,'buggy',new T.Vector3(0,1.2,0),0);v.isLocal=true
  try{v.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI*.97),true)
   // Low gravity means a longer settle before it is slow enough to count as stuck.
   h.step(v,Math.round((Vehicle.STUCK_SECONDS+6)/.02))
   const r=v.body.rotation(),upY=1-2*(r.x*r.x+r.z*r.z);expect(upY).toBeGreaterThan(.7)}finally{v.dispose();h.world.free()}
 })
})
