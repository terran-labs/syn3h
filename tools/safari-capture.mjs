/** tools/heavy.sh node tools/safari-capture.mjs URL OUTPUT [ipad|iphone|both] */
import { webkit } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.argv[2],out=process.argv[3],selected=process.argv[4]??'both'
await mkdir(out,{recursive:true})
const browser=await webkit.launch({headless:true}),results=[]
try{
 for(const size of ['ipad','iphone'].filter(x=>selected==='both'||selected===x)){
  const context=await browser.newContext({viewport:size==='ipad'?{width:1024,height:1366}:{width:390,height:844},deviceScaleFactor:size==='ipad'?2:3,isMobile:true,hasTouch:true})
  await context.addInitScript(()=>{
   window.gpuAudit={errors:[],lost:[],contexts:[],sockets:[]}
   const seen=new WeakSet(); const original=HTMLCanvasElement.prototype.getContext
   HTMLCanvasElement.prototype.getContext=function(type,...args){const result=original.call(this,type,...args);if(result&&!seen.has(result)){seen.add(result);window.gpuAudit.contexts.push({type,ok:true,id:this.id});this.addEventListener('webglcontextlost',()=>window.gpuAudit.lost.push('WebGL context lost'));}return result}
   if(navigator.gpu){const request=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=async options=>{const a=await request(options);if(a){const rd=a.requestDevice.bind(a);a.requestDevice=async options=>{const d=await rd(options);d.addEventListener('uncapturederror',e=>window.gpuAudit.errors.push(e.error.message));d.lost.then(x=>window.gpuAudit.lost.push({reason:x.reason,message:x.message}));return d}}return a}}
  })
  const page=await context.newPage(),errors=[],requests=[],sockets=[]
  page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(`${m.type()}: ${m.text()}`)})
  page.on('requestfailed',r=>errors.push(`request: ${r.url()} ${r.failure()?.errorText}`));page.on('response',r=>requests.push({url:r.url(),status:r.status()}));page.on('websocket',s=>{sockets.push({url:s.url()});s.on('socketerror',e=>errors.push(`socket: ${e}`))})
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:90000})
  await page.waitForFunction(()=>window.mira?.game.tick>20,null,{timeout:120000}).catch(e=>errors.push(e.message))
  await page.waitForTimeout(2000)
  const read=()=>page.evaluate(()=>{const s=window.mira,g=s?.game,r=g?.renderer,b=r?.backend;return{diagnostics:window.miraDiagnostics,url:location.href,ua:navigator.userAgent,gpu:!!navigator.gpu,backend:g?.backend,backendClass:b?.constructor.name,adapter:b?.device?.adapterInfo,limits:b?.device?{maxTextureDimension2D:b.device.limits.maxTextureDimension2D}:null,tick:g?.tick,exposure:r?.toneMappingExposure,toneMapping:r?.toneMapping,outputColorSpace:r?.outputColorSpace,canvas:g?.canvas?{width:g.canvas.width,height:g.canvas.height,rect:g.canvas.getBoundingClientRect().toJSON()}:null,performance:g?.performance,graphics:s?.shell.graphics,playing:s?.shell.playing,quality:s?.params.get('gfx.level')?.value,audit:window.gpuAudit,bodyText:document.body.innerText.slice(0,2000),canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,class:c.className,w:c.width,h:c.height,rect:c.getBoundingClientRect().toJSON(),display:getComputedStyle(c).display,visibility:getComputedStyle(c).visibility}))}})
  const lobby=await read();await page.screenshot({path:`${out}/${size}-lobby.png`})
  if(!await page.locator('.shell-play').isVisible()){await page.locator('[data-goto=vehicle]').first().click();await page.locator('[data-panel=vehicle] [data-goto=explore]').click()}
  await page.locator('.shell-play').click({timeout:15000}).catch(e=>errors.push(e.message));await page.waitForTimeout(4000)
  const game=await read();await page.screenshot({path:`${out}/${size}-game.png`})
  results.push({size,lobby,game,errors,requests,sockets});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({size,lobby:{backend:lobby.backend,tick:lobby.tick,graphics:lobby.graphics},game:{backend:game.backend,tick:game.tick,exposure:game.exposure,graphics:game.graphics,audit:game.audit},errors}));await context.close()
 }
}finally{await browser.close()}
