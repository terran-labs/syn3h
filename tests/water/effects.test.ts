import {describe,it,expect} from 'vitest'
import {submergedFraction,waterTransmission,underwaterLook,verticalHalfExtent} from '../../src/world/water/waterEffectsMath'
describe('vehicle submergence',()=>{
 it('clamps dry, half submerged and fully submerged bodies',()=>{expect(submergedFraction(1,3,0)).toBe(0);expect(submergedFraction(1,3,2)).toBe(.5);expect(submergedFraction(1,3,5)).toBe(1)})
 it('rejects absent surfaces and degenerate bounds',()=>{expect(submergedFraction(0,1,-Infinity)).toBe(0);expect(submergedFraction(1,1,2)).toBe(0)})
 it('projects upright and rolled box heights',()=>{const h={x:2,y:1,z:3};expect(verticalHalfExtent(h,{x:0,y:0,z:0,w:1})).toBe(1);expect(verticalHalfExtent(h,{x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2})).toBeCloseTo(2)})
})
describe('underwater attenuation',()=>{
 it('obeys Beer-Lambert and composes over distances',()=>{expect(waterTransmission(0)).toBe(1);expect(waterTransmission(10)).toBeCloseTo(Math.exp(-.85));expect(waterTransmission(10)*waterTransmission(20)).toBeCloseTo(waterTransmission(30))})
 it('clamps negative depth at the surface',()=>{expect(waterTransmission(-5)).toBe(1)})
 it('darkens with depth and raises fog extinction',()=>{const a=underwaterLook(1),b=underwaterLook(30);expect(b.transmission).toBeLessThan(a.transmission);expect(b.blue).toBeLessThan(a.blue);expect(b.extinction).toBeGreaterThan(a.extinction);expect(b.green).toBeGreaterThan(b.red)})
})

import { Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Vector3 } from 'three/webgpu'
import { Underwater, waterUnderwater, underwaterAmountForCamera } from '../../src/world/water/underwater'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
describe('underwater restoration',()=>{
 function setup(){
  const scene=new Scene(),camera=new PerspectiveCamera(),sun=new DirectionalLight(0xffffff,2),hemi=new HemisphereLight(0xffffff,0x334455,.8)
  scene.add(sun,hemi);scene.environmentIntensity=.7;camera.position.y=-3
  const terrain={liquidKindAt:()=> 'water',liquidHeightAt:()=>0} as unknown as Terrain
  const originalFog=scene.fogNode
  const effect=new Underwater({scene,camera} as Game,terrain)
  return {scene,camera,sun,hemi,effect,originalFog}
 }
 it('keeps one fog graph across crossings and restores lights on exit',()=>{
  const s=setup(),fog=s.scene.fogNode
  waterUnderwater.value=true
  try{s.effect.update(.1);expect(s.sun.intensity).toBeLessThan(2);expect(s.scene.fogNode).toBe(fog);s.camera.position.y=1;s.effect.update(.1);expect(s.sun.intensity).toBe(2);expect(s.hemi.intensity).toBe(.8);expect(s.scene.environmentIntensity).toBe(.7);expect(s.scene.fogNode).toBe(fog)}finally{s.effect.dispose();waterUnderwater.value=false}
 })
 it('blends over frames and restores the original air graph only on disposal',()=>{
  const s=setup(),fog=s.scene.fogNode,previous=waterUnderwater.value
  waterUnderwater.value=true
  try{
   s.effect.update(1/60);const first=s.sun.intensity
   s.effect.update(1/60);expect(s.sun.intensity).toBeLessThan(first)
   for(let i=0;i<20;i++){s.camera.position.y=i%2?2:-3;s.effect.update(.1);expect(s.scene.fogNode).toBe(fog)}
   s.effect.dispose();expect(s.scene.fogNode).toBe(s.originalFog)
  }finally{s.effect.dispose();waterUnderwater.value=previous}
 })
 it('does not compound attenuation and respects Environment writes',()=>{
  const s=setup();waterUnderwater.value=true
  try{for(let i=0;i<5;i++)s.effect.update(.1);const first=s.sun.intensity;s.effect.update(.1);expect(s.sun.intensity).toBe(first);s.sun.intensity=4;s.effect.update(.1);expect(s.sun.intensity).toBeCloseTo(4*waterTransmission(3));waterUnderwater.value=false;s.effect.update(.1);expect(s.sun.intensity).toBe(4)}finally{s.effect.dispose();waterUnderwater.value=false}
 })
})

