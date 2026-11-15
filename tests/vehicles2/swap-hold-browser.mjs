// Materialization through the real swap entry point, including cached and rapid swaps.
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:5216'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5216','--strictPort'],{stdio:'ignore',env:{...process.env,SYN3H_ROOM_PORT:'18861'}})
const report={errors:[],steps:[]};let browser
try{
 for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(base+'/?autoplay=1&vehicle=buggy&room=hold-check',{waitUntil:'load'})
 await page.waitForFunction(()=>window.syn3h?.game.tick>90&&window.syn3hNet?.connected,null,{timeout:180000})
 await page.evaluate(()=>{window.syn3h.shell.play();document.activeElement?.blur?.()})
 await page.waitForFunction(()=>!window.syn3h.game.input.suspended,null,{timeout:15000})
 await page.evaluate(()=>{
  const s=window.syn3h;s.params.set('gfx.auto',false);s.params.set('bots.count',0)
  s.game.add({postPhysics(){const p=window.__holdProbe;if(!p)return;const v=s.player,b=v.body,t=b.translation(),q=b.rotation(),speed=b.linvel();const held=v.object.userData.materializing===true
   const row={tick:s.game.tick,held,y:t.y,x:t.x,z:t.z,up:1-2*(q.x*q.x+q.z*q.z),speed:Math.hypot(speed.x,speed.y,speed.z),input:[v.input.x,v.input.y,v.input.z,v.input.w,v.input.fire],requested:s.game.input.state.y,suspended:s.game.input.suspended}
   if(held)p.held.push(row);else if(p.held.length&&p.free.length<120)p.free.push(row)
  }})
 })
 for(const kind of ['jet','hovercraft','tank','buggy']){
  await page.keyboard.down('KeyW')
  const start=await page.evaluate(kind=>{window.__holdProbe={held:[],free:[]};const s=window.syn3h,v=s.swapVehicle(kind);const n=window.syn3hNet,shots=n.stats.shotsFired;n.fire();return {kind:v.kind,tick:s.game.tick,held:v.object.userData.materializing===true,y:v.body.translation().y,fireBlocked:n.stats.shotsFired===shots,hitIgnored:n.judgedId(v.body.handle)===null}},kind)
  assert.equal(start.held,true);assert.equal(start.fireBlocked,true);assert.equal(start.hitIgnored,true)
  await page.waitForFunction(()=>window.__holdProbe.held.length>=15,null,{timeout:60000})
  await page.keyboard.up('KeyW')
  await page.screenshot({path:`/tmp/swap-hold-${kind}.png`})
  await page.waitForFunction(()=>window.__holdProbe.free.length>=110,null,{timeout:60000})
  const result=await page.evaluate(()=>{const p=window.__holdProbe,s=window.syn3h;return {...p,kind:s.player.kind,kinematic:s.player.body.isKinematic(),heldFlag:s.player.object.userData.materializing===true}})
  report.last=result
  assert.ok(result.held.some(row=>row.requested!==0&&!row.suspended),`${kind} must ignore a real unsuspended drive request`)
  assert.equal(result.kind,kind);assert.equal(result.heldFlag,false);assert.equal(result.kinematic,false)
  assert.ok(result.held.length>=48&&result.held.length<=51,`${kind} held ${result.held.length} ticks`)
  for(const row of result.held){assert.ok(Math.abs(row.y-start.y)<.001);assert.ok(row.speed<.01,`${kind} speed ${row.speed} at ${row.tick}`);assert.ok(row.up>.999);assert.deepEqual(row.input,[0,0,0,0,false])}
  assert.ok(Math.min(...result.free.map(r=>r.y))<start.y-.1,`${kind} did not drop`)
  const canFire=await page.evaluate(()=>{const n=window.syn3hNet,before=n.stats.shotsFired;n.fire();return n.stats.shotsFired===before+1})
  assert.equal(canFire,true)
  report.steps.push({kind,ignoredDrive:result.held.some(row=>row.requested!==0&&!row.suspended),heldTicks:result.held.length,startY:start.y,minFreeY:Math.min(...result.free.map(r=>r.y)),finalY:result.free.at(-1).y})
 }
 report.rapid=await page.evaluate(()=>{const s=window.syn3h,a=s.swapVehicle('jet'),same=s.swapVehicle('jet'),stillHeld=a.object.userData.materializing===true,b=s.swapVehicle('tank'),again=s.swapVehicle('jet');return {same:same===a,stillHeld,reused:again===a,tankDisabled:!b.body.isEnabled(),tankDynamic:!b.body.isKinematic(),tankClear:!b.object.userData.materializing,jetHeld:!!a.object.userData.materializing}})
 assert.ok(Object.values(report.rapid).every(Boolean));assert.equal(report.errors.length,0)
}catch(e){report.failure=String(e);process.exitCode=1}finally{await browser?.close();server.kill('SIGTERM');await writeFile('/tmp/swap-hold-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,last:undefined}))}
