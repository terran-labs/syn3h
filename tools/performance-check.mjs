/** Bounded ordinary-entry profiling. No feature URL, extra adapter probe or governor replacement. */
import { chromium } from 'playwright-core'
import { createServer as createVite } from 'vite'
import { createServer } from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import assert from 'node:assert/strict'
const out=process.argv[2];assert.ok(out,'Unique output directory required');await mkdir(out)
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})
const roomPort=await freePort(),port=await freePort(),origin=`http://127.0.0.1:${port}`
process.env.SYN3H_NO_ROOM_SERVER='1';process.env.VITE_SERVER_URL=`ws://127.0.0.1:${port}`
const room=spawn(process.execPath,['--import','tsx','server/dev.ts'],{env:{...process.env,PORT:String(roomPort)},stdio:['ignore','pipe','pipe']})
let roomLog='';room.stdout.on('data',x=>roomLog+=x);room.stderr.on('data',x=>roomLog+=x)
let vite,browser;const results=[],errors=[],consoleErrors=[],events=[]
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const quantile=(a,q)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*q))]??null}
try{
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${roomPort}/status`)).ok)break}catch{}if(i===99)throw Error('Room startup timeout');await pause(100)}
 vite=await createVite({server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${roomPort}`,ws:true},'/presence':{target:`http://127.0.0.1:${roomPort}`}}}});await vite.listen()
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 for(const scene of ['volcanic','archipelago','multiplayer']){
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1}),roomName=`perf${Date.now()}`
  const open=async name=>{
   const page=await context.newPage();page.on('pageerror',e=>errors.push(`${scene}/${name}: ${e.message}`));page.on('console',m=>{if(m.type()==='error'&&consoleErrors.length<40)consoleErrors.push({scene,name,at:Date.now(),text:m.text()})})
   page.on('websocket',ws=>{if(ws.url().includes('/ws?'))assert.ok(ws.url().startsWith(`ws://127.0.0.1:${port}/ws?`),'isolated endpoint')})
   await page.goto(`${origin}/?room=${roomName}&name=${name}`)
   await page.waitForFunction(()=>window.syn3h?.shell,null,{timeout:90000})
   await page.locator('.galaxy-label.is-current').press('Enter')
   await page.waitForFunction(()=>window.syn3h.shell.playing&&window.syn3hNet?.connected,null,{timeout:90000})
   return page
  }
  const host=await open('PerfHost')
  events.push({scene,event:'applyPlanet',at:Date.now()})
  await host.evaluate(async scene=>{const {applyPlanet}=await import('/src/world/planets.ts');applyPlanet(scene==='archipelago'?'archipelago':'volcanic',49731);const s=window.syn3h;s.params.set('gfx.auto',false);s.params.set('gfx.level',2)},scene)
  if(scene==='multiplayer')await open('PerfGuest')
  await host.waitForTimeout(5000)
  if(scene==='archipelago')await host.evaluate(()=>{
   const s=window.syn3h,t=s.terrain
   for(let z=-600;z<=600;z+=20)for(let x=-600;x<=600;x+=20){
    if(t.liquidKindAt(x,z)!==null)continue
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     if(t.liquidKindAt(x+dx*35,z+dz*35)!=='water')continue
     const h=t.heightAt(x,z);if(h-t.liquidHeightAt(x+dx*35,z+dz*35)>12)continue
     s.player.teleport({x,y:h+2,z},Math.atan2(dx,-dz));return
    }
   }
   throw Error('No repeatable dry shore viewpoint')
  })
  await host.waitForTimeout(3000)
  const setup=await host.evaluate(()=>{
   const s=window.syn3h,g=s.game,r=g.renderer,b=r.backend,d=b.device,a=d?.adapterInfo
   const samples=[],original=g.quality.frame.bind(g.quality);let collecting=false,renderCpuMs=0
   const owner=g.postChain??r,renderKey=g.postChain?'render':'render',render=owner[renderKey].bind(owner)
   owner[renderKey]=(...args)=>{const t=performance.now();try{return render(...args)}finally{renderCpuMs+=performance.now()-t}}
   g.quality.frame=(m,judge)=>{const t=performance.now();original(m,judge);const telemetryMs=performance.now()-t;if(collecting&&judge&&!document.hidden&&m.frameMs>0&&m.frameMs<=1000&&samples.length<10000)samples.push({...m,telemetryMs,renderCpuMs});renderCpuMs=0}
   window.performanceCheck={start(){samples.length=0;collecting=true},stop(){collecting=false;return{samples,memory:{...r.info.memory},quality:{level:s.params.get('gfx.level').value,auto:s.params.get('gfx.auto').value,rung:g.quality.governor.rung,settings:{...g.quality.governor.settings},targetMs:g.quality.governor.targetMs},bots:s.bots.vehicles.map(v=>v.kind),remotes:window.syn3hNet.remotes.size}}}
   return{backend:g.backend,adapter:a?{vendor:a.vendor,architecture:a.architecture,description:a.description}:null,viewport:[innerWidth,innerHeight],buffer:[g.canvas.width,g.canvas.height],pixelRatio:r.getPixelRatio(),seed:s.params.get('world.seed').value,botDefaults:[s.params.get('bots.count').value,s.params.get('bots.fleet').value],water:{seaKind:s.params.get('world.seaKind')?.value??null,waves:s.params.get('water.waves')?.value??null},position:{...s.player.body.translation()}}
  })
  for(const panel of ['hidden','visible']){
   if(panel==='visible')await host.keyboard.press('F3')
   await host.evaluate(()=>window.performanceCheck.start());await host.waitForTimeout(12000)
   const trace=await host.evaluate(()=>window.performanceCheck.stop());assert.ok(trace.samples.length>50,'enough eligible frames')
   const summary={};for(const key of ['frameMs','physicsMs','renderCpuMs','drawCalls','triangles','telemetryMs'])summary[key]={p50:quantile(trace.samples.map(s=>s[key]),.5),p90:quantile(trace.samples.map(s=>s[key]),.9),p95:quantile(trace.samples.map(s=>s[key]),.95),max:Math.max(...trace.samples.map(s=>s[key]))}
   const row={scene,panel,setup,...trace,summary,stalls:trace.samples.filter(s=>s.frameMs>50).length,load:loadavg()};results.push(row);console.log(JSON.stringify({scene,panel,setup,summary,quality:row.quality,stalls:row.stalls,bots:row.bots,remotes:row.remotes,load:row.load}))
  }
  if(await host.evaluate(()=>!!window.syn3h.game.quality.getPerformanceSnapshot)){
   const check=await host.evaluate(()=>{
    const q=window.syn3h.game.quality;let calls=0
    const off=q.subscribePerformance(()=>calls++);const initial=calls;off();q.setDiagnosticsVisible(false)
    return{history:q.getPerformanceSnapshot().history.length,initial,calls,visible:q.getPerformanceSnapshot().visible}
   });assert.ok(check.history<=120);assert.equal(check.initial,1);assert.equal(check.calls,1);assert.equal(check.visible,false)
  }
  await host.screenshot({path:`${out}/${scene}.png`});await context.close()
 }
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[],'renderer console must be clean')
}finally{
 await writeFile(`${out}/results.json`,JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,errors,consoleErrors,events,roomLog},null,2))
 await browser?.close();await vite?.close();room.kill('SIGTERM')
}
