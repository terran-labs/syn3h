// Exercise the real swap entry point before and during background warming.
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:5218'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5218','--strictPort'],{stdio:'ignore',env:{...process.env,SYN3H_NO_ROOM_SERVER:'1'}})
const report={errors:[],cases:[]};let browser
try{
 for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 for(const mode of ['before','during']){
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(base+'/?autoplay=1&vehicle=buggy&room=early-'+mode,{waitUntil:'load'})
  await page.waitForFunction(()=>window.syn3h?.swapVehicle,null,{timeout:180000})
  await page.evaluate(mode=>{
   const s=window.syn3h;s.shell.play();document.activeElement?.blur?.();s.params.set('bots.count',0);s.params.set('gfx.auto',false)
   const stats=s.game.scene.userData.playerVehicleCache
   const run=()=>{
    const kind=mode==='before'?'tank':stats.current
    const old=s.player, v=s.swapVehicle(kind)
    window.__early={mode,kind,pending:stats.pending,wasWarming:stats.current===kind,held:!!v.object.userData.materializing,scale:v.object.scale.toArray(),enabled:v.body.isEnabled(),oldDisabled:!old.body.isEnabled(),oldDetached:old.object.parent===null}
   }
   if(mode==='before'){
    if(stats.current||!stats.pending)throw new Error('Missed the before-warming window')
    run()
   }else{
    s.game.add({update(){
     if(window.__early||!stats.current)return
     // Wait until the real instance has been shrunk and hooked for drawing.
     if(!s.game.scene.children.some(o=>o.scale.x===.001))return
     run()
    }})
   }
  },mode)
  await page.waitForFunction(()=>window.__early,null,{timeout:120000})
  const start=await page.evaluate(()=>window.__early)
  assert.equal(start.pending,true);assert.equal(start.held,true);assert.equal(start.enabled,true)
  assert.deepEqual(start.scale,[1,1,1]);assert.equal(start.oldDisabled,true);assert.equal(start.oldDetached,true)
  if(mode==='during')assert.equal(start.wasWarming,true)
  await page.waitForFunction(()=>!window.syn3h.player.object.userData.materializing&&!window.syn3h.game.scene.userData.playerVehicleCache.pending,null,{timeout:120000})
  // End on the buggy to prove normal driving after the warm-up interruption.
  await page.evaluate(()=>window.syn3h.swapVehicle('buggy'))
  await page.waitForFunction(()=>!window.syn3h.player.object.userData.materializing)
  await page.keyboard.down('KeyW');await page.waitForTimeout(2000);await page.keyboard.up('KeyW')
  const end=await page.evaluate(()=>{const s=window.syn3h,v=s.player,b=v.body.linvel();return {scale:v.object.scale.toArray(),enabled:v.body.isEnabled(),dynamic:!v.body.isKinematic(),visible:v.object.visible,attached:v.object.parent===s.game.scene,speed:Math.hypot(b.x,b.y,b.z),bodies:s.game.world.bodies.len(),inputSuspended:s.game.input.suspended}})
  assert.deepEqual(end.scale,[1,1,1]);assert.equal(end.enabled,true);assert.equal(end.dynamic,true);assert.equal(end.visible,true);assert.equal(end.attached,true);assert.equal(end.inputSuspended,false);assert.ok(end.speed>1)
  report.cases.push({start,end});await page.close()
 }
 assert.deepEqual(report.errors,[])
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM');await writeFile('/tmp/swap-early-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
