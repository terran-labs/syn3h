/**
 * The altitude readout is measured from what the vehicle stands on, not from its body: a
 * vehicle sitting on the ground reads 0 m (the owner's rule of 15 November 2026).
 */
import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {VEHICLE_KINDS,createVehicle} from '../../src/vehicles'
import {REST_HEIGHT} from '../../src/vehicles/Vehicle'
import {harness} from './harness'
beforeAll(initPhysics)

/** Let a vehicle come to rest on flat ground and return it with its origin height. */
function settle(kind:(typeof VEHICLE_KINDS)[number]['kind']){
 const h=harness(),v=createVehicle(h.game,h.terrain,kind,new T.Vector3(0,3,0),0);v.isLocal=false
 h.step(v,900)
 return {h,v,origin:v.body.translation().y}
}

describe('height above the surface',()=>{
 // The jet holds its height in hover mode with no input, so it never settles here: it is checked from its gear below.
 const SETTLES=VEHICLE_KINDS.map(k=>k.kind).filter(k=>k!=='jet')
 it.each(SETTLES)('%s reads 0 m at rest, and its recorded stance is current',kind=>{
  const {h,v,origin}=settle(kind)
  console.log(`rest height ${kind}: ${origin.toFixed(3)}`)
  expect(v.heightAboveSurface(),'parked').toBeLessThan(.08)
  // The stance table must match the vehicle as built. If this fails after a redesign, put the measured value in REST_HEIGHT.
  expect(Math.abs(origin-REST_HEIGHT[kind]),`measured ${origin.toFixed(3)} m`).toBeLessThan(.06)
  v.dispose();h.world.free()
 })
 it('the jet reads 0 m standing on its lowered gear',()=>{
  const h=harness(),v=createVehicle(h.game,h.terrain,'jet',new T.Vector3(0,REST_HEIGHT.jet,0),0)
  v.postPhysics(0);expect(v.heightAboveSurface()).toBeCloseTo(0,2)
  // The gear box in Jet.ts: centred 0.783 m under the origin, 0.5 m half height.
  expect(REST_HEIGHT.jet).toBeCloseTo(.783+.5,3)
  v.dispose();h.world.free()
 })
 it.each(VEHICLE_KINDS.map(k=>k.kind))('%s reads the gap when lifted, never below zero',kind=>{
  const {h,v}=settle(kind),origin=REST_HEIGHT[kind]
  v.teleport(new T.Vector3(0,origin+12,0),0);v.postPhysics(0)
  expect(v.heightAboveSurface()).toBeCloseTo(12,1)
  v.teleport(new T.Vector3(0,-5,0),0);v.postPhysics(0)
  expect(v.heightAboveSurface()).toBe(0)
  v.dispose();h.world.free()
 })
 it('measures from liquid only for what rides on it',()=>{
  const {h,v,origin}=settle('hovercraft'),b=settle('buggy')
  for(const t of [h.terrain,b.h.terrain])(t as {liquidHeightAt?:(x:number,z:number)=>number}).liquidHeightAt=()=>4
  v.teleport(new T.Vector3(0,origin+10,0),0);v.postPhysics(0)
  expect(v.heightAboveSurface()).toBeCloseTo(6,1)
  b.v.teleport(new T.Vector3(0,b.origin+10,0),0);b.v.postPhysics(0)
  expect(b.v.heightAboveSurface()).toBeCloseTo(10,1)
  v.dispose();b.v.dispose();h.world.free();b.h.world.free()
 })
 it('measures from the bottom of the ball in zorb mode',()=>{
  const {h,v}=settle('buggy')
  v.input.zorb=true;h.step(v,600)
  expect(v.zorbed).toBe(true);expect(v.heightAboveSurface()).toBeLessThan(.15)
  v.dispose();h.world.free()
 })
})
