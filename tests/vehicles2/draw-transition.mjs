import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{if(errors.length<3)errors.push(e.stack)})
 await page.routeWebSocket(/\/ws/,s=>s.close());await page.goto('http://localhost:5185/?autoplay=1&seed=1');await page.waitForFunction(()=>window.mira?.game.tick>10)
 const rounds=[]
 for(let round=0;round<3;round++){
 await page.evaluate(()=>{const s=window.mira;s.bots.remote=false;s.params.set('gfx.level',2);s.params.set('bots.count',8);s.params.set('bots.canDrive',0);s.params.set('bots.canFire',0)})
 await page.waitForTimeout(3500)
 await page.evaluate(()=>{window.mira.params.set('gfx.level',1);window.mira.params.set('bots.count',0)})
 const before=await page.evaluate(()=>window.mira.game.tick)
 await page.waitForTimeout(1500);const state=await page.evaluate(()=>({bots:window.mira.bots.vehicles.length,tick:window.mira.game.tick}))
 rounds.push({...state,before});if(state.tick<=before)throw new Error('World stopped stepping')
 }
 await writeFile(process.argv[2],JSON.stringify({rounds,errors},null,2));console.log(JSON.stringify({rounds,errors}));if(errors.length)process.exitCode=1
}finally{await browser.close()}
