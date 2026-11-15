// Run through tools/heavy.sh. Records first-use and repeat switch stalls separately.
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const base='http://127.0.0.1:5216'
const server=spawn('npx',['vite','--host','127.0.0.1','--port','5216','--strictPort'],{stdio:'ignore',env:{...process.env,SYN3H_NO_ROOM_SERVER:'1'}})
const report={errors:[],steps:[]};let browser
try{
 for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 page.on('pageerror',e=>report.errors.push(e.message))
 let loads=0;page.on('framenavigated',f=>{if(f===page.mainFrame())loads++})
 await page.goto(base+'/?autoplay=1&vehicle=buggy&room=swap-perf',{waitUntil:'load'})
 await page.waitForFunction(()=>window.syn3h?.game.tick>60,null,{timeout:180000})
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('gfx.auto',false);s.params.set('bots.count',0);window.__gaps=[];window.__pipes=0;let last=performance.now();function frame(){const now=performance.now();window.__gaps.push(now-last);last=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);const d=s.game.renderer.backend.device;if(d)for(const name of ['createRenderPipeline','createRenderPipelineAsync']){const real=d[name].bind(d);d[name]=x=>{window.__pipes++;return real(x)}}})
 await page.waitForTimeout(4000)
 const initialLoads=loads
 report.backend=await page.evaluate(()=>window.syn3h.game.backend)
 for(let i=0;i<20;i++){
  const kind=['jet','hovercraft','tank','buggy'][i%4]
  const before=await page.evaluate(()=>{window.__gaps=[];return window.__pipes})
  const start=Date.now()
  await page.evaluate(kind=>window.syn3h.swapVehicle(kind)?.kind,kind)
  await page.waitForTimeout(6000)
  const row=await page.evaluate(()=>{const s=window.syn3h;let lights=0,objects=0;s.game.scene.traverse(o=>{objects++;if(o.isSpotLight)lights++});return {kind:s.player.kind,worstFrameMs:Math.round(Math.max(...window.__gaps)),pipelines:window.__pipes,bodies:s.game.world.bodies.len(),colliders:s.game.world.colliders.len(),lights,objects,tick:s.game.tick}})
  row.pipelines-=before;row.elapsed=Date.now()-start;report.steps.push(row);console.log(JSON.stringify(row))
 }
 report.loads=loads-initialLoads
 await page.keyboard.down('KeyW');await page.waitForTimeout(3000);await page.keyboard.up('KeyW')
 report.finalSpeed=await page.evaluate(()=>{const v=window.syn3h.player.body.linvel();return Math.hypot(v.x,v.y,v.z)})
 assert.equal(report.loads,0);assert.equal(report.errors.length,0)
 for(const row of report.steps.slice(4)){assert.equal(row.bodies,report.steps[3].bodies);assert.equal(row.lights,2)}
}catch(e){report.failure=String(e);process.exitCode=1}finally{await browser?.close();server.kill('SIGTERM');await writeFile(process.env.SWAP_REPORT??'/tmp/swap-reuse-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
