// Run only in a cleared heavy.sh slot. One browser process, two real room clients.
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const port=Number(process.env.HEADLIGHT_PORT??5223),base=`http://127.0.0.1:${port}`
const output=process.env.HEADLIGHT_REPORT_DIR??'/tmp/remote-headlights'
await mkdir(output,{recursive:true})
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{detached:true,stdio:'ignore',env:{...process.env,SYN3H_ROOM_PORT:'18873'}})
const report={errors:[],levels:[],changes:[],limitations:['Headless Mac Chrome timings; GPU timestamp timing is not available through the game performance interface.','Sixteen actual bots retained by a test-only count-reconciliation override when measuring lower quality tiers.']}
let browser
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  for(let i=0;i<180;i++){try{if((await fetch(base)).ok)break}catch{}await pause(500)}
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  const room='headlights-'+Date.now()
  const open=async name=>{
    const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage()
    page.on('pageerror',e=>report.errors.push(name+': '+e.message))
    await page.goto(`${base}/?autoplay=1&vehicle=buggy&room=${room}&name=${name}`)
    await page.waitForFunction(()=>window.syn3hNet?.connected&&window.syn3h?.game.tick>20,null,{timeout:180000})
    await page.evaluate(()=>{const s=window.syn3h;s.shell.play();s.params.set('gfx.auto',false);s.params.set('bots.count',0);s.params.set('sun.timeOfDay',0)})
    await page.waitForFunction(()=>!window.syn3h.game.scene.userData.playerVehicleCache?.pending,null,{timeout:180000})
    return page
  }
  const a=await open('Headlight observer'),b=await open('Headlight sender')
  const id=await b.evaluate(()=>window.syn3hNet.id)
  await a.waitForFunction(id=>window.syn3hNet.remotes.has(id),id,{timeout:60000})
  await a.evaluate(()=>{const s=window.syn3h;s.params.set('gfx.quality',5);s.params.set('bots.fleet',1);s.params.set('bots.canDrive',false);s.params.set('bots.count',16)})
  await a.waitForFunction(()=>window.syn3h.bots.vehicles.length===16,null,{timeout:120000})
  await a.evaluate(async()=>{
    const s=window.syn3h,T=await import('/node_modules/three/build/three.webgpu.js')
    // Retain the same 16 real bot instances across tiers; do not conflate fewer bots with savings.
    s.bots.update=()=>{}
    const centre=s.player.body.translation();window.__headlightCentre={x:centre.x,y:centre.y,z:centre.z}
    const fixtures=s.bots.vehicles.map((v,i)=>({v,x:centre.x+(i-7.5)*4.5,z:centre.z-18-(i%2)*7}))
    s.game.add({update(){for(const f of fixtures){const y=s.terrain.heightAt(f.x,f.z)+(f.v.kind==='hovercraft'?2.5:1);f.v.teleport(new T.Vector3(f.x,y,f.z),0);f.v.object.visible=true}}})
    window.__headlightFixtures=fixtures;window.__headlightMetrics=[];window.__headlightPipelines=0
    const device=s.game.renderer.backend.device
    if(device)for(const name of ['createRenderPipeline','createRenderPipelineAsync']){const original=device[name].bind(device);device[name]=(...args)=>{window.__headlightPipelines++;return original(...args)}}
    let last=performance.now()
    function tick(){const now=performance.now(),h=s.game.scene.userData.remoteHeadlights,p=s.game.performance;window.__headlightMetrics.push({frame:now-last,update:h.updateMs,quads:h.quads,lamps:h.lamps,draws:p.drawCalls,triangles:p.triangles});last=now;requestAnimationFrame(tick)}
    requestAnimationFrame(tick)
  })
  const centre=await a.evaluate(()=>window.__headlightCentre)
  await b.evaluate(async c=>{
    const s=window.syn3h,T=await import('/node_modules/three/build/three.webgpu.js')
    s.game.add({update(){const v=s.player,y=s.terrain.heightAt(c.x,c.z-12)+1;v.teleport(new T.Vector3(c.x,y,c.z-12),0)}})
  },centre)
  // Warm all received kinds before testing repeat arrivals. No dummy material/compile target.
  for(const kind of ['jet','hovercraft','tank','buggy']){
    await b.evaluate(kind=>window.syn3h.swapVehicle(kind),kind)
    await a.waitForFunction(({id,kind})=>window.syn3hNet.remotes.get(id)?.vehicle.kind===kind,{id,kind},{timeout:60000})
    await a.waitForTimeout(2500)
  }
  const measure=async enabled=>{
    await a.evaluate(enabled=>{window.syn3h.params.set('vehicle.remoteBeamBrightness',enabled?1:0)},enabled)
    await a.waitForTimeout(1500)
    await a.evaluate(()=>{window.__headlightMetrics=[]})
    await a.waitForTimeout(3500)
    return a.evaluate(()=>{
      const rows=window.__headlightMetrics,percent=(key,p)=>{const xs=rows.map(r=>r[key]).sort((a,b)=>a-b);return xs[Math.min(xs.length-1,Math.floor(xs.length*p))]}
      return {frames:rows.length,frameMedian:percent('frame',.5),frameP95:percent('frame',.95),effectUpdateMedian:percent('update',.5),effectUpdateP95:percent('update',.95),draws:percent('draws',.5),triangles:percent('triangles',.5),maxLamps:Math.max(...rows.map(r=>r.lamps)),maxQuads:Math.max(...rows.map(r=>r.quads))}
    })
  }
  for(let level=0;level<6;level++){
    await a.evaluate(level=>window.syn3h.params.set('gfx.quality',level),level)
    await a.waitForTimeout(5000)
    const off=await measure(false),on=await measure(true)
    report.levels.push({level,off,on,frameMedianDelta:on.frameMedian-off.frameMedian,effectUpdateDelta:on.effectUpdateMedian-off.effectUpdateMedian})
    assert.ok(on.frames>20)
    if(level===0)assert.equal(on.maxQuads,0);else assert.ok(on.maxQuads>0)
    if(level===3||level===5)await a.screenshot({path:`${output}/chase-${level}.png`})
  }
  await a.evaluate(()=>{
    const s=window.syn3h,c=window.__headlightCentre
    // Override the camera only in this capture fixture, after the normal camera update.
    s.game.add({update(){s.game.camera.position.set(c.x,c.y+65,c.z+20);s.game.camera.lookAt(c.x,c.y,c.z-25)}})
  })
  await a.waitForTimeout(1000);await a.screenshot({path:`${output}/above.png`})
  for(const kind of ['jet','hovercraft','tank','buggy']){
    const before=await a.evaluate(()=>window.__headlightPipelines)
    await b.evaluate(kind=>window.syn3h.swapVehicle(kind),kind)
    await a.waitForFunction(({id,kind})=>window.syn3hNet.remotes.get(id)?.vehicle.kind===kind,{id,kind},{timeout:60000})
    await a.waitForTimeout(1800)
    report.changes.push(await a.evaluate(({id,before})=>{
      const s=window.syn3h,r=window.syn3hNet.remotes.get(id).vehicle
      let lights=0;s.game.scene.traverse(o=>{if(o.isSpotLight)lights++})
      return {kind:r.kind,pipelines:window.__headlightPipelines-before,lights,sourceCount:r.object.userData.headlights?.count,lamps:s.game.scene.userData.remoteHeadlights.lamps}
    },{id,before}))
  }
  for(const level of [4,5]){
    await a.evaluate(level=>{window.syn3h.params.set('gfx.quality',level)},level);await a.waitForTimeout(4000)
    for(let i=0;i<8;i++){
      await a.evaluate(i=>{for(const f of window.__headlightFixtures)f.x+=i%2?1:-1;window.syn3h.params.set('vehicle.remoteBeamBrightness',i<4?1:0)},i)
      await a.waitForTimeout(80);await a.screenshot({path:`${output}/history-${level}-${i}.png`})
    }
  }
  assert.deepEqual(report.errors,[])
  for(const change of report.changes)assert.equal(change.lights,2)
  // Pipeline counts are reported, not hidden by a permissive threshold. Review any nonzero delta.
} catch(error){report.failure=String(error);process.exitCode=1}
finally{
  await browser?.close();report.browserClosed=true
  try{process.kill(-server.pid,'SIGTERM');report.serverGroupStopped=server.pid}catch(error){if(error.code!=='ESRCH')throw error}
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
