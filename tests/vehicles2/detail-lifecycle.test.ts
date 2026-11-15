import {beforeAll,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics,FIXED_DT} from '../../src/core/physics'
import {params} from '../../shared/params'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {registerVehicleDetail} from '../../src/vehicles/skins/mergeStatic'
import {harness} from './harness'

beforeAll(initPhysics)
it('drops eight detail callbacks before removing their Rapier bodies in the same tick',()=>{
 const h=harness(),previous=params.get('gfx.level')!.value
 const vehicles=Array.from({length:8},(_,i)=>new Syn3hBuggy(h.game,h.terrain,new T.Vector3(i*6,2,0)))
 let calls=0
 try{
  params.set('gfx.level',2)
  const detach=vehicles.map(v=>registerVehicleDetail(v.object,()=>{expect(v.body.isValid()).toBe(true);calls++}))
  for(const v of vehicles){v.isLocal=false;v.fixedUpdate(FIXED_DT)}
  h.world.step()
  for(const v of vehicles){v.postPhysics(FIXED_DT);v.update(FIXED_DT,1)}
  expect(calls).toBe(8)
  params.set('gfx.level',1)
  for(const v of vehicles){v.update(FIXED_DT,1);v.dispose()}
  expect(calls).toBe(16)
  // An already queued visual update must not call a detail closure after disposal.
  for(const v of vehicles){v.update(FIXED_DT,1);expect(v.body.isValid()).toBe(false)}
  detach.forEach(fn=>fn())
  h.world.step()
  expect(calls).toBe(16)
  expect(h.world.bodies.len()).toBe(0)
 }finally{params.set('gfx.level',previous);h.world.free()}
})
