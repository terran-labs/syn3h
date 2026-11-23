import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2];await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
 page.on('pageerror',e=>errors.push(e.stack));await page.routeWebSocket(/\/ws/,s=>s.close())
 await page.goto('http://localhost:5185/?autoplay=1&vehicle=buggy&seed=1');await page.waitForFunction(()=>window.mira?.game.tick>15)
 await page.evaluate(()=>{const s=window.mira;s.params.set('sun.timeOfDay',23);s.params.set('sun.dayLength',0);s.game.input.external.brakes=true})
 await page.waitForTimeout(1500);await page.screenshot({path:out+'/standing.png'})
 const lights=await page.evaluate(()=>{const s=window.mira;const a=[];s.player.object.traverse(o=>{if(o.isSpotLight){const pos=o.position.clone(),target=pos.clone();o.getWorldPosition(pos);o.target.getWorldPosition(target);a.push({intensity:o.intensity,distance:o.distance,angle:o.angle,position:pos.toArray(),target:target.toArray(),vehicle:s.player.object.position.toArray(),exposure:s.game.renderer.toneMappingExposure})}});return a})
 await page.evaluate(()=>{const s=window.mira;s.game.input.external.brakes=false;s.game.input.external.y=1;const q=s.player.object.quaternion;const v=s.player.object.position.clone().set(0,0,-17.88).applyQuaternion(q);s.player.body.setLinvel(v,true)})
 await page.waitForTimeout(1000);await page.screenshot({path:out+'/moving.png'})
 await writeFile(out+'/evidence.json',JSON.stringify({lights,errors},null,2));console.log(JSON.stringify({lights,errors}))
}finally{await browser.close()}
