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
 const caps=[0,1,2].map(bubbleCapacity);expect(caps[0]).toBeGreaterThan(0);expect(caps[1]).toBeGreaterThanOrEqual(caps[0]);expect(caps[2]).toBeGreaterThanOrEqual(caps[1])
})

it('allocates one batch at construction, in the scene, and never reallocates on a tier change',async()=>{
 const T=await import('three/webgpu')
 const {UnderwaterBubbles,bubbleBatchCapacity}=await import('../../src/world/water/bubbles')
 const {graphicsLevel}=await import('../../src/core/quality')
 const {params}=await import('../../shared/params')
 const before=graphicsLevel.value,scene=new T.Scene(),camera=new T.PerspectiveCamera()
 camera.position.y=-5
 let reset=()=>{},unsubscribed=false
 const terrain={...water,size:100,normalAt:(_x:number,_z:number,out:import('three/webgpu').Vector3)=>out.set(0,1,0),spawnPoint:()=>({position:new T.Vector3(),heading:0}),dispose(){},onRegenerate:(fn:()=>void)=>{reset=fn;return()=>{unsubscribed=true}}}
 camera.position.y=5
 const bubbles=new UnderwaterBubbles(scene,terrain,camera)
 try{
  // Present and visible before any dive, with nothing to draw: the pipeline compiles at load.
  const mesh=bubbles.mesh,geometry=mesh.geometry
  expect(scene.children).toContain(mesh);expect(mesh.visible).toBe(true);expect(geometry.instanceCount).toBe(0)
  expect(geometry.getAttribute('bubblePosition').count).toBe(bubbleBatchCapacity)
  let disposed=false;geometry.addEventListener('dispose',()=>{disposed=true})
  camera.position.y=-5
  graphicsLevel.value=2;for(let i=0;i<120;i++)bubbles.update(.1)
  expect(geometry.instanceCount).toBeGreaterThan(16);expect(geometry.instanceCount).toBeLessThanOrEqual(64)
  params.set('gfx.level',0);for(let i=0;i<10;i++)bubbles.update(.1)
  expect(disposed).toBe(false);expect(bubbles.mesh).toBe(mesh);expect(geometry.instanceCount).toBeLessThanOrEqual(16)
  expect(scene.children).toHaveLength(1)
  reset();expect(bubbles.field.particles).toHaveLength(0);expect(geometry.instanceCount).toBe(0);expect(mesh.visible).toBe(true)
  bubbles.dispose();expect(scene.children).toHaveLength(0);expect(unsubscribed).toBe(true);expect(disposed).toBe(true)
 }finally{bubbles.dispose();graphicsLevel.value=before}
})
it('trails denser bubbles behind a faster submerged vehicle, none outside water',()=>{
 const count=(speed:number,kind:'water'|'lava'='water')=>{
  const b=new BubbleField(),w={...water,liquidKindAt:()=>kind},eye={x:0,y:-3,z:0}
  b.step(0,eye,w,64);for(let i=0;i<20;i++){b.emit(0,-3,0,Math.floor(speed),1.4,w,64);b.step(.05,eye,w,64)}
  return b.particles.length
 }
 expect(count(8)).toBeGreaterThan(count(1));expect(count(8,'lava')).toBe(0)
})
it('rises with size and wobbles sideways',()=>{
 const b=new BubbleField(),eye={x:0,y:-5,z:0}
 b.step(0,eye,water,64);b.emit(0,-5,0,10,.1,water,64)
 const p=b.particles[0],x=p.x,z=p.z,y=p.y
 for(let i=0;i<10;i++)b.step(.05,eye,water,64)
 expect(p.y).toBeGreaterThan(y);expect(Math.hypot(p.x-x,p.z-z)).toBeGreaterThan(0)
})
