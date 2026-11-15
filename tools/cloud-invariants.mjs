/** Wrap continuity, live wind and actual reflection-pixel checks. Run via heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base,out]=process.argv.slice(2);mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
const errors=[],results={}
try{
 const page=await browser.newPage({viewport:{width:960,height:640}})
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 const url=new URL(base);url.searchParams.set('autoplay','1');url.searchParams.set('room',`cloud-invariant-${Date.now()}`)
 if(process.argv.includes('--webgl'))url.searchParams.set('webgl','1')
 await page.goto(url.href,{timeout:120000});await page.waitForFunction(()=>window.syn3h?.game?.tick>120,null,{timeout:120000})
 await page.evaluate(async()=>{
  const s=window.syn3h,g=s.game,p=s.params;g.renderer.setAnimationLoop(null)
  const T=await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/three_webgpu.js')).name)
  const env=g.systems.find(x=>x.clouds&&x.sunColor),sky=g.scene.children.find(o=>'cloudLayerVisible' in o)
  for(const id of ['post.gi','post.bloom','post.shafts','post.flare','post.ao','post.contact','post.motionBlur','post.heat','post.plunge','post.look','post.vignette','post.grain'])p.set(id,0)
  for(const [id,value] of Object.entries({'gfx.level':2,'post.on':true,'post.clouds':1,'world.atmosphere':1,'weather.cloudCoverage':.5,'weather.cloudDensity':.7,'weather.cloudSpeed':0,'sun.dayLength':0,'sun.timeOfDay':12}))p.set(id,value)
  g.camera.position.y=50;g.camera.lookAt(g.camera.position.x,300,g.camera.position.z+600);g.camera.updateMatrixWorld()
  window.__syn3hCurve.updateCurve(g.camera.position,s.terrain.size);env.update(0)
  const draw=async()=>{for(let i=0;i<8;i++){g.postChain.render(g.renderer,g.scene,g.camera,16.667);await new Promise(requestAnimationFrame)}}
  const read=async target=>{const data=await g.renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height);return Array.from(data,v=>data instanceof Uint16Array?T.DataUtils.fromHalfFloat(v):v)}
  const alpha=async()=>{await draw();const node=g.postChain.built.disposables.find(d=>d.renderTarget?.texture.name==='Cloud radiance and opacity');return (await read(node.renderTarget)).filter((_,i)=>i%4===3)}
  const before=await alpha()
  window.cloudInvariant={T,env,sky,draw,read,alpha,before,position:g.camera.position.clone(),moved:[]}
 })
 await page.screenshot({path:`${out}/wrap-before.png`})
 results.wrap=await page.evaluate(async()=>{
  const s=window.syn3h,g=s.game,d=window.cloudInvariant,size=s.terrain.size
  for(const child of g.scene.children)if(child!==d.sky&&!child.isLight&&!child.isCamera){d.moved.push([child,child.position.x]);child.position.x+=size}
  g.camera.position.x+=size;g.camera.updateMatrixWorld();window.__syn3hCurve.updateCurve(g.camera.position,size);d.env.update(0)
  const after=await d.alpha();let sum=0,max=0
  for(let i=0;i<after.length;i++){const delta=Math.abs(after[i]-d.before[i]);sum+=delta;max=Math.max(max,delta)}
  return {backend:g.backend,pixels:after.length,meanDifference:sum/after.length,maxDifference:max}
 })
 await page.screenshot({path:`${out}/wrap-after.png`})
 assert.ok(results.wrap.meanDifference<.002,'wrapped view preserves cloud density')
 assert.ok(results.wrap.maxDifference<.05,'wrap has no large opacity discontinuity')
 results.lifecycle=await page.evaluate(async()=>{
  const s=window.syn3h,g=s.game,p=s.params,d=window.cloudInvariant
  for(const [child,x]of d.moved)child.position.x=x
  g.camera.position.copy(d.position);g.camera.updateMatrixWorld();window.__syn3hCurve.updateCurve(g.camera.position,s.terrain.size)
  p.set('world.atmosphere',0);p.set('sky.preset',2)
  const vacuum={registered:p.get('weather.cloudCoverage').value,effective:d.env.clouds.coverage}
  p.set('world.atmosphere',1)
  const air={registered:p.get('weather.cloudCoverage').value,effective:d.env.clouds.coverage}
  p.set('weather.cloudSpeed',.00002)
  const offset=()=>[d.env.clouds.offset.x,d.env.clouds.offset.y]
  const before=offset();p.set('gfx.level',1);g.postChain.release();const released=offset()
  d.env.update(1);await d.draw();const drifting=offset(),fallback=d.sky.cloudLayerVisible
  p.set('gfx.level',2);await d.draw();const restored=offset(),active=!d.sky.cloudLayerVisible
  p.set('weather.cloudSpeed',0)
  return {vacuum,air,before,released,drifting,restored,fallback,active}
 })
 const l=results.lifecycle
 assert.equal(l.vacuum.effective,0);assert.ok(l.vacuum.registered>0)
 assert.equal(l.air.effective,l.vacuum.registered);assert.equal(l.air.registered,l.vacuum.registered)
 assert.deepEqual(l.before,l.released);assert.notDeepEqual(l.before,l.drifting);assert.deepEqual(l.drifting,l.restored)
 assert.equal(l.fallback,true);assert.equal(l.active,true)
 results.reflections=await page.evaluate(async()=>{
  const g=window.syn3h.game,d=window.cloudInvariant
  const {SkyEnvironmentMap}=await import('/src/world/sky/SkyEnvironmentMap.ts')
  const map=new SkyEnvironmentMap(g.scene,g.renderer,d.sky),coverage=d.sky.cloudCoverage.value,original=d.sky.cloudLayerVisible
  const diff=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length
  try{
   d.sky.cloudLayerVisible=false;map.update(1,12);const hidden=await d.read(map.target),restoredAfterHidden=d.sky.cloudLayerVisible
   d.sky.cloudLayerVisible=true;map.invalidate();map.update(1,12);const visible=await d.read(map.target)
   d.sky.cloudCoverage.value=0;map.invalidate();map.update(1,12);const clear=await d.read(map.target)
   return {hiddenVsVisible:diff(hidden,visible),cloudyVsClear:diff(hidden,clear),restoredAfterHidden,finite:hidden.every(Number.isFinite)}
  }finally{d.sky.cloudCoverage.value=coverage;d.sky.cloudLayerVisible=original;map.dispose()}
 })
 assert.equal(results.reflections.finite,true);assert.equal(results.reflections.restoredAfterHidden,false)
 assert.ok(results.reflections.hiddenVsVisible<.001,'camera visibility does not remove reflection clouds')
 assert.ok(results.reflections.cloudyVsClear>.00001,'reflection capture contains cloud radiance')
 assert.deepEqual(errors,[])
}finally{writeFileSync(`${out}/report.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors:errors.slice(0,3),errorCount:errors.length},null,2));await browser.close()}
