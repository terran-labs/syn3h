import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2];await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
 page.on('pageerror',e=>errors.push(e.stack));await page.routeWebSocket(/\/ws/,s=>s.close())
 await page.goto('http://localhost:5185/?autoplay=1&vehicle=buggy&seed=1');await page.waitForFunction(()=>window.mira?.game.tick>15)
 await page.exposeFunction('capturePhase',phase=>page.screenshot({path:out+'/'+phase+'.png'}))
 const samples=await page.evaluate(async()=>{
  const s=window.mira;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12);s.params.set('sun.dayLength',0)
  const values=[]
  for(const phase of ['grip','turn']){
   s.game.input.external.y=.2;s.game.input.external.x=phase==='turn'?.3:0
   for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,50));const raw=s.player.body.linvel(),speed=Math.hypot(raw.x,raw.y,raw.z);if(speed>12)s.player.body.setLinvel({x:raw.x*12/speed,y:raw.y,z:raw.z*12/speed},true);const wheels=s.player.getWheelEffects()
    values.push({phase,tick:s.game.tick,grounded:wheels.filter(w=>w.grounded).length,slip:Math.max(...wheels.map(w=>w.slip)),...s.game.scene.userData.vehicleEffects})
   }
   await window.capturePhase(phase)
  }
  return values
 })
 await page.screenshot({path:out+'/turn.png'});await writeFile(out+'/samples.json',JSON.stringify({samples,errors},null,2))
 const summary=['grip','turn'].map(phase=>{const rows=samples.filter(s=>s.phase===phase);return {phase,zeroSlip:rows.filter(s=>s.slip===0&&s.grounded>0).length,maxSlip:Math.max(...rows.map(s=>s.slip)),marksAdded:rows.at(-1).marks-rows[0].marks,particlesEmitted:rows.at(-1).emitted-rows[0].emitted}})
 console.log(JSON.stringify({summary,errors}));if(errors.length||summary.some(s=>s.marksAdded===0||s.particlesEmitted===0))process.exitCode=1
}finally{await browser.close()}
