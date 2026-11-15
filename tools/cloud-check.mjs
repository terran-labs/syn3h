/** Cloud suppression, depth, fallback and reflection checks. Run through heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base,out]=process.argv.slice(2);mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[],errors=[]
try {
 const page=await browser.newPage({viewport:{width:960,height:640}})
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 const url=new URL(base);url.searchParams.set('autoplay','1');url.searchParams.set('room',`cloud-check-${Date.now()}`)
 if(process.argv.includes('--webgl'))url.searchParams.set('webgl','1')
 await page.goto(url.href,{timeout:120000});await page.waitForFunction(()=>window.syn3h?.game?.tick>120,null,{timeout:120000})
 await page.evaluate(async()=>{
  const s=window.syn3h,g=s.game,p=s.params;g.renderer.setAnimationLoop(null)
  const moduleUrl=performance.getEntriesByType('resource').find(r=>r.name.includes('/three_webgpu.js'))?.name
  if(!moduleUrl)throw new Error('Game Three.js module unavailable')
  const T=await import(moduleUrl),env=g.systems.find(s=>s.clouds&&s.sunColor)
  const sky=g.scene.children.find(o=>'cloudLayerVisible' in o)
  if(!env||!sky)throw new Error('Cloud inputs unavailable')
  for(const id of ['post.gi','post.bloom','post.shafts','post.flare','post.ao','post.contact','post.motionBlur','post.heat','post.plunge','post.look','post.vignette','post.grain'])p.set(id,0)
  p.set('post.on',true);p.set('sun.dayLength',0);p.set('weather.cloudSpeed',0)
  window.cloudCheck={T,env,sky,initialCurve:p.get('world.curve').value}
 })
 const cases=[
  {name:'volume',hour:12}, {name:'horizon',coverage:1,horizon:true}, {name:'vacuum',air:0}, {name:'clear',coverage:0},
  {name:'zero-density',density:0}, {name:'off',strength:0}, {name:'lite',level:1},
  {name:'restored',hour:12}, {name:'moon',hour:23}, {name:'flat',curve:0},
  {name:'inside',curve:0,eye:380}, {name:'foreground',foreground:true},
 ]
 for(const c of cases){
  const state=await page.evaluate(async c=>{
   const s=window.syn3h,g=s.game,p=s.params,{T,env,sky,initialCurve}=window.cloudCheck
   p.set('gfx.level',c.level??2);p.set('post.clouds',c.strength??1)
   p.set('world.atmosphere',c.air??1);p.set('weather.cloudCoverage',c.coverage??.65);p.set('weather.cloudDensity',c.density??.7)
   p.set('world.curve',c.curve??initialCurve);p.set('sun.timeOfDay',c.hour??12)
   g.camera.position.y=c.eye??50;g.camera.lookAt(g.camera.position.x,(c.eye??50)+(c.eye?0:c.horizon?30:250),g.camera.position.z+600)
   g.camera.updateMatrixWorld();window.__syn3hCurve.updateCurve(g.camera.position,s.terrain.size)
   const hidden=[]
   if(c.horizon)for(const o of g.scene.children)if(o!==sky&&o.visible){hidden.push(o);o.visible=false}
   let wall
   if(c.foreground){wall=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicNodeMaterial({color:0x555555}));wall.position.copy(g.camera.position).addScaledVector(g.camera.getWorldDirection(new T.Vector3()),5);wall.quaternion.copy(g.camera.quaternion);g.scene.add(wall)}
   for(let i=0;i<16;i++){env.update(.02);g.postChain.render(g.renderer,g.scene,g.camera,16.667);await new Promise(requestAnimationFrame)}
   const volume=g.postChain.built?.disposables.find(d=>d.renderTarget?.texture.name==='Cloud radiance and opacity')
   let meanAlpha=0,maxAlpha=0,centerAlpha=0,finite=true
   if(volume){
    const target=volume.renderTarget,data=await g.renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height)
    for(let i=3;i<data.length;i+=4){const a=data instanceof Uint16Array?T.DataUtils.fromHalfFloat(data[i]):data[i];finite&&=Number.isFinite(a);meanAlpha+=a;maxAlpha=Math.max(maxAlpha,a)}
    const center=data[(Math.floor(target.height/2)*target.width+Math.floor(target.width/2))*4+3]
    centerAlpha=data instanceof Uint16Array?T.DataUtils.fromHalfFloat(center):center
    meanAlpha/=data.length/4
   }
   for(const o of hidden)o.visible=true
   if(wall){g.scene.remove(wall);wall.geometry.dispose();wall.material.dispose()}
   return {name:c.name,backend:g.backend,volume:!!volume,fallback:sky.cloudLayerVisible,coverage:env.clouds.coverage,air:env.clouds.atmosphere,lightDot:env.lightDirection.dot(env.sunDirection),meanAlpha,maxAlpha,centerAlpha,finite}
  },c)
  results.push(state);await page.screenshot({path:`${out}/${c.name}.png`})
  assert.equal(state.finite,true)
  const active=!['vacuum','clear','zero-density','off','lite'].includes(c.name)
  assert.equal(state.volume,active);assert.equal(state.fallback,!active)
  if(c.name==='volume'||c.name==='inside')assert.ok(state.maxAlpha>.01,'cloud layer has opacity')
  if(c.name==='foreground')assert.ok(state.maxAlpha<.001,'foreground depth clips clouds')
  if(c.name==='horizon')assert.ok(state.centerAlpha>.01,'a ray missing the planet still crosses clouds')
  if(c.name==='moon')assert.ok(state.lightDot<-.99,'moonlight uses moon direction')
 }
 const lifecycle=await page.evaluate(()=>{
  const {game:g}=window.syn3h,{env,sky}=window.cloudCheck
  const before=[env.clouds.offset.x,env.clouds.offset.y],captures=g.scene.userData.skyEnvironment.captures
  g.postChain.release();const after=[env.clouds.offset.x,env.clouds.offset.y]
  env.update(.6)
  return {before,after,fallback:sky.cloudLayerVisible,captures,capturesAfter:g.scene.userData.skyEnvironment.captures}
 })
 results.push({name:'release',...lifecycle});assert.equal(lifecycle.fallback,true);assert.deepEqual(lifecycle.before,lifecycle.after);assert.equal(lifecycle.captures,lifecycle.capturesAfter)
 assert.deepEqual(errors,[])
}finally{writeFileSync(`${out}/report.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors:errors.slice(0,3),errorCount:errors.length},null,2));await browser.close()}
