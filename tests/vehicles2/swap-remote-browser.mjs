// Two clients in one real room: kind replacement, cosmetic cloud and received motion.
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:5219'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5219','--strictPort'],{stdio:'ignore',env:{...process.env,SYN3H_ROOM_PORT:'18869'}})
const report={errors:[],steps:[]};let browser
try{
 for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
 const room='remote-swap-'+Date.now()
 const open=async()=>{
  const p=await (await browser.newContext({viewport:{width:1100,height:750}})).newPage()
  p.on('pageerror',e=>report.errors.push(e.message))
  await p.goto(base+'/?autoplay=1&vehicle=buggy&room='+room)
  await p.waitForFunction(()=>window.syn3hNet?.connected,null,{timeout:180000})
  await p.evaluate(()=>{const s=window.syn3h;s.shell.play();s.params.set('bots.count',0);s.params.set('gfx.auto',false)})
  await p.waitForFunction(()=>!window.syn3h.game.scene.userData.playerVehicleCache.pending,null,{timeout:120000})
  return p
 }
 const a=await open(),b=await open(),id=await b.evaluate(()=>window.syn3hNet.id)
 await a.waitForFunction(id=>window.syn3hNet.remotes.has(id),id,{timeout:30000})
 await a.evaluate(id=>{
  const s=window.syn3h,m=s.game.systems.find(x=>x.cloud&&typeof x.begin==='function')
  if(!m)throw new Error('Materialize system unavailable')
  window.__remoteCloud=m;window.__remoteRows=[]
  s.game.add({postPhysics(){const r=window.syn3hNet.remotes.get(id);if(!r)return;const v=r.vehicle,t=v.body.translation();window.__remoteRows.push({time:Date.now(),kind:v.kind,y:t.y,flag:!!v.object.userData.materializing,cloud:m.cloud.emitted,visible:m.cloud.mesh.visible,valid:v.body.isValid()})}})
 },id)
 for(const kind of ['jet','hovercraft','tank','buggy']){
  const before=await a.evaluate(()=>{window.__remoteRows=[];return window.__remoteCloud.cloud.emitted})
  const start=await b.evaluate(kind=>{const v=window.syn3h.swapVehicle(kind);return {time:Date.now(),y:v.body.translation().y,held:!!v.object.userData.materializing}},kind)
  assert.equal(start.held,true)
  await a.waitForFunction(({id,kind})=>window.syn3hNet.remotes.get(id)?.vehicle.kind===kind,{id,kind},{timeout:60000})
  await a.screenshot({path:'/tmp/swap-remote-'+kind+'.png'})
  await b.waitForTimeout(2500)
  const rows=await a.evaluate(()=>window.__remoteRows)
  const seen=rows.filter(r=>r.kind===kind),held=seen.filter(r=>r.time>=start.time+200&&r.time<start.time+900)
  const after=seen.filter(r=>r.time>start.time+1400)
  const result={kind,start,frames:seen.length,heldSamples:held.length,heldYRange:held.length?[Math.min(...held.map(r=>r.y)),Math.max(...held.map(r=>r.y))]:null,lateMinY:after.length?Math.min(...after.map(r=>r.y)):null,cloudEmitted:Math.max(before,...seen.map(r=>r.cloud))-before,remoteHeldFlag:seen.some(r=>r.flag)}
  report.steps.push(result)
  assert.ok(seen.length>0);assert.ok(seen.every(r=>r.valid));assert.ok(result.cloudEmitted>0,kind+' missing remote cloud')
 }
 assert.deepEqual(report.errors,[])
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM');await writeFile('/tmp/swap-remote-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
