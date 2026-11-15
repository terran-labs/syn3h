import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{if(errors.length<3)errors.push(e.stack)})
 await page.routeWebSocket(/\/ws/,s=>s.close());await page.goto('http://localhost:5185/?autoplay=1&seed=1');await page.waitForFunction(()=>window.syn3h?.game.tick>10)
 await page.evaluate(()=>{const s=window.syn3h;s.bots.remote=false;s.params.set('gfx.level',2);s.params.set('bots.count',8);s.params.set('bots.canDrive',0);s.params.set('bots.canFire',0)})
 await page.waitForTimeout(3500)
 await page.evaluate(()=>{window.syn3h.params.set('gfx.level',1);window.syn3h.params.set('bots.count',0)})
 await page.waitForTimeout(1500);const state=await page.evaluate(()=>({bots:window.syn3h.bots.vehicles.length,tick:window.syn3h.game.tick}))
 await writeFile(process.argv[2],JSON.stringify({state,errors},null,2));console.log(JSON.stringify({state,errors}))
}finally{await browser.close()}
