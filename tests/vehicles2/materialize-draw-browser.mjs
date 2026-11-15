// Attribute cloud submissions to actual render targets before changing its rendering.
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:5220'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5220','--strictPort'],{stdio:'ignore',env:{...process.env,SYN3H_NO_ROOM_SERVER:'1'}})
const report={errors:[]};let browser
try{
 for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(base+'/?autoplay=1&vehicle=buggy&room=cloud-draw')
 await page.waitForFunction(()=>window.syn3h?.game.tick>60,null,{timeout:180000})
 await page.evaluate(()=>{const s=window.syn3h;s.shell.play();s.params.set('gfx.auto',false);s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12)})
 await page.waitForFunction(()=>!window.syn3h.game.scene.userData.playerVehicleCache.pending,null,{timeout:120000})
 await page.evaluate(()=>{
  const s=window.syn3h,m=s.game.systems.find(x=>x.cloud&&typeof x.begin==='function'),mesh=m.cloud.mesh
  window.__cloudDraws=[];window.__cloudMeta={material:mesh.material.type,side:mesh.material.side,transparent:mesh.material.transparent,forceSinglePass:mesh.material.forceSinglePass}
  const before=mesh.onBeforeRender
  mesh.onBeforeRender=function(renderer,scene,camera,...rest){const target=renderer.getRenderTarget();window.__cloudDraws.push({frame:s.game.frames,target:target?.uuid??'screen',texture:target?.texture?.name,camera:camera.uuid,material:rest[1]?.type});before.call(this,renderer,scene,camera,...rest)}
  s.swapVehicle('jet')
 })
 await page.waitForTimeout(350)
 await page.screenshot({path:'/tmp/materialize-noon.png'})
 await page.waitForTimeout(2500)
 Object.assign(report,await page.evaluate(()=>({meta:window.__cloudMeta,draws:window.__cloudDraws})))
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM');await writeFile('/tmp/materialize-draw-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
