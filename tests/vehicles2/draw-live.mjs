import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.routeWebSocket(/\/ws/,s=>s.close())
try{
 await page.goto('http://localhost:5185/?autoplay=1&seed=1');await page.waitForFunction(()=>window.syn3h?.game.tick>15)
 const data=[]
 for(const level of [2,1])for(const count of [0,8]){
  await page.goto('http://localhost:5185/?autoplay=1&seed=1');await page.waitForFunction(()=>window.syn3h?.game.tick>15)
  await page.evaluate(({level,count})=>{const s=window.syn3h;s.bots.remote=false;s.params.set('gfx.level',level);s.params.set('bots.count',count);s.params.set('bots.canDrive',0);s.params.set('bots.canFire',0);s.game.input.external.y=0;s.game.input.external.brakes=true},{level,count})
  await page.waitForTimeout(2500)
  const result=await page.evaluate(async()=>{
   const s=window.syn3h,g=s.game,r=g.renderer;await Promise.all(s.bots.vehicles.map(v=>v.skin?.ready));const samples=[]
   const original=r.render.bind(r);let cpu=0;r.render=(...args)=>{const start=performance.now();const value=original(...args);cpu=performance.now()-start;return value}
   for(let i=0;i<50;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({...g.performance,cpu})}
   r.render=original;return {bots:s.bots.vehicles.length,level:s.params.get('gfx.level').value,samples}
  });data.push(result)
 }
 await page.screenshot({path:process.argv[2]+'.png'});await writeFile(process.argv[2],JSON.stringify({data,errors},null,2))
 const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]
 console.log(JSON.stringify({summary:data.map(x=>({bots:x.bots,level:x.level,draws:median(x.samples.map(s=>s.drawCalls)),cpu:median(x.samples.map(s=>s.cpu)),triangles:median(x.samples.map(s=>s.triangles))})),errors}))
 if(errors.length)process.exitCode=1
}finally{await browser.close()}
