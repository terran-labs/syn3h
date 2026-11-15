import {describe,it,expect} from 'vitest'
import {snappedOrigin,windowShift,DisturbanceQueue,RippleSleep} from '../../src/world/water/rippleMath'
import {Ripples,waterRipples} from '../../src/world/water/ripples'
import {emission} from '../../src/world/water/sprayMath'
describe('ripple window',()=>{
 it('snaps negative positions down by full cells',()=>{expect(snappedOrigin(-.1,.49)).toEqual({x:-64.5,z:-64})})
 it('shifts source samples toward the new origin',()=>{expect(windowShift({x:-64,z:-64},{x:-63,z:-65},.5)).toEqual({x:2,z:-2})})
 it('keeps world coordinates unchanged during shift',()=>{const a=snappedOrigin(0,0),b=snappedOrigin(3,1),s=windowShift(a,b,.5);expect(a.x+(20+s.x)*.5).toBe(b.x+20*.5)})
})
describe('disturbances',()=>{
 it('rejects invalid events',()=>{const q=new DisturbanceQueue();q.push(0,NaN,1,1);q.push(0,0,0,1);expect(q.drain()).toEqual([])})
 it('bounds events and consumes once',()=>{const q=new DisturbanceQueue();for(let i=0;i<40;i++)q.push(i,0,1,3);const e=q.drain();expect(e).toHaveLength(32);expect(e[0].x).toBe(8);expect(e[0].strength).toBe(2);expect(q.drain()).toEqual([])})
})
describe('spray emission',()=>{
 it('is independent of frame rate',()=>{function run(hz:number){let carry=0,total=0;for(let i=0;i<hz;i++){const e=emission(13,.7,1/hz,carry);carry=e.carry;total+=e.count}return total+carry}expect(run(30)).toBeCloseTo(run(120),8)})
 it('emits nothing while dry or still',()=>{expect(emission(20,0,.1,0).count).toBe(0);expect(emission(0,1,.1,0).count).toBe(0)})
 it('caps stalled frames',()=>{expect(emission(1000,1,10,0).count).toBe(16)})
})
describe('ripple sleep',()=>{
 it('never wakes without a disturbance, however long the world runs',()=>{const s=new RippleSleep();for(let i=0;i<10000;i++)expect(s.step(0,1/60)).toBe(false)})
 it('runs from a disturbance until the field has settled, then sleeps again',()=>{
  const s=new RippleSleep(10);expect(s.step(1,1/60)).toBe(true)
  let frames=0;while(s.step(0,1/60))frames++
  expect(frames/60).toBeGreaterThan(9.9);expect(frames/60).toBeLessThan(10.1)
  expect(s.step(0,1)).toBe(false);expect(s.step(2,0)).toBe(true)
 })
 it('does no GPU work at all on a world where nothing ripples',()=>{
  // Any renderer call would throw: a dry world, lava or the lobby must not touch it.
  const renderer=new Proxy({},{get(){throw Error('ripple field touched the renderer')}}) as never
  const field=new Ripples(),previous=waterRipples.value
  waterRipples.value=true
  try{field.attach(renderer);field.configure(2048);for(let i=0;i<600;i++)field.update(1/60,i,0);expect(field.stats.passes).toBe(0)}
  finally{waterRipples.value=previous}
 })
})