import { Ripples, waterRipples } from '../../src/world/water/ripples'
it('allows ripple nodes and updates before renderer attachment',()=>{
 const field=new Ripples()
 waterRipples.value=true
 try{expect(()=>{field.update(1/60,0,0);field.disturb(0,0,2,.1);field.dispose()}).not.toThrow()}finally{waterRipples.value=false}
})

import { underwaterRamp } from '../../src/world/water/waterEffectsMath'
describe('underwater look arrives with the lens',()=>{
 it('shares the eased blend only with its camera and clears it on exit and disposal',()=>{
  const scene=new Scene(),camera=new PerspectiveCamera(),reflection=new PerspectiveCamera()
  camera.position.y=-3
  const effect=new Underwater({scene,camera} as Game,{liquidKindAt:()=> 'water',liquidHeightAt:()=>0} as unknown as Terrain)
  const previous=waterUnderwater.value;waterUnderwater.value=true
  try{
   expect(underwaterAmountForCamera(camera)).toBe(0)
   effect.update(1/60)
   expect(underwaterAmountForCamera(camera)).toBeGreaterThan(0)
   expect(underwaterAmountForCamera(camera)).toBeLessThan(1)
   expect(underwaterAmountForCamera(reflection)).toBe(0)
   for(let i=0;i<30;i++)effect.update(1/60)
   expect(underwaterAmountForCamera(camera)).toBe(1)
   camera.position.y=3
   for(let i=0;i<30;i++)effect.update(1/60)
   expect(underwaterAmountForCamera(camera)).toBe(0)
   camera.position.y=-3;effect.update(.25)
   expect(underwaterAmountForCamera(camera)).toBe(1)
   effect.dispose();expect(underwaterAmountForCamera(camera)).toBe(0)
  }finally{effect.dispose();waterUnderwater.value=previous}
 })
 it('ramps over depth and time, not in one frame',()=>{
  expect(underwaterRamp(0)).toBe(0);expect(underwaterRamp(.225)).toBeCloseTo(.5);expect(underwaterRamp(2)).toBe(1)
  const scene=new Scene(),camera=new PerspectiveCamera();camera.position.y=-3
  const effect=new Underwater({scene,camera} as Game,{liquidKindAt:()=> 'water',liquidHeightAt:()=>0} as unknown as Terrain)
  waterUnderwater.value=true
  try{
   const seen:number[]=[];for(let i=0;i<30;i++){effect.update(1/60);seen.push(effect.amount)}
   for(let i=1;i<seen.length;i++)expect(seen[i]).toBeGreaterThanOrEqual(seen[i-1])
   expect(seen[0]).toBeLessThan(.1);expect(seen.at(-1)).toBe(1)
   camera.position.y=.3;effect.update(1/60,1);expect(effect.amount).toBe(0)
   for(let i=0;i<60;i++)effect.update(1/60,0);expect(effect.amount).toBe(0)
  }finally{effect.dispose();waterUnderwater.value=false}
 })
 it('drives the sky seam for the player camera only and clears it on disposal',()=>{
  const scene=new Scene(),camera=new PerspectiveCamera();camera.position.y=-3
  const sky=Object.assign(new Scene(),{sunDirection:{},betaR:{},underwaterTint:{value:new Vector3()},underwaterAmount:0,underwaterCamera:null as unknown})
  scene.add(sky)
  const effect=new Underwater({scene,camera} as Game,{liquidKindAt:()=> 'water',liquidHeightAt:()=>0} as unknown as Terrain)
  waterUnderwater.value=true
  try{for(let i=0;i<30;i++)effect.update(1/60);expect(sky.underwaterCamera).toBe(camera);expect(sky.underwaterAmount).toBe(1);expect(sky.underwaterTint.value.z).toBeGreaterThan(0)
   effect.dispose();expect(sky.underwaterAmount).toBe(0);expect(sky.underwaterCamera).toBe(null)}finally{effect.dispose();waterUnderwater.value=false}
 })
})
