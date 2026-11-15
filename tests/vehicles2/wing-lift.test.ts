import {beforeAll,afterEach,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {params} from '../../shared/params'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {harness} from './harness'
beforeAll(initPhysics)
afterEach(()=>{for(const p of params.all())params.set(p.def.id,p.def.default)})
for(const [name,Kind] of [['syn3h',Syn3hBuggy]] as const)for(const liquid of ['lava','water'] as const){
 it(`${name} wings escape deep ${liquid}, retaining lava heat`,()=>{
  const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=>liquid
  const v=new Kind(h.game,h.terrain,new T.Vector3(0,7,0));v.isLocal=false
  try{
   h.step(v,100);expect(v.canLiftOut).toBe(true)
   v.input.special=true;let peak=-Infinity;for(let i=0;i<150;i++){h.step(v);peak=Math.max(peak,v.body.translation().y);if(Number.isFinite(v.liquidState.wingLiftSurface)){const velocity=v.body.linvel();expect(Math.hypot(velocity.x,velocity.z)).toBeLessThanOrEqual(6.01)}}
   expect(v.wingsOpen).toBe(true);expect(v.canLiftOut).toBe(false)
   expect(peak).toBeGreaterThan(16)
   expect(v.body.translation().y).toBeGreaterThan(11)
   expect(v.stuck).toBe(false)
   if(liquid==='water')expect(v.liquidState.heat).toBe(0)
   if(liquid==='lava')expect(v.liquidState.heat).toBeGreaterThan(.8)
   h.step(v,250);expect(v.body.translation().y).toBeGreaterThan(19);expect(v.body.translation().y).toBeLessThan(21)
   v.teleport(new T.Vector3(0,25,0));expect(v.liquidState.wingLiftSurface).toBe(-Infinity)
  }finally{v.dispose();h.world.free()}
 })
}
it('disabling wing escape leaves the closed-wing lava crawl unchanged and hides the hint',()=>{
 params.set('liquid.wingLift',0)
 const h=harness();h.terrain.liquidHeightAt=()=>4;h.terrain.liquidKindAt=()=> 'lava'
 const v=new Syn3hBuggy(h.game,h.terrain,new T.Vector3(0,3.5,0));v.isLocal=false
 try{h.step(v,200);expect(v.stuck).toBe(true);expect(v.canLiftOut).toBe(false);expect(v.body.translation().y).toBeCloseTo(3.55,1)}finally{v.dispose();h.world.free()}
})
