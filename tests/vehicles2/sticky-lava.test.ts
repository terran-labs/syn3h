import {afterEach,beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {params} from '../../shared/params'
import {initPhysics} from '../../src/core/physics'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {waterSinking} from '../../src/vehicles/buoyancy'
import {ClassicBuggy} from '../../src/vehicles/ClassicBuggy'
import {Jet} from '../../src/vehicles/Jet'
import {Hovercraft} from '../../src/vehicles/Hovercraft'
import {Tank} from '../../src/vehicles/Tank'
import {harness} from './harness'
beforeAll(initPhysics)
afterEach(()=>{for(const p of params.all())params.set(p.def.id,p.def.default)})
const kinds=[Syn3hBuggy,ClassicBuggy,Jet,Hovercraft,Tank]
describe('indestructible viscous lava',()=>{
 it.each(kinds)('%s settles without skimming and can crawl',Kind=>{
  const h=harness();h.terrain.liquidHeightAt=()=>4;h.terrain.liquidKindAt=()=> 'lava'
  if(Kind===Hovercraft)params.set('hover.assist',0)
  const v=new Kind(h.game,h.terrain,new T.Vector3(0,3.5,0));v.isLocal=false;v.input.y=1;v.input.z=1
  v.body.setLinvel({x:0,y:0,z:-30},true)
  h.step(v);expect(v.body.linvel().z).toBeGreaterThan(-30);expect(v.body.linvel().z).toBeLessThan(-5)
  h.step(v,250)
  expect(v.body.translation().y).toBeCloseTo(3.55,1)
  expect(Math.abs(v.body.linvel().y)).toBeLessThan(.1)
  expect(Math.abs(v.body.linvel().z)).toBeLessThan(2)
  expect(v.lavaDepth).toBeGreaterThan(.3);expect(v.stuck).toBe(true)
  const z=v.body.translation().z;h.step(v,100);expect(v.body.translation().z).toBeLessThan(z-.1)
  expect(v.liquidState.heat).toBe(1)
  v.dispose();h.world.free()
 })
 it('hovercraft and hover jet remain free while above the surface',()=>{
  for(const Kind of [Hovercraft,Jet]){
   const h=harness();h.terrain.liquidHeightAt=()=>4;h.terrain.liquidKindAt=()=> 'lava'
   const v=new Kind(h.game,h.terrain,new T.Vector3(0,12,0));v.isLocal=false;h.step(v,100)
   expect(v.lavaDepth).toBe(0);expect(v.stuck).toBe(false);expect(v.liquidState.heat).toBe(0)
   v.dispose();h.world.free()
  }
 })
 it('legacy water keeps the buggy float/paddle behavior and produces no heat or sticky state',()=>{
  params.set(waterSinking.def.id,false)
  const h=harness();h.terrain.liquidHeightAt=()=>4;h.terrain.liquidKindAt=()=> 'water'
  const v=new Syn3hBuggy(h.game,h.terrain,new T.Vector3(0,4,0));v.isLocal=false;v.input.y=1;h.step(v,200)
  expect(v.liquidState.heat).toBe(0);expect(v.stuck).toBe(false);expect(v.lavaDepth).toBe(0)
  expect(v.body.translation().z).toBeLessThan(-8);v.liquidState.heat=1;v.teleport(new T.Vector3(0,3.5,0));h.step(v);expect(v.liquidState.heat).toBe(0);v.dispose();h.world.free()
 })
 it('missing liquid kind means lava and the coating cools after leaving it',()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>4
  const v=new Syn3hBuggy(h.game,h.terrain,new T.Vector3(0,3.5,0));v.isLocal=false;h.step(v,1)
  expect(v.liquidState.heat).toBe(1)
  h.terrain.liquidHeightAt=()=>-Infinity;v.teleport(new T.Vector3(0,2,0));h.step(v,500)
  expect(v.liquidState.heat).toBeCloseTo(.5,1);h.step(v,510);expect(v.liquidState.heat).toBe(0)
  v.dispose();h.world.free()
 })
})
