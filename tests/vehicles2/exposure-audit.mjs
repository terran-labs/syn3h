import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2];await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[]
try{
 for(const kind of ['buggy','jet'])for(const hour of [12,23]){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`http://localhost:5185/?autoplay=1&vehicle=${kind}&planet=volcanic&seed=1`);await page.waitForFunction(()=>window.syn3h?.game.tick>10)
  await page.evaluate(({hour,kind})=>{const s=window.syn3h;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',hour);s.params.set('sun.dayLength',0);s.game.input.external.brakes=true;s.game.input.external.z=kind==='jet'?1:0;s.player.input.special=true;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))}, {hour,kind})
  await page.waitForTimeout(6000)
  await page.keyboard.down('KeyL');await page.waitForTimeout(150)
  await page.screenshot({path:`${out}/${kind}-${hour}.png`});await page.keyboard.up('KeyL')
  results.push(await page.evaluate(({kind,hour,errors})=>({kind,hour,errors,exposure:window.syn3h.game.renderer.toneMappingExposure}),{kind,hour,errors}));await page.close()
 }
 await writeFile(out+'/measurements.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{await browser.close()}
