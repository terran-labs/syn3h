/**
 * One browser look at vehicle materialization. Serve with materialize.vite.config.ts, then:
 *   node tests/vehicles2/materialize-look.mjs http://localhost:<port>/ /tmp/syn3h-materialize
 * Waits for play, presses M, and saves frames through the hold and the drop with the player's
 * height and hold state. Exits non zero on a page or console error.
 */
import {chromium} from 'playwright-core'
const base=process.argv[2]??'http://localhost:5291/',out=process.argv[3]??'/tmp/syn3h-materialize'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const page=await browser.newPage({viewport:{width:1280,height:720}})
const errors=[]
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`))
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)})
await page.goto(base+(base.includes('?')?'&':'?')+'autoplay=1',{waitUntil:'load'})
await page.waitForFunction(()=>window.syn3h?.game?.tick>200&&window.syn3hMaterialize,null,{timeout:60000})
const read=()=>page.evaluate(()=>{const s=window.syn3h,m=window.syn3hMaterialize,p=s.player.body.translation();return {t:s.game.time.toFixed(2),y:+p.y.toFixed(3),held:m.isHeld(s.player),cloud:m.cloud.mesh.visible,draws:s.game.performance.drawCalls,backend:s.game.backend}})
const log=[]
log.push({at:'before',...await read()})
await page.keyboard.press('KeyM')
for(const [ms,name] of [[150,'a-gather'],[350,'b-hold'],[400,'c-late-hold'],[300,'d-release'],[700,'e-drop']]){
  await page.waitForTimeout(ms)
  await page.screenshot({path:`${out}-${name}.png`})
  log.push({at:name,...await read()})
}
console.log(JSON.stringify(log,null,1))
if(errors.length)console.log(errors.join('\n'))
await browser.close()
process.exit(errors.length?1:0)
