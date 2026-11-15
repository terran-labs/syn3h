/** GPU-backed profiling with one change per case, fresh contexts, fixed quality and pixel ratio.
 * node tools/frame-profile.mjs [URL] [output JSON] [headed|headless] [all|probe|verify|round]
 * round: the round planet against the same world drawn flat, back to back at 1920 x 1080,
 * parked, moving and with eight bots; the first pair is repeated at the end to show drift.
 * Set PROFILER_WAIT_QUIET=1 to gate launch on host load below 3 and run unchanged terrain tests.
 * Otherwise host load is recorded and paired measurements run immediately.
 * CPU submission time, GPU timestamp time and RAF interval are separate measurements.
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
const url=process.argv[2]??'http://127.0.0.1:5186/?autoplay=1&vehicle=buggy'
const output=process.argv[3]??'/tmp/syn3h-frame-profile.json', headless=process.argv[4]==='headless'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
while(loadavg()[0]>=3&&process.env.PROFILER_WAIT_QUIET==='1'){console.log('Waiting for quiet host',loadavg());await sleep(30000)}
const startLoad=loadavg(), results=[]
if(process.argv[5]!=='probe'&&process.env.PROFILER_WAIT_QUIET==='1'){
 const log=execFileSync('npx',['vitest','run','tests/world/terrain.test.ts','--maxWorkers=1'],{env:{...process.env,SYN3H_NO_ROOM_SERVER:'1'},encoding:'utf8'})
 await writeFile('/tmp/syn3h-quiet-terrain.log',log)
 console.log('Quiet terrain test complete',loadavg())
 while(loadavg()[0]>=3){console.log('Waiting after terrain check',loadavg());await sleep(30000)}
}
const browser=await chromium.launch({channel:'chrome',headless,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const cases=['baseline','shadow0','shadow1','shadow3','terrainLow','terrainMedium','skyOff','cloudZero','effectsOff','moving','movingEffectsOff','night','nightHeadlightOff','bots4','bots8','koth','koth4','koth8','kothMarkerOff','minimapOff','tags8','domOff','lobby','pixel075','pixel15','pixel2','uniformSweep','baselineEnd']
try {
 for(const [width,height] of process.argv[5]==='probe'?[[1280,720]]:process.argv[5]==='round'?[[1920,1080]]:process.argv[5]==='verify'?[[1920,1080],[390,844]]:[[1280,720],[1920,1080],[390,844]]) {
  for(const variant of process.argv[5]==='probe'?['baseline']:process.argv[5]==='round'?['round','flat','roundMoving','flatMoving','roundBots8','flatBots8','round','flat']:process.argv[5]==='verify'?(width===390?['qualityMobile4','qualitySafe2']:['qualityDesktop8']):width===390?['phone0','phone1','phone2']:cases){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:width===390?3:process.argv[5]==='verify'?2:1})
   await context.routeWebSocket(/\/ws(?:\?|$)/,socket=>socket.close())
   const page=await context.newPage(), errors=[]
   page.on('pageerror',e=>errors.push(e.message))
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
   await page.goto(url);await page.waitForFunction(()=>window.syn3h?.game.tick>10,null,{timeout:90000})
   const setup=await page.evaluate(async variant=>{
    const s=window.syn3h,g=s.game,r=g.renderer;s.shell.play();s.bots.remote=false
    s.params.set('gfx.level',2);s.params.set('bots.count',0);s.params.set('sun.dayLength',0)
    // Keep the requested quality throughout the experiment; no adaptive downgrade.
    g.quality.frame=()=>{};r.setPixelRatio(1)
    if(variant.startsWith('phone'))s.params.set('gfx.level',Number(variant.slice(5)))
    if(variant==='phone2'){s.params.set('gfx.level',0);s.params.set('gfx.level',2)}
    if(variant.startsWith('quality')){
      const level=variant==='qualityDesktop8'?2:variant==='qualityMobile4'?1:0
      s.params.set('gfx.level',0);s.params.set('gfx.level',level)
      s.params.set('bots.count',level===2?8:level===1?4:2)
    }
    const adapter=await navigator.gpu.requestAdapter(),i=adapter.info
    r.backend.trackTimestamp=r.hasFeature('timestamp-query')
    const systems=g.systems, effects=systems.find(x=>x.constructor.name==='EffectWorld')
    if(variant.startsWith('shadow'))s.params.set('gfx.shadowQuality',Number(variant.slice(6)))
    if(variant==='terrainLow'||variant==='terrainMedium')s.terrain.setRenderQuality({level:variant==='terrainLow'?0:1,drawDistance:variant==='terrainLow'?700:1400,detail:variant==='terrainLow'?.5:.75})
    if(variant==='skyOff')for(const o of g.scene.children)if(o.constructor.name==='AlienSkyMesh')o.visible=false
    if(variant==='cloudZero')s.params.set('weather.cloudCoverage',0)
    if(variant==='effectsOff'||variant==='movingEffectsOff'){
      effects.update=()=>{};effects.postPhysics=()=>{}
      for(const key of ['dust','energy','sparks','redSparks','marks','trails'])effects[key].mesh.visible=false
      for(const e of effects.vehicles.values())e.root.visible=false
    }
    if(variant==='night'||variant==='nightHeadlightOff')s.params.set('sun.timeOfDay',0)
    if(variant==='nightHeadlightOff')g.scene.traverse(o=>{if(o.isSpotLight)o.visible=false})
    if(variant==='bots4'||variant==='bots8')s.params.set('bots.count',Number(variant.slice(4)))
    // Round planet against the same world drawn flat: world.curve 1 is the default, 0 is flat.
    if(variant.startsWith('round')||variant.startsWith('flat')){s.params.set('world.curve',variant.startsWith('flat')?0:1);if(variant.endsWith('Bots8')){s.params.set('bots.freeSpirit',0);s.params.set('bots.count',8)}}
    if(variant.startsWith('koth')){
      s.params.set('game.mode',1)
      const summit=s.terrain.summit(),x=summit.x+summit.rimRadius,z=summit.z
      s.player.teleport({x,y:s.terrain.heightAt(x,z)+2,z},Math.PI/2)
      if(variant==='koth4'||variant==='koth8')s.params.set('bots.count',Number(variant.slice(4)))
      if(variant==='kothMarkerOff'){const hill=window.syn3hNet.hill;hill.setZone=()=>{};hill.group.visible=false}
    }
    if(variant==='minimapOff'){s.shell.minimap.update=()=>{};s.shell.minimap.element.hidden=true}
    if(variant==='tags8'){
      const tags=window.syn3hNet.tags, original=tags.update.bind(tags)
      const list=Array.from({length:8},(_,i)=>({vehicle:{object:{position:s.player.object.position.clone().add({x:(i-4)*3,y:0,z:-15})}},name:`Profile ${i}`,it:false}))
      tags.update=()=>original(list)
    }
    if(variant==='domOff')for(const node of document.body.children)if(node.tagName!=='CANVAS'&&node.tagName!=='SCRIPT')node.style.display='none'
    if(variant==='lobby')s.shell.openMenu()
    if(variant==='uniformSweep')setInterval(()=>s.params.set('weather.cloudCoverage',.15+.05*Math.sin(performance.now()/500)),100)
    if(variant.startsWith('pixel'))r.setPixelRatio({pixel075:.75,pixel15:1.5,pixel2:2}[variant])
    const cpu={}, originalRender=r.render.bind(r)
    let renderMs=0,lastTick=g.tick,gpuPending=false,lastGpu=null,pipelines=0
    const createPipeline=r.backend.createRenderPipeline.bind(r.backend)
    r.backend.createRenderPipeline=(...args)=>{pipelines++;return createPipeline(...args)}
    let instrumentIndex=0
    const instrument=system=>{const index=instrumentIndex++;for(const method of ['update','fixedUpdate','postPhysics'])if(typeof system[method]==='function'){
      const original=system[method].bind(system),key=`${system.constructor.name||'object'}:${index}.${method}`
      system[method]=(...args)=>{const t=performance.now();const result=original(...args);cpu[key]=(cpu[key]??0)+performance.now()-t;return result}
    }}
    systems.forEach(instrument)
    const add=g.add.bind(g);g.add=system=>{instrument(system);return add(system)}
    r.render=(...args)=>{const t=performance.now();const result=originalRender(...args);renderMs+=performance.now()-t;return result}
    const samples=[];let collecting=false
    g.quality.frame=metrics=>{
      if(collecting)samples.push({...metrics,cpu:{...cpu},renderCpuMs:renderMs,pipelines,gpuMs:lastGpu,steps:g.tick-lastTick,environmentCaptures:g.scene.userData.skyEnvironment?.captures,effectsMs:g.scene.userData.vehicleEffects?.updateMs})
      for(const key of Object.keys(cpu))cpu[key]=0;renderMs=0;pipelines=0;lastTick=g.tick
      if(r.backend.trackTimestamp&&!gpuPending){gpuPending=true;r.resolveTimestampsAsync().then(value=>{lastGpu=value}).finally(()=>{gpuPending=false})}
    }
    window.frameProfile={samples,start(){samples.length=0;collecting=true;if(variant==='moving'||variant==='movingEffectsOff'||variant.endsWith('Moving'))g.input.external.y=1},stop(){collecting=false;return {samples,terrain:s.terrain.triangleStats?.(),pixelRatio:r.getPixelRatio(),drawingBuffer:[r.domElement.width,r.domElement.height],devicePixelRatio:window.devicePixelRatio,rendererMemory:r.info.memory,botCount:s.bots.vehicles.length}}}
    return {adapter:{vendor:i.vendor,architecture:i.architecture,description:i.description,fallback:i.isFallbackAdapter},timestampQueries:r.backend.trackTimestamp,backend:g.backend}
   },variant)
   await page.waitForTimeout(2500)
   await page.evaluate(()=>window.frameProfile.start());await page.waitForTimeout(5000)
   const trace=await page.evaluate(()=>window.frameProfile.stop())
   const percentile=(values,p)=>{values=values.filter(Number.isFinite).sort((a,b)=>a-b);return values.length?values[Math.floor((values.length-1)*p)]:null}
   const median=key=>percentile(trace.samples.map(s=>s[key]),.5)
   const cpuKeys=new Set(trace.samples.flatMap(s=>Object.keys(s.cpu)))
   const mean=values=>values.reduce((a,b)=>a+b,0)/values.length
   const cpu=Object.fromEntries([...cpuKeys].map(key=>[key,mean(trace.samples.map(s=>s.cpu[key]??0))]))
   const result={width,height,variant,load:loadavg(),...setup,summary:{frames:trace.samples.length,frameMs:median('frameMs'),p95Ms:percentile(trace.samples.map(s=>s.frameMs),.95),renderCpuMs:median('renderCpuMs'),gpuMs:median('gpuMs'),physicsMs:mean(trace.samples.map(s=>s.physicsMs)),pipelineCreates:trace.samples.reduce((sum,s)=>sum+s.pipelines,0),drawCalls:median('drawCalls'),triangles:median('triangles'),maxSteps:Math.max(...trace.samples.map(s=>s.steps)),cpu},...trace,errors}
   if(variant==='baselineEnd')await page.screenshot({path:`/tmp/syn3h-profile-${width}.png`})
   results.push(result);await writeFile(output,JSON.stringify({headless,startLoad,results},null,2));console.log(width,height,variant,JSON.stringify(result.summary))
   await context.close()
  }
 }
}finally{await browser.close()}
