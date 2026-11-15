import { expect,it } from 'vitest'
import { BubbleField,bubbleCapacity } from '../../src/world/water/bubbles'
const water={heightAt:()=>-20,liquidKindAt:()=> 'water' as const,liquidHeightAt:()=>0}
it('bounds capacity, rises, and pops at the current surface',()=>{
 const b=new BubbleField(),eye={x:0,y:-5,z:0}
 for(let i=0;i<300;i++)b.step(.1,eye,water,16)
 expect(b.particles.length).toBeGreaterThan(0);expect(b.particles.length).toBeLessThanOrEqual(16)
 const p=b.particles[0],y=p.y;b.step(.1,eye,water,16);expect(p.y).toBeGreaterThan(y)
 p.y=-p.radius+.01;b.step(0,eye,water,16);expect(b.particles).not.toContain(p)
 for(const p of b.particles)p.age=p.life
 b.step(0,eye,water,16);expect(b.particles).toHaveLength(0)
})
it('clears on exit, teleport, disable and non-water worlds',()=>{
 const b=new BubbleField(),eye={x:0,y:-5,z:0}
 const fill=()=>{for(let i=0;i<60;i++)b.step(.1,eye,water,64);expect(b.particles.length).toBeGreaterThan(0)}
 fill();b.step(0,{...eye,y:1},water,64);expect(b.particles).toHaveLength(0)
 fill();b.step(0,{...eye,x:1000},water,64);expect(b.particles).toHaveLength(0)
 fill();b.step(0,eye,water,64,false);expect(b.particles).toHaveLength(0)
 fill();b.step(0,eye,{...water,liquidKindAt:()=> 'lava'},64);expect(b.particles).toHaveLength(0)
 fill();b.step(0,eye,{...water,liquidKindAt:()=>null,liquidHeightAt:()=>-Infinity},64);expect(b.particles).toHaveLength(0)
 expect([0,1,2].map(bubbleCapacity)).toEqual([16,32,64])
})

it('reallocates to quality capacity and removes live particles/listeners on reset and dispose',async()=>{
 const T=await import('three/webgpu')
 const {UnderwaterBubbles}=await import('../../src/world/water/bubbles')
 const {graphicsLevel}=await import('../../src/core/quality')
 const {params}=await import('../../shared/params')
 const before=graphicsLevel.value,scene=new T.Scene(),camera=new T.PerspectiveCamera()
 camera.position.y=-5
 let reset=()=>{},unsubscribed=false
 const terrain={...water,size:100,normalAt:(_x:number,_z:number,out:import('three/webgpu').Vector3)=>out.set(0,1,0),spawnPoint:()=>({position:new T.Vector3(),heading:0}),dispose(){},onRegenerate:(fn:()=>void)=>{reset=fn;return()=>{unsubscribed=true}}}
 const bubbles=new UnderwaterBubbles(scene,terrain,camera)
 try{
  graphicsLevel.value=2;for(let i=0;i<60;i++)bubbles.update(.1)
  expect(bubbles.mesh?.geometry.getAttribute('bubblePosition').count).toBe(64)
  let disposed=false;bubbles.mesh!.geometry.addEventListener('dispose',()=>{disposed=true})
  params.set('gfx.level',0);bubbles.update(.1)
  expect(disposed).toBe(true);expect(bubbles.mesh?.geometry.getAttribute('bubblePosition').count).toBe(16)
  expect(scene.children).toHaveLength(1)
  reset();expect(bubbles.field.particles).toHaveLength(0);expect(bubbles.mesh?.geometry.instanceCount).toBe(0)
  bubbles.dispose();expect(scene.children).toHaveLength(0);expect(unsubscribed).toBe(true)
 }finally{bubbles.dispose();graphicsLevel.value=before}
})
