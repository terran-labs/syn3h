/**
 * The owner's rule for tyre marks (15 November 2026): they differ by surface, only the swamp's
 * mud keeps the heavy dark ruts, and the heaviest mark on anything else is substantially
 * lighter than the single mark this replaced.
 */
import {describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'
import {tyreMarkAlpha} from '../../src/vehicles/effects/sprites'
import {DEFAULT_TREAD,TREADS,darkening,type TreadStyle} from '../../src/vehicles/effects/treads'
import {SURFACE_KINDS} from '../../src/world/terrain/surface'

// The mark every surface used to get: near black, alpha .25 rolling and .375 spinning.
const OLD:TreadStyle={tint:[.055,.035,.022],roll:.25,slip:.375,tread:1,width:1,life:60}

describe('tyre marks by surface',()=>{
 it('has a style for every surface the terrain can report',()=>{
  for(const kind of SURFACE_KINDS){
   const s=TREADS[kind];expect(s,kind).toBeTruthy()
   expect(s.slip,kind).toBeGreaterThanOrEqual(s.roll)
   for(const n of [...s.tint,s.roll,s.slip,s.tread,s.width,s.life])expect(Number.isFinite(n)&&n>=0,kind).toBe(true)
   expect(s.tread,kind).toBeLessThanOrEqual(1);expect(s.slip,kind).toBeLessThan(.5)
  }
  expect(DEFAULT_TREAD).toBe(TREADS.dust)
 })
 it('gives each surface its own mark',()=>{
  const seen=new Set(SURFACE_KINDS.map(k=>JSON.stringify(TREADS[k])))
  expect(seen.size).toBe(SURFACE_KINDS.length)
 })
 it('keeps the heavy mark for mud alone',()=>{
  const was=darkening(OLD,OLD.slip)
  // Mud is as heavy as the old mark, or heavier.
  expect(darkening(TREADS.mud,TREADS.mud.slip)).toBeGreaterThanOrEqual(was)
  for(const kind of SURFACE_KINDS){
   if(kind==='mud')continue
   const s=TREADS[kind]
   // At its heaviest, well under two thirds of what the old mark took from the ground, and
   // lighter than the old mark was when merely rolling.
   expect(Math.abs(darkening(s,s.slip)),kind).toBeLessThan(was*.6)
   expect(Math.abs(darkening(s,s.slip)),kind).toBeLessThan(darkening(OLD,OLD.roll))
   expect(s.slip,kind).toBeLessThanOrEqual(.27)
  }
 })
 it('carries the tread depth of each quad to the shader in one draw',()=>{
  const r=new RibbonBatch(4,tyreMarkAlpha),a=new T.Vector3(),b=new T.Vector3(0,0,1),side=new T.Vector3(1,0,0)
  r.add(a,b,side,.5,60,.2,new T.Color(.1,.2,.3),.45);r.add(a,b,side,.5,60,.2,new T.Color(1,1,1))
  const tint=r.mesh.geometry.attributes.fxColor as T.BufferAttribute
  expect(tint.itemSize).toBe(4)
  for(let j=0;j<4;j++){expect(tint.getW(j)).toBeCloseTo(.45);expect(tint.getX(j)).toBeCloseTo(.1);expect(tint.getW(4+j)).toBe(1)}
  expect(r.mesh.material.opacityNode).toBeTruthy();r.dispose()
 })
})
