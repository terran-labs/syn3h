// Frame time per shading tier with the buggy filling the view: node tests/vehicles2/showroom-cost.mjs <out.json>
// Headed-equivalent GPU work is not isolated here. Tiers are interleaved so drift on a shared machine shows up as spread.
import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist','--disable-frame-rate-limit','--disable-gpu-vsync']})
try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket(/\/ws/,s=>s.close())
 await page.goto(`http://localhost:${process.env.PORT??'5185'}/?autoplay=1&vehicle=buggy&planet=alpine&seed=1`);await page.waitForFunction(()=>window.syn3h?.game.tick>10,null,{timeout:90000})
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('gfx.auto',false);s.params.set('bots.count',0);s.params.set('sun.dayLength',0);s.params.set('sun.timeOfDay',12);s.game.input.external.brakes=true
  const o=s.player.object,T=o.position.constructor,fw=new T(0,0,-1).applyQuaternion(o.quaternion),rt=new T(1,0,0).applyQuaternion(o.quaternion)
  s.camera.setCinematicPose(o.position.clone().addScaledVector(fw,1.6).addScaledVector(rt,1.3).add(new T(0,1.3,0)),o.position.clone().addScaledVector(fw,.4).add(new T(0,.4,0)))})
 await page.waitForTimeout(6000)
 const rows=[]
 for(let round=0;round<3;round++)for(const tier of [0,1,2,3]){
  await page.evaluate(t=>window.syn3h.params.set('gfx.vehicleShading',t),tier);await page.waitForTimeout(1500)
  // Wait for the GPU to finish each frame, at a high pixel ratio, so fragment cost is what is timed.
  rows.push(await page.evaluate(async tier=>{const s=window.syn3h,r=s.game.renderer,device=r.backend.device;r.setPixelRatio(3)
   const frame=()=>new Promise(done=>requestAnimationFrame(()=>device.queue.onSubmittedWorkDone().then(done)))
   for(let i=0;i<20;i++)await frame()
   const times=[];for(let i=0;i<150;i++){const t=performance.now();await frame();times.push(performance.now()-t)}
   times.sort((a,b)=>a-b);return {tier,median:times[75],p90:times[135],draws:r.info.render.drawCalls,pixelRatio:r.getPixelRatio()}},tier))
 }
 const summary=[0,1,2,3].map(t=>{const r=rows.filter(x=>x.tier===t);return {tier:t,medianMs:r.map(x=>+x.median.toFixed(2)),p90Ms:r.map(x=>+x.p90.toFixed(2)),draws:r[0].draws,pixelRatio:r[0].pixelRatio}})
 await writeFile(process.argv[2],JSON.stringify({summary,errors},null,1));console.log(JSON.stringify({summary,errors}))
}finally{await browser.close()}
