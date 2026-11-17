import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics,FIXED_DT,createWorld,GROUP_ALL,GROUP_TERRAIN,groups,RAPIER} from '../../src/core/physics'
import {emptyInput} from '../../src/core/Input'
import type {Game,System} from '../../src/core/Game'
import type {Terrain} from '../../src/world/Terrain'
import {createVehicle,isVehicleAvailable,type VehicleKind} from '../../src/vehicles'
import {PlayerSlot} from '../../src/vehicles/PlayerSlot'
import {SWAP_CLEARANCE,createVehicleSwapper} from '../../src/vehicles/swap'
import {REST_HEIGHT} from '../../src/vehicles/Vehicle'
import type {Vehicle} from '../../src/vehicles/Vehicle'
import {Materialize} from '../../src/vehicles/effects/Materialize'
beforeAll(initPhysics)

/** A flat world with the parts of Game the vehicles, their effects and the swap use. */
function world(){
 const physics=createWorld(9.81)
 physics.createCollider(RAPIER.ColliderDesc.cuboid(500,.5,500).setTranslation(0,-.5,0).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
 const systems:System[]=[],camera=new T.PerspectiveCamera();camera.position.set(0,12,30)
 const game={world:physics,scene:new T.Scene(),camera,renderer:{toneMappingExposure:1},input:{state:emptyInput()},
  add<S extends System>(s:S){systems.push(s);return s},remove(s:System,dispose=true){const i=systems.indexOf(s);if(i>=0)systems.splice(i,1);if(dispose)s.dispose?.()}} as unknown as Game
 const terrain={size:1000,heightAt:()=>0,normalAt:(_x:number,_z:number,out:T.Vector3)=>out.set(0,1,0),spawnPoint:()=>({position:new T.Vector3(0,2,0),heading:0}),dispose(){}} as unknown as Terrain
 physics.step()
 const step=(n=1)=>{for(let i=0;i<n;i++){for(const s of [...systems])s.fixedUpdate?.(FIXED_DT);physics.step();for(const s of [...systems])s.postPhysics?.(FIXED_DT);for(const s of [...systems])s.update?.(FIXED_DT,1)}}
 return {physics,game,terrain,systems,step}
}
/** Everything a vehicle can leave behind. */
function census(w:ReturnType<typeof world>){
 let objects=0;w.game.scene.traverse(()=>{objects++})
 const effects=w.game.scene.userData.vehicleEffects as {vehicles:number}|undefined
 return {bodies:w.physics.bodies.len(),colliders:w.physics.colliders.len(),sceneChildren:w.game.scene.children.length,objects,systems:w.systems.length,effectVehicles:effects?.vehicles??0}
}
const listeners=(v:Vehicle)=>Object.values((v.object as unknown as {_listeners?:Record<string,unknown[]>})._listeners??{}).reduce((n,l)=>n+l.length,0)
function player(w:ReturnType<typeof world>,kind:VehicleKind='buggy'){
 const v=w.game.add(createVehicle(w.game,w.terrain,kind,new T.Vector3(20,2,-30),.8));v.isLocal=true;v.id='7';v.name='Ada';v.spawnSlot=3;v.setColors('#ff8800','#00ffaa')
 const slot=new PlayerSlot(v),swapper=createVehicleSwapper(w.game,w.terrain,slot)
 return {slot,swapper}
}
// Every kind on offer (a hidden tank is built as the buggy, src/vehicles/available.ts).
const KINDS:VehicleKind[]=(['jet','hovercraft','tank','buggy'] as VehicleKind[]).filter(isVehicleAvailable)

describe('swapping the player vehicle in place',()=>{
 it('keeps the spot, heading, velocity, identity and controls, and sets the new vehicle level',()=>{
  const w=world(),{slot,swapper}=player(w);w.step(60)
  const old=slot.current,p=old.body.translation()
  old.body.setLinvel({x:3,y:0,z:-9},true);old.input.y=1;old.input.zorb=false;old.wind.set(1,0,2)
  // Rolled well over: the swap must not pass that on.
  old.body.setRotation(new T.Quaternion().setFromEuler(new T.Euler(0,.8,2.4,'YXZ')),true)
  const next=swapper.swap('jet'),n=next.body.translation(),v=next.body.linvel(),r=next.body.rotation(),w3=next.body.angvel()
  expect(next).not.toBe(old);expect(slot.current).toBe(next);expect(next.kind).toBe('jet')
  expect(n.x).toBeCloseTo(p.x,5);expect(n.z).toBeCloseTo(p.z,5);expect(n.y).toBeCloseTo(Math.max(p.y,REST_HEIGHT.jet+SWAP_CLEARANCE),5)
  expect(v.x).toBeCloseTo(3,4);expect(v.z).toBeCloseTo(-9,4);expect(v.y).toBeGreaterThanOrEqual(0);expect(Math.hypot(w3.x,w3.z)).toBe(0)
  const up=new T.Vector3(0,1,0).applyQuaternion(new T.Quaternion(r.x,r.y,r.z,r.w)),nose=new T.Vector3(0,0,-1).applyQuaternion(new T.Quaternion(r.x,r.y,r.z,r.w))
  expect(up.y).toBeCloseTo(1,5);expect(Math.atan2(-nose.x,-nose.z)).toBeCloseTo(.8,5)
  expect({id:next.id,name:next.name,slot:next.spawnSlot,colors:next.colors,throttle:next.input.y}).toEqual({id:'7',name:'Ada',slot:3,colors:{body:'#ff8800',accent:'#00ffaa'},throttle:1})
  expect(next.wind.toArray()).toEqual([1,0,2])
  expect(old.body.isEnabled()).toBe(false)
  w.physics.free()
 })
 it('does nothing when the player already drives that kind, aliases included',()=>{
  const w=world(),{slot,swapper}=player(w),before=slot.current
  expect(swapper.swap('buggy')).toBe(before);expect(swapper.swap('buggy-syn3h')).toBe(before);expect(swapper.swap('buggy-classic')).toBe(before);expect(before.body.isValid()).toBe(true)
  w.physics.free()
 })
 it('never starts the new vehicle under the ground or the liquid surface',()=>{
  const w=world(),{slot,swapper}=player(w)
  slot.current.body.setTranslation({x:5,y:-4,z:5},true)
  expect(swapper.swap('jet').body.translation().y).toBeCloseTo(REST_HEIGHT.jet+SWAP_CLEARANCE,5)
  ;(w.terrain as {liquidHeightAt?:(x:number,z:number)=>number}).liquidHeightAt=()=>6
  expect(swapper.swap('hovercraft').body.translation().y).toBeCloseTo(6+REST_HEIGHT.hovercraft+SWAP_CLEARANCE,5)
  w.physics.free()
 })
 it('leaves no orphaned body, collider, object, system, effect or listener after twelve swaps',()=>{
  const w=world(),{slot,swapper}=player(w);w.step(30)
  // One full cycle first, so each kind's census is taken from a world that has already swapped.
  for(const kind of KINDS){swapper.swap(kind);w.step(5)}
  const baseline=new Map<VehicleKind,ReturnType<typeof census>>(),hooks=new Map<VehicleKind,number>()
  for(const kind of KINDS){swapper.swap(kind);w.step(5);baseline.set(kind,census(w));hooks.set(kind,listeners(slot.current))}
  const seen=new Set<Vehicle>()
  for(let round=0;round<3;round++)for(const kind of KINDS){
   const previous=slot.current,next=swapper.swap(kind);w.step(5)
   expect(previous.body.isEnabled(),`${kind}: old body disabled`).toBe(false)
   expect(previous.object.parent,`${kind}: old object out of the scene`).toBeNull()
   expect(listeners(previous),`${kind}: nothing still listening to the old vehicle`).toBe(0)
   expect(census(w),`${kind}: same census as the first time`).toEqual(baseline.get(kind))
   expect(listeners(next),`${kind}: same listeners as the first time`).toBe(hooks.get(kind))
   seen.add(next)
  }
  expect(seen.size).toBe(KINDS.length)
  const p=slot.current.body.translation();expect(Number.isFinite(p.y)).toBe(true);expect(p.y).toBeGreaterThan(-.3)
  const cached=[...seen].filter(v=>v!==slot.current)
  swapper.dispose()
  for(const v of cached)expect(v.body.isValid()).toBe(false)
  expect(slot.current.body.isValid()).toBe(true)
  w.physics.free()
 })
 it('keeps the same two lights and parks inactive controllers and colliders',()=>{
  const w=world(),{slot,swapper}=player(w),old=slot.current
  const lights:T.SpotLight[]=[];w.game.scene.traverse(o=>{if(o instanceof T.SpotLight)lights.push(o)})
  expect(lights).toHaveLength(2)
  const next=swapper.swap('hovercraft'),parked=old.body.translation()
  expect(w.systems).not.toContain(old);expect(old.body.isEnabled()).toBe(false)
  w.step(30)
  expect(old.body.translation()).toEqual(parked)
  const after:T.SpotLight[]=[];w.game.scene.traverse(o=>{if(o instanceof T.SpotLight)after.push(o)})
  expect(after).toEqual(lights)
  expect(after.map(o=>o.position.toArray())).toEqual([[-.6,.23,-1.85],[.6,.23,-1.85]])
  expect(swapper.swap('buggy')).toBe(old)
  expect(next.body.isEnabled()).toBe(false)
  expect(old.body.isEnabled()).toBe(true)
  swapper.dispose();w.physics.free()
 })
 it('does not emit engine particles while the vehicle is zorbed',()=>{
  const w=world(),{swapper}=player(w,'jet')
  w.step(60)
  const stats=w.game.scene.userData.vehicleEffects as {emitted:number}
  expect(stats.emitted).toBeGreaterThan(0)
  w.game.input.state.zorb=true;w.step(2)
  const before=stats.emitted
  w.step(60)
  expect(stats.emitted).toBe(before)
  swapper.dispose();w.physics.free()
 })
 it('releases a parked hold before reusing the same cached body',()=>{
  const w=world(),{slot,swapper}=player(w),materialize=w.game.add(new Materialize(w.game,w.terrain))
  const change=(kind:VehicleKind)=>{const previous=slot.current,next=swapper.swap(kind);if(next!==previous){materialize.cancel(previous);void materialize.begin(next)}return next}
  const jet=change('jet');w.step(10)
  expect(jet.body.isKinematic()).toBe(true)
  expect(change('jet')).toBe(jet);expect(materialize.isHeld(jet)).toBe(true)
  const tank=change('tank');w.step(10)
  expect(jet.body.isEnabled()).toBe(false);expect(jet.body.isKinematic()).toBe(false)
  expect(jet.object.userData.materializing).toBeUndefined()
  expect(change('jet')).toBe(jet);w.step(90)
  expect(tank.body.isEnabled()).toBe(false);expect(tank.object.userData.materializing).toBeUndefined()
  expect(jet.body.isEnabled()).toBe(true);expect(jet.body.isKinematic()).toBe(false)
  expect(materialize.isHeld(jet)).toBe(false)
  materialize.dispose();swapper.dispose();w.physics.free()
 })
 it('holds a vehicle switched in mid-air where it was, then lets it go with its speed',()=>{
  const w=world(),{slot,swapper}=player(w),materialize=w.game.add(new Materialize(w.game,w.terrain))
  slot.current.body.setTranslation({x:0,y:40,z:0},true);slot.current.body.setLinvel({x:20,y:-2,z:0},true)
  const next=swapper.swap('tank'),v=next.body.linvel()
  void materialize.begin(next,{carry:{linvel:{...v},angvel:{...next.body.angvel()}},holdSeconds:.5})
  w.step(10)
  expect(next.body.translation().y).toBeCloseTo(40,3);expect(materialize.isHeld(next)).toBe(true)
  w.step(20)
  expect(materialize.isHeld(next)).toBe(false)
  const after=next.body.linvel()
  expect(after.x).toBeGreaterThan(15);expect(after.y).toBeLessThan(0)
  materialize.dispose();swapper.dispose();w.physics.free()
 })
 it('still removes the old vehicle when a slot listener throws',()=>{
  const w=world(),{slot,swapper}=player(w),old=slot.current
  slot.onChange(()=>{throw new Error('listener failed')})
  expect(()=>swapper.swap('jet')).toThrow('listener failed')
  expect(old.body.isEnabled()).toBe(false);expect(slot.current.kind).toBe('jet');expect(w.systems.includes(old)).toBe(false)
  w.physics.free()
 })
})
