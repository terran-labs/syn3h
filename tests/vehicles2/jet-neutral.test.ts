import { beforeAll, describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Jet, jetNeutralThrottle } from '../../src/vehicles/Jet'
import { harness } from './harness'

beforeAll(initPhysics)
describe('human neutral flight throttle',()=>{
 const setup=(height=100)=>{
  const h=harness(),v=new Jet(h.game,h.terrain,new Vector3(0,height,0))
  v.isLocal=true;h.game.input.state.special=true
  const keys=new Set<string>();h.game.input.held=code=>keys.has(code)
  return {...h,v,keys,close(){v.dispose();h.world.free()}}
 }
 it('resolves half throttle into replicated input without changing raw intent',()=>{
  const h=setup()
  try{
   expect(jetNeutralThrottle.value).toBe(.5);h.step(h.v,30)
   expect(h.v.getState().input.z).toBe(.5);expect(h.game.input.state.z).toBe(0)
   expect(h.v.body.linvel().z).toBeLessThan(-1)
   h.v.update(1/60,1)
   const plume=h.v.object.getObjectByName('jet-plume')!.userData.plume
   expect(plume.x).toBeCloseTo(.65,2);expect(plume.y).toBeCloseTo(.9,2)
  }finally{h.close()}
 })
 it('keeps E and Q momentary and opposing keys neutral',()=>{
  const h=setup()
  try{
   h.keys.add('KeyE');h.step(h.v);expect(h.v.input.z).toBe(1)
   h.keys.clear();h.step(h.v);expect(h.v.input.z).toBe(.5)
   h.keys.add('KeyQ');h.step(h.v);expect(h.v.input.z).toBe(-1)
   h.keys.add('KeyE');h.step(h.v);expect(h.v.input.z).toBe(0)
   h.keys.clear();h.game.input.state.z=.25;h.step(h.v);expect(h.v.input.z).toBe(.25)
  }finally{h.close()}
 })
 it('does not propel a resting flight-mode spawn',()=>{
  const h=setup(1.3)
  try{h.step(h.v,180);expect(h.v.input.z).toBe(0);expect(Math.abs(h.v.body.translation().z)).toBeLessThan(.05)}finally{h.close()}
 })
 it.each(['autopilot','materializing'] as const)('does not fill an intentional zero during %s',flag=>{
  const h=setup()
  try{h.v.object.userData[flag]=true;h.step(h.v);expect(h.v.input.z).toBe(0)}finally{h.close()}
 })
 it('leaves hover, brakes, settle and Zorb free of neutral flight thrust',()=>{
  const h=setup()
  try{
   h.game.input.state.special=false;h.step(h.v);expect(h.v.input.z).toBe(0)
   h.game.input.state.special=true;h.game.input.state.brakes=true;h.step(h.v);expect(h.v.input.z).toBe(0)
   h.game.input.state.brakes=false;h.v.releaseHoverHold();h.step(h.v);expect(h.v.input.z).toBe(0)
   h.game.input.state.zorb=true;h.step(h.v);expect(h.v.input.z).toBe(0)
  }finally{h.close()}
 })
 it('preserves bot zero and consumes the same resolved throttle on a remote copy',()=>{
  const h=setup()
  try{
   h.v.isLocal=false;h.v.input.special=true;h.step(h.v);expect(h.v.input.z).toBe(0)
   h.v.input.z=.5;h.step(h.v,30);expect(h.v.input.z).toBe(.5);expect(h.v.body.linvel().z).toBeLessThan(-1)
  }finally{h.close()}
 })
 it('releases settle suppression on deliberate flight thrust, then returns to half',()=>{
  const h=setup()
  try{
   h.v.releaseHoverHold();h.step(h.v);expect(h.v.input.z).toBe(0)
   h.keys.add('KeyE');h.step(h.v);expect(h.v.input.z).toBe(1)
   h.keys.clear();h.step(h.v);expect(h.v.input.z).toBe(.5)
  }finally{h.close()}
 })
 it('uses the registry value and permits disabling assistance',()=>{
  const h=setup(),original=jetNeutralThrottle.value
  try{
   jetNeutralThrottle.value=.3;h.step(h.v);expect(h.v.input.z).toBe(.3)
   jetNeutralThrottle.value=0;h.step(h.v);expect(h.v.input.z).toBe(0)
  }finally{jetNeutralThrottle.value=original;h.close()}
 })
})
