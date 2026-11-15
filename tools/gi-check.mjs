/** Deterministic indirect-light fixture inside the game's real renderer. Run via heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base,out]=process.argv.slice(2)
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
const errors=[],results=[]
try {
 const page=await browser.newPage({viewport:{width:960,height:640}})
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 const url=new URL(base);url.searchParams.set('autoplay','1');url.searchParams.set('room',`gi-fixture-${Date.now()}`)
 if(process.argv.includes('--webgl'))url.searchParams.set('webgl','1')
 await page.goto(url.href,{timeout:120000})
 await page.waitForFunction(()=>window.syn3h?.game?.tick>90,null,{timeout:120000})
 await page.evaluate(async()=>{
  const threeUrl=performance.getEntriesByType('resource').find(r=>r.name.includes('/three_webgpu.js'))?.name
  if(!threeUrl)throw new Error('Game Three.js module URL unavailable')
  const T=await import(threeUrl)
  const {PostChain}=await import('/src/fx/post/PostChain.ts')
  const s=window.syn3h,g=s.game;g.renderer.setAnimationLoop(null)
  g.postChain.release();s.params.set('gfx.level',2);s.params.set('post.on',true)
  for(const id of ['post.bloom','post.shafts','post.flare','post.ao','post.contact','post.motionBlur','post.heat','post.plunge','post.look','post.vignette','post.grain'])s.params.set(id,0)
  const scene=new T.Scene();scene.background=new T.Color(.01,.01,.01)
  const camera=new T.PerspectiveCamera(50,960/640,.1,50);camera.position.set(5,4,7);camera.lookAt(0,.5,0);camera.updateMatrixWorld()
  const floor=new T.Mesh(new T.PlaneGeometry(12,12),new T.MeshStandardNodeMaterial({color:0xaaaaaa,roughness:1}))
  floor.rotation.x=-Math.PI/2;scene.add(floor)
  const wall=new T.Mesh(new T.BoxGeometry(.15,3,4),new T.MeshStandardNodeMaterial({color:0xcc1010,emissive:0xff0000,emissiveIntensity:2,roughness:1}))
  wall.position.set(-1,1.5,0);scene.add(wall)
  scene.add(new T.HemisphereLight(0xffffff,0xffffff,.2))
  const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(3,7,5);scene.add(sun)
  const chain=new PostChain({quality:{deviceLevel:2,postBudget:1}},{sunDirection:new T.Vector3(0,1,0)})
  g.renderer.toneMappingExposure=1
  document.querySelector('.syn3h-shell')?.setAttribute('style','display:none')
  window.giFixture={T,scene,camera,chain}
 })
 for(const strength of [0,1,0]) {
  const state=await page.evaluate(async strength=>{
   const s=window.syn3h,g=s.game,{T,scene,camera,chain}=window.giFixture
   s.params.set('post.gi',strength)
   for(let i=0;i<12;i++){chain.render(g.renderer,scene,camera,16.667);await new Promise(requestAnimationFrame)}
   const pass=chain.built.disposables.find(d=>d.scene===scene&&d.contextNode?.value?.getGI)
     ??chain.built.disposables.find(d=>d.scene===scene)
   const samples=[]
   for(const x of [-.7,0,1,2]) {
    const ndc=new T.Vector3(x,.01,.5).project(camera),w=pass.renderTarget.width,h=pass.renderTarget.height
    const px=Math.round((ndc.x*.5+.5)*w),py=Math.round((g.backend==='webgl'?ndc.y*.5+.5:.5-ndc.y*.5)*h)
    const data=await g.renderer.readRenderTargetPixelsAsync(pass.renderTarget,px-2,py-2,5,5)
    const rgb=[0,0,0]
    for(let i=0;i<data.length;i++)if(i%4<3)rgb[i%4]+=data instanceof Uint16Array?T.DataUtils.fromHalfFloat(data[i]):data[i]
    samples.push({x,rgb:rgb.map(v=>v/25)})
   }
   return {strength,backend:g.backend,samples}
  },strength)
  results.push(state)
  await page.screenshot({path:`${out}/gi-${strength}-${results.length}.png`})
 }
 assert.deepEqual(errors,[])
 const off=results[0].samples[1].rgb,on=results[1].samples[1].rgb,restored=results[2].samples[1].rgb
 assert.ok(on[0]-off[0]>.005,'indirect red light reaches neutral floor')
 assert.ok(on[0]-off[0]>(on[1]-off[1])*2,'bounce carries source color')
 assert.ok(Math.abs(restored[0]-off[0])<.002,'turning GI off restores direct lighting')
} finally {writeFileSync(`${out}/report.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors:errors.slice(0,3),errorCount:errors.length},null,2));await browser.close()}
