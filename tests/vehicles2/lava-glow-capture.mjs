import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2];await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[],results=[]
 page.on('pageerror',e=>errors.push(e.stack));await page.routeWebSocket(/\/ws/,s=>s.close())
 for(const hour of [12,23]){
  await page.goto('http://localhost:5185/?autoplay=1&vehicle=buggy&planet=volcanic&seed=1');await page.waitForFunction(()=>window.syn3h?.game.tick>10)
  await page.evaluate(hour=>{const s=window.syn3h;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',hour);s.params.set('sun.dayLength',0);s.player.teleport({x:-530,y:-.45,z:-790},0)},hour)
  await page.waitForTimeout(1500)
  const result=await page.evaluate(()=>{
   const s=window.syn3h,g=s.game;g.renderer.setAnimationLoop(null);const spawn=s.terrain.spawnPoint(0);s.player.teleport(spawn.position,spawn.heading);s.player.update(0,1)
   const p=s.player.object.position;g.camera.position.copy(p).add({x:4,y:2.8,z:4});g.camera.lookAt(p);g.scene.updateMatrixWorld(true)
   const draw=()=>{g.renderer.info.reset();g.renderer.render(g.scene,g.camera);return g.renderer.info.render.drawCalls}
   const heat=s.player.liquidState.heat;draw();const hot=draw();s.player.liquidState.heat=0;const cold=draw();s.player.liquidState.heat=heat;draw()
   return {heat,hot,cold}
  });await page.screenshot({path:out+'/'+hour+'-hot.png'})
  await page.evaluate(()=>{const s=window.syn3h;s.player.liquidState.heat=0;s.game.renderer.render(s.game.scene,s.game.camera)})
  await page.screenshot({path:out+'/'+hour+'-cold.png'});results.push({hour,...result})
 }
 await writeFile(out+'/measurements.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));if(errors.length||results.some(r=>r.heat<.9||r.hot!==r.cold))process.exitCode=1
}finally{await browser.close()}
