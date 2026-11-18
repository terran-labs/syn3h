/**
 * Tyre marks and wheel dust take their look from the ground (owner, 15 and 16 November 2026).
 * Invariants only: what would be a bug a player sees. How strong or long a mark is, is tuning.
 */
import {describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {ParticleBatch} from '../../src/vehicles/effects/ParticleBatch'
import {OPEN_END,RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'
import {MAX_MARK_ALPHA,dustSprite,markEnvelope,markOpacity,numberOps,tyreMarkAlpha} from '../../src/vehicles/effects/sprites'
import {DUSTS,TREADS} from '../../src/vehicles/effects/treads'
import {LOOK_COUNT,MAX_RATIO,groundColour,luminance,markRatio,surfaceTone} from '../../src/vehicles/effects/groundTone'
import {tyreMarkStrength} from '../../src/vehicles/effects/markParams'
import {SURFACE_KINDS,classifySurface} from '../../src/world/terrain/surface'

const E=numberOps

/** Hue in degrees, saturation and lightness (HSL) of a linear colour. */
function hsl([r,g,b]:readonly number[]){
  const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,d=max-min
  if(d<1e-6)return {h:0,s:0,l}
  const s=d/(1-Math.abs(2*l-1))
  const h=max===r?60*(((g-b)/d)%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4)
  return {h:(h+360)%360,s,l}
}
/** Brown: an orange to red hue, noticeably saturated, and not light. */
const brown=(c:readonly number[])=>{const {h,s,l}=hsl(c);return h<=50&&s>.2&&l<.6}

describe('tyre marks and dust by surface',()=>{
 it('names a surface everywhere on every planet, and has a colour, a mark and dust for it',()=>{
  for(let look=0;look<LOOK_COUNT;look++){
   for(const slope of [0,.1,.3,.6])for(const height of [-5,2,40,200,900])for(const roadDist of [0,3,50])for(const volcanic of [0,1]){
    const kind=classifySurface({look,slope,height,sea:0,lavaSea:look===0,snowHeight:300,volcanic,roadDist,madeRoad:look===2})
    expect(SURFACE_KINDS).toContain(kind)
   }
   for(const kind of SURFACE_KINDS){
    for(const c of [groundColour(look,kind),surfaceTone(look,kind,TREADS[kind],0),surfaceTone(look,kind,DUSTS[kind],1)])
     for(const n of c)expect(n>=0&&n<=1,`${look} ${kind}`).toBe(true)
    const s=TREADS[kind];expect(s.slip,kind).toBeGreaterThanOrEqual(s.roll)
   }
  }
 })
 it('leaves a pale mark lighter than the ground on ice and snow, and never brown dust',()=>{
  for(let look=0;look<LOOK_COUNT;look++)for(const kind of ['ice','snow'] as const){
   const ground=groundColour(look,kind),mark=surfaceTone(look,kind,TREADS[kind],0),dust=surfaceTone(look,kind,DUSTS[kind],1)
   expect(luminance(mark),`${look} ${kind}`).toBeGreaterThan(luminance(ground))
   expect(brown(mark),`${look} ${kind} mark`).toBe(false)
   expect(brown(dust),`${look} ${kind} dust`).toBe(false)
   expect(hsl(dust).l,`${look} ${kind} dust`).toBeGreaterThan(.5)
   expect(TREADS[kind].tread,kind).toBe(0)
  }
 })
 it('leaves a visible mark when a wheel simply rolls on soft ground',()=>{
  // The owner (16 November 2026): plain driving on soil, sand and grass left no track at all.
  const strength=tyreMarkStrength.def.default as number
  for(let look=0;look<LOOK_COUNT;look++)for(const kind of ['dust','sand','grass','mud','regolith','snow'] as const){
   const s=TREADS[kind],alpha=markOpacity(E,s.roll,strength)*markEnvelope(E,.5,5,OPEN_END,0,.3,1.2,1)
   expect(alpha,`${look} ${kind}`).toBeGreaterThan(0)
   expect(Math.abs(luminance(surfaceTone(look,kind,s,0))-luminance(groundColour(look,kind))),`${look} ${kind}`).toBeGreaterThan(0)
  }
 })
 it('keeps the heavy mark for mud alone',()=>{
  const weight=(look:number,kind:typeof SURFACE_KINDS[number])=>TREADS[kind].slip*(1-luminance(surfaceTone(look,kind,TREADS[kind],0))/luminance(groundColour(look,kind)))
  for(let look=0;look<LOOK_COUNT;look++)for(const kind of SURFACE_KINDS)if(kind!=='mud')expect(weight(look,kind),`${look} ${kind}`).toBeLessThan(weight(look,'mud'))
 })
 it('fades a mark to nothing at both edges, both ends and the end of its life',()=>{
  const soft=.42,fade=1.2
  for(const u of [0,1])expect(markEnvelope(E,u,5,5,.2,soft,fade,1)).toBe(0)
  expect(markEnvelope(E,.5,0,5,.2,soft,fade,1)).toBe(0)
  expect(markEnvelope(E,.5,5,0,.2,soft,fade,1)).toBe(0)
  expect(markEnvelope(E,.5,5,5,1,soft,fade,1)).toBe(0)
  expect(markEnvelope(E,.5,5,5,1.5,soft,fade,1)).toBe(0)
  // ...and it is there in the middle, and an unended mark has no end fade.
  expect(markEnvelope(E,.5,5,OPEN_END,.05,soft,fade,1)).toBe(1)
  // New track eases in: nothing right at the tyre, full once it has settled.
  expect(markEnvelope(E,.5,5,OPEN_END,0,soft,fade,0)).toBe(0)
  expect(markEnvelope(E,.5,5,OPEN_END,0,soft,fade,.5)).toBeGreaterThan(0)
  // Older is fainter.
  expect(markEnvelope(E,.5,5,5,.7,soft,fade,1)).toBeLessThan(markEnvelope(E,.5,5,5,.3,soft,fade,1))
 })
 it('bounds how much a mark can cover, at any strength',()=>{
  const most=Math.max(...SURFACE_KINDS.map(k=>TREADS[k].slip))*1.3
  for(const strength of [0,tyreMarkStrength.def.default as number,tyreMarkStrength.def.max as number]){
   const a=markOpacity(E,most,strength)
   expect(a).toBeGreaterThanOrEqual(0);expect(a).toBeLessThanOrEqual(MAX_MARK_ALPHA)
  }
  expect(markOpacity(E,most,0)).toBe(0)
 })
 it('removes expired marks, so they draw nothing',()=>{
  const r=new RibbonBatch(8,tyreMarkAlpha,false,1.2),side=new T.Vector3(1,0,0),c=new T.Color(.2,.3,.1)
  r.mark(new T.Vector3(),new T.Vector3(0,0,1),side,.5,1,.1,.2,c,c,.5,0,1)
  r.mark(new T.Vector3(0,0,1),new T.Vector3(0,0,2),side,.5,3,.2,.2,c,c,.5,1,2)
  expect(r.used).toBe(2)
  r.clock.value=1.5;r.expire()
  expect(r.used).toBe(1)
  const p=r.mesh.geometry.attributes.position as T.BufferAttribute
  for(let k=1;k<4;k++)expect([p.getX(k),p.getY(k),p.getZ(k)]).toEqual([p.getX(0),p.getY(0),p.getZ(0)])
  r.clock.value=4;r.expire()
  expect(r.used).toBe(0);expect(r.mesh.geometry.drawRange.count).toBe(0)
  r.dispose()
 })
 it('stretches a wheel\'s live head quad in place, so new track grows instead of popping in',()=>{
  // The flashing behind the wheels (17 November 2026): track arrived a whole segment at a time.
  const r=new RibbonBatch(4,tyreMarkAlpha,false,1.2),side=new T.Vector3(1,0,0),c=new T.Color()
  const head=r.mark(new T.Vector3(),new T.Vector3(0,0,.2),side,.5,10,.1,.1,c,c,0,0,.2)
  r.clock.value=.1
  const again=r.mark(new T.Vector3(),new T.Vector3(0,0,.5),side,.5,10,.1,.1,c,c,0,0,.5,0,head)
  expect(again).toBe(head);expect(r.used).toBe(1)
  const p=r.mesh.geometry.attributes.position as T.BufferAttribute,age=r.mesh.geometry.attributes.fxAge as T.BufferAttribute
  expect(p.getZ(2)).toBeCloseTo(.5)
  // The tyre end is laid now, the far end when the head began.
  expect([age.getX(0),age.getX(2)]).toEqual([0,.1].map(x=>Math.fround(x)))
  r.dispose()
 })
 it('only shades the ground a mark is on, darker or paler within bounds, and less on dark ground',()=>{
  for(let look=0;look<LOOK_COUNT;look++)for(const kind of SURFACE_KINDS){
   const r=markRatio(look,kind,TREADS[kind])
   for(const n of r)expect(n>=0&&n<=MAX_RATIO,`${look} ${kind}`).toBe(true)
  }
  // Obsidian's near-black ground keeps less of the darkening than the same surface elsewhere.
  const dark=(look:number)=>1-luminance(markRatio(look,'dust',TREADS.dust).map((x,i)=>x*groundColour(look,'dust')[i]))/luminance(groundColour(look,'dust'))
  expect(dark(5)).toBeLessThan(dark(1))
 })
 it('fades the end of a mark where it ended, and not a reused quad',()=>{
  const r=new RibbonBatch(2,tyreMarkAlpha,false,1.2),side=new T.Vector3(1,0,0),c=new T.Color()
  const id=r.mark(new T.Vector3(),new T.Vector3(0,0,1),side,.5,10,.1,.1,c,c,0,0,1)
  r.endAt(id,1,0)
  const run=r.mesh.geometry.attributes.fxRun as T.BufferAttribute
  expect([run.getY(0),run.getY(2)]).toEqual([1,0])
  r.mark(new T.Vector3(),new T.Vector3(0,0,1),side,.5,10,.1,.1,c,c,0);r.mark(new T.Vector3(),new T.Vector3(0,0,1),side,.5,10,.1,.1,c,c,0)
  r.endAt(id,7,7)
  expect(run.getY(0)).toBe(OPEN_END)
  r.dispose()
 })
 it('sets a dust particle colour once, when it is emitted',()=>{
  const b=new ParticleBatch(4,dustSprite),c=new T.Color(.9,.95,1)
  b.emit(new T.Vector3(),new T.Vector3(),.5,.2,1,c)
  const tint=b.mesh.geometry.attributes.fxTint as T.InstancedBufferAttribute,version=tint.version
  c.setRGB(.5,.3,.1);b.clock.value=.3
  expect([tint.getX(0),tint.getY(0),tint.getZ(0)].map(n=>+n.toFixed(3))).toEqual([.9,.95,1])
  expect(tint.version).toBe(version)
  b.dispose?.()
 })
})
