import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER } from '../../src/core/physics'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { harness } from './harness'

import { params } from '../../shared/params'
beforeAll(initPhysics)
beforeEach(()=>params.set('hover.assist',0))
afterEach(()=>params.set('hover.assist',1))
describe('Hovercraft original forces',()=>{
 it('has original mass, center of mass and inertia',()=>{
  const h=harness(); const v=new Hovercraft(h.game,h.terrain,new THREE.Vector3(0,10,0))
  expect(v.body.mass()).toBeCloseTo(50); expect(v.body.localCom().y).toBeCloseTo(-.3)
  expect(v.body.principalInertia().x).toBeCloseTo(15)
  expect(v.body.collider(0).translation().y-v.body.translation().y).toBeCloseTo(.4)
  v.dispose(); h.world.free()
 })
 it('drives toward -Z and steers right with negative Y torque',()=>{
  const h=harness(0,false); const v=new Hovercraft(h.game,h.terrain,new THREE.Vector3(0,100,0)); v.isLocal=false
  v.input.y=1; v.input.x=1; h.step(v)
  expect(v.body.linvel().z).toBeLessThan(0); expect(v.body.angvel().y).toBeLessThan(0)
  v.dispose(); h.world.free()
 })
 it('does not reverse thrust and brakes low speeds to zero',()=>{
  const h=harness(0,false);const v=new Hovercraft(h.game,h.terrain,new THREE.Vector3(0,100,0));v.isLocal=false
  v.input.y=-1;h.step(v);expect(v.body.linvel().z).toBeCloseTo(0)
  v.input.y=0;v.input.brakes=true;v.body.setLinvel({x:1,y:0,z:0},true);h.step(v)
  expect(v.body.linvel().x).toBeCloseTo(0)
  v.dispose();h.world.free()
 })
 it('settles above ground and ducks beneath an overhang',()=>{
  const h=harness();const v=new Hovercraft(h.game,h.terrain,new THREE.Vector3(0,8,0));v.isLocal=false
  h.step(v,1200);const cruise=v.body.translation().y
  expect(cruise).toBeGreaterThan(8);expect(cruise).toBeLessThan(13)
  h.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.2,20).setTranslation(0,cruise+3,0));h.world.step()
  h.step(v,100);expect(v.body.translation().y).toBeLessThan(cruise)
  expect(Number.isFinite(v.body.rotation().w)).toBe(true)
  v.dispose();h.world.free()
 })
})
