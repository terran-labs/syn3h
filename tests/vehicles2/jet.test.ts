import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Jet, JET_LIFT_KEYS, jetDrag, jetFlightThrust, jetHoverHold, jetVectorResponse } from '../../src/vehicles/Jet'
import { harness } from './harness'

beforeAll(initPhysics)
describe('Jet hover and flight',()=>{
 it('uses Syn3h drag and smoothed controls',()=>{const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,30,0));v.isLocal=false;v.input.z=1;h.step(v);expect(jetDrag.value).toBe(.0001);expect(v.body.linvel().y).toBeLessThan(0);h.step(v,30);expect(v.body.linvel().y).toBeGreaterThan(0);v.dispose();h.world.free()})
 it('starts in hover mode and half throttle balances its weight',()=>{
  const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,30,0));v.isLocal=false;v.input.z=.5
  expect(v.hoverMode).toBe(true);expect(v.body.mass()).toBeCloseTo(200)
  h.step(v,100);expect(Math.abs(v.body.linvel().y)).toBeLessThan(1)
  v.input.z=1;h.step(v,10);expect(v.body.linvel().y).toBeGreaterThan(0)
  v.dispose();h.world.free()
 })
 it('flies toward -Z and brakes cut main thrust',()=>{
  const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,100,0));v.isLocal=false;v.input.special=true;v.input.z=1
  h.step(v);expect(v.hoverMode).toBe(false);expect(v.body.linvel().z).toBeLessThan(0)
  v.body.setLinvel({x:0,y:0,z:0},true);v.input.brakes=true;h.step(v)
  expect(v.body.linvel().z).toBeCloseTo(0)
  v.dispose();h.world.free()
 })
 it('has correct hover yaw direction and density falls with altitude',()=>{
  const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,100,0));v.isLocal=false;v.input.w=1
  h.step(v);expect(v.body.angvel().y).toBeLessThan(0)
  v.input.special=true;h.step(v);const low=v.atmosDensity
  v.teleport(new THREE.Vector3(0,6000,0));h.step(v);expect(v.atmosDensity).toBeLessThan(low)
  v.dispose();h.world.free()
 })
 it('stalls at low speed and reduces a downward flight velocity with lift',()=>{
  const h=harness(0,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,100,0));v.isLocal=false;v.input.special=true
  h.step(v);expect(v.stallFactor).toBe(1)
  v.body.setLinvel({x:0,y:-2,z:-40},true);h.step(v)
  expect(v.stallFactor).toBe(0);expect(v.body.linvel().y).toBeGreaterThan(-2)
  v.dispose();h.world.free()
 })
 it('remains finite through sustained mode changes and has no legacy buoyancy',()=>{
  const h=harness(0,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,-21,0));v.isLocal=false
  h.step(v);expect(v.body.linvel().y).toBeCloseTo(0)
  v.teleport(new THREE.Vector3(0,100,0));v.input.z=.5
  for(let i=0;i<10;i++){v.input.special=!v.input.special;v.input.x=.2;h.step(v,50)}
  expect([...v.getState().p,...v.getState().q,...v.getState().v].every(Number.isFinite)).toBe(true)
  v.dispose();h.world.free()
 })
 it('flight thrust defaults to the prefab factor and a lower setting accelerates less',()=>{
  expect(jetFlightThrust.value).toBe(2)
  const run=()=>{const h=harness(9.81,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,500,0));v.isLocal=false;v.input.special=true;v.input.z=1
   h.step(v,100);const s=-v.body.linvel().z;v.dispose();h.world.free();return s}
  const full=run();jetFlightThrust.value=1
  try{const half=run();expect(half).toBeGreaterThan(0);expect(half).toBeLessThan(full*.7)}
  finally{jetFlightThrust.value=2}
 })
 it('thrust vectoring steers below stall speed in pitch and yaw, and its slider scales it',()=>{
  expect(jetVectorResponse.value).toBe(.3)
  // 12 m/s is under the 20 m/s stall speed, where the wings have little authority.
  const rate=(axis:'y'|'w',vector:number)=>{jetVectorResponse.value=vector
   const h=harness(9.81,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,500,0));v.isLocal=false;v.input.special=true;v.input.z=1
   h.step(v,2);v.body.setLinvel({x:0,y:0,z:-12},true);v.body.setAngvel({x:0,y:0,z:0},true);v.input[axis]=-1;h.step(v,50)
   const w=v.body.angvel(),r=Math.hypot(w.x,w.y,w.z)*180/Math.PI;v.dispose();h.world.free();return r}
  try{const pitch=rate('y',.3),yaw=rate('w',.3)
   expect(pitch).toBeGreaterThan(30);expect(yaw).toBeGreaterThan(8)
   expect(rate('y',1)).toBeGreaterThan(pitch*2);expect(rate('w',1)).toBeGreaterThan(yaw*2)}
  finally{jetVectorResponse.value=.3}
 })
 it('hover hold lets go near the ground so a landed jet keeps its weight',()=>{
  const h=harness(9.81,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,1.4,0));v.isLocal=false
  h.step(v,25);expect(v.body.linvel().y).toBeLessThan(-3)
  v.dispose();h.world.free()
 })
 it('hover hold is on by default, holds altitude with no throttle key, and 0 restores the original fall',()=>{
  expect(jetHoverHold.value).toBe(1)
  const h=harness(9.81,false);const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,100,0));v.isLocal=false
  jetHoverHold.value=0
  try{h.step(v,50);expect(v.body.linvel().y).toBeLessThan(-5)
   jetHoverHold.value=1
   h.step(v,250);expect(Math.abs(v.body.linvel().y)).toBeLessThan(.5)
   const y=v.body.translation().y;h.step(v,100);expect(Math.abs(v.body.translation().y-y)).toBeLessThan(1)
   v.input.z=1;h.step(v,25);expect(v.body.linvel().y).toBeGreaterThan(0)}
  finally{jetHoverHold.value=1;v.dispose();h.world.free()}
 })
 it('landing gear holds a resting jet up and its collider follows the gear when it retracts',()=>{
  const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,2.5,0));v.isLocal=false
  // Hover mode lowers the gear in one second; the hold lets go near the ground, so the jet lands.
  h.step(v,400);const onGear=v.body.translation().y
  expect(Math.abs(v.body.linvel().y)).toBeLessThan(.05)
  // At rest the gear is not moving: the jet must not creep sideways on a level floor.
  const x=v.body.translation().x,z=v.body.translation().z;h.step(v,200)
  expect(Math.hypot(v.body.translation().x-x,v.body.translation().z-z)).toBeLessThan(.05)
  // Flight mode with no throttle raises the gear, and the hull settles lower.
  v.input.special=true;h.step(v,400)
  expect(v.body.translation().y).toBeLessThan(onGear-.3)
  // Back to hover: the gear comes down again and lifts the hull back to where it stood.
  v.input.special=false;h.step(v,400)
  expect(v.body.translation().y).toBeCloseTo(onGear,1)
  v.dispose();h.world.free()
 })
 it('Q and E lift, lower and throttle the player\'s own jet, and no longer yaw it',()=>{
  expect(JET_LIFT_KEYS).toBe(1)
  const keys=new Set<string>()
  const fly=(special:boolean,held:string[],setup?:(v:Jet,input:{w:number;z:number;special:boolean})=>void)=>{
   const h=harness(9.81,false);const state=(h.game.input as unknown as {state:{w:number;z:number;special:boolean}}).state
   ;(h.game.input as unknown as {held:(code:string)=>boolean}).held=code=>keys.has(code)
   const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,300,0));state.special=special
   // The player's own jet takes its input from the game; the shared input puts Q and E on w.
   keys.clear();held.forEach(k=>keys.add(k));state.w=(keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0);setup?.(v,state)
   h.step(v,60);const out={vy:v.body.linvel().y,vz:v.body.linvel().z,yaw:v.body.angvel().y,sent:v.getState().input};v.dispose();h.world.free();return out}
  // Hover: E climbs, Q descends faster than the altitude hold allows, and neither turns the jet.
  const up=fly(false,['KeyE']),down=fly(false,['KeyQ']),none=fly(false,[])
  expect(up.vy).toBeGreaterThan(3);expect(down.vy).toBeLessThan(none.vy-3)
  // Exactly what R and F do, turn included: the keys' own yaw is gone.
  const r=fly(false,[],(_v,s)=>{s.z=1}),f=fly(false,[],(_v,s)=>{s.z=-1})
  expect(up.vy).toBeCloseTo(r.vy,4);expect(up.yaw).toBeCloseTo(r.yaw,5);expect(down.vy).toBeCloseTo(f.vy,4);expect(down.yaw).toBeCloseTo(f.yaw,5)
  // Other players are sent what was flown: thrust on z, nothing on yaw.
  expect(up.sent.z).toBe(1);expect(up.sent.w).toBe(0)
  // Flight: E is forward thrust, exactly as R is.
  const thrustE=fly(true,['KeyE']),thrustR=fly(true,[],(_v,s)=>{s.z=1})
  expect(thrustE.vz).toBeLessThan(-5);expect(thrustE.vz).toBeCloseTo(thrustR.vz,3)
  // R and F still work, and a gamepad's yaw stick still yaws when Q and E are up.
  const pad=fly(false,[],(_v,s)=>{s.w=.8})
  expect(Math.abs(pad.yaw)).toBeGreaterThan(.05)
  // A bot's jet is not the player's: its pilot keeps w as yaw whatever keys are down.
  const h=harness(9.81,false);(h.game.input as unknown as {held:(code:string)=>boolean}).held=()=>true
  const bot=new Jet(h.game,h.terrain,new THREE.Vector3(0,300,0));bot.isLocal=false;bot.input.w=1;h.step(bot,30)
  expect(Math.abs(bot.body.angvel().y)).toBeGreaterThan(.05);expect(bot.input.w).toBe(1)
  bot.dispose();h.world.free()
 })
 it('opts out of shared lamp blobs because the Mk2 has no lamp fittings',()=>{
  const h=harness();const v=new Jet(h.game,h.terrain,new THREE.Vector3(0,30,0));v.isLocal=false
  expect(v.object.userData.ownLamps).toBe(true)
  v.dispose();h.world.free()
 })
})
