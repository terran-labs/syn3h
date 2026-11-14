import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Jet, jetDrag } from '../../src/vehicles/Jet'
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
})
