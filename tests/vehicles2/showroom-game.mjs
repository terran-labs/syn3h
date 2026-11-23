// PARAMS=paint.seams=1,paint.scaleDepth=1 sets extra sliders first.
// In-game captures of the showroom shading: node tests/vehicles2/showroom-game.mjs <out> [kinds] [tiers] [hours]
import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2],kinds=(process.argv[3]??'buggy').split(','),tiers=(process.argv[4]??'3,0').split(',').map(Number),hours=(process.argv[5]??'12').split(',').map(Number)
const port=process.env.PORT??'5185',planet=process.env.PLANET??'alpine'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[]
try{
 for(const kind of kinds){
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`http://localhost:${port}/?autoplay=1&vehicle=${kind}&planet=${planet}&seed=1`);await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:90000})
  await page.evaluate(extra=>{const s=window.mira;s.params.set('bots.count',0);s.params.set('sun.dayLength',0);s.game.input.external.brakes=true;s.player.setColors('#1557e0','#1b2a9c');for(const pair of (extra||'').split(',').filter(Boolean)){const [id,value]=pair.split('=');s.params.set(id,Number(value))}},process.env.PARAMS??'')
  await page.waitForTimeout(5000)
  for(const hour of hours)for(const tier of tiers){
   await page.evaluate(({hour,tier})=>{const s=window.mira;s.params.set('sun.timeOfDay',hour);s.params.set('gfx.vehicleShading',tier)},{hour,tier})
   for(const [shot,f,r,u,tf,tu] of [['wide',4.2,3.2,2.2,0,.2],['close',1.9,1.5,1.5,.5,.45],['rear',-4,2.6,2,0,.3],['inside',Number(process.env.EYE_F??-.15),0,Number(process.env.EYE_U??.62),6,.5]]){
    await page.evaluate(({f,r,u,tf,tu})=>{const s=window.mira,o=s.player.object,T=o.position.constructor
     const fw=new T(0,0,-1).applyQuaternion(o.quaternion),rt=new T(1,0,0).applyQuaternion(o.quaternion),up=new T(0,1,0)
     const pos=o.position.clone().addScaledVector(fw,f).addScaledVector(rt,r).addScaledVector(up,u),target=o.position.clone().addScaledVector(fw,tf).addScaledVector(up,tu)
     s.camera.setCinematicPose(pos,target)},{f,r,u,tf,tu})
    await page.waitForTimeout(2600)
    await page.screenshot({path:`${out}/${kind}-h${hour}-t${tier}-${shot}.png`})
   }
   results.push(await page.evaluate(({kind,hour,tier})=>{const i=window.mira.game.renderer.info;return {kind,hour,tier,draws:i.render.drawCalls,triangles:i.render.triangles}},{kind,hour,tier}))
  }
  results.push({kind,errors:[...new Set(errors)].slice(0,8)});await page.close()
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,1));console.log(JSON.stringify(results))
}finally{await browser.close()}
