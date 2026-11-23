// Every vehicle in Playwright WebKit, on the default backend and forced WebGL 2, driving for a
// few seconds at the plain and the top shading tier with the force field canopy preview on.
//   node tests/vehicles2/webkit-check.mjs <out dir> [kinds]      PORT=5206 by default
import {webkit} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2],kinds=(process.argv[3]??'buggy,jet,hovercraft,tank').split(','),port=process.env.PORT??'5206'
await mkdir(out,{recursive:true})
const browser=await webkit.launch({headless:true}),results=[]
try{
 for(const forced of [false,true])for(const kind of kinds){
  const page=await browser.newPage({viewport:{width:1024,height:640}}),errors=[],images=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  page.on('request',r=>{if(/\.(png|jpe?g|webp)(\?|$)/i.test(r.url()))images.push(r.url().replace(/^.*\/\/[^/]+/,''))})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  let started=true
  await page.goto(`http://localhost:${port}/?autoplay=1&vehicle=${kind}&planet=alpine&seed=1${forced?'&webgl=1':''}`,{waitUntil:'domcontentloaded',timeout:90000})
  await page.waitForFunction(()=>window.mira?.game.tick>20,null,{timeout:150000}).catch(e=>{started=false;errors.push('did not start: '+e.message.slice(0,80))})
  let info={}
  if(started){
   await page.evaluate(()=>{const s=window.mira;s.params.set('bots.count',0);s.params.set('gfx.auto',false);s.params.set('paint.forceFieldCanopy',true);s.game.input.external.y=1})
   for(const tier of [0,3]){await page.evaluate(t=>window.mira.params.set('gfx.vehicleShading',t),tier);await page.waitForTimeout(3500);await page.screenshot({path:`${out}/${forced?'webgl':'default'}-${kind}-t${tier}.png`})}
   await page.keyboard.press('KeyX');await page.waitForTimeout(3500);await page.screenshot({path:`${out}/${forced?'webgl':'default'}-${kind}-zorb.png`})
   info=await page.evaluate(()=>{const s=window.mira;return {backend:s.game.backend,tick:s.game.tick,draws:s.game.renderer.info.render.drawCalls,speed:Math.round(Math.hypot(s.player.body.linvel().x,s.player.body.linvel().z)),zorbed:s.player.zorbed}})
  }
  results.push({forced,kind,...info,images:[...new Set(images)],errors:[...new Set(errors)].map(e=>e.slice(0,160))});await page.close()
 }
 await writeFile(out+'/results.json',JSON.stringify({webkit:browser.version(),results},null,1))
 console.log(JSON.stringify({webkit:browser.version(),results}))
 if(results.some(r=>r.errors.length))process.exitCode=1
}finally{await browser.close()}
