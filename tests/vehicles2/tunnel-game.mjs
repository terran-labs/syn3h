// Fires the player's vehicle at the real terrain in the running game and records, every
// physics step, how far its centre is above the ground it is over.
//   node tests/vehicles2/tunnel-game.mjs <out.json> [kinds] [worldQuery]      PORT=5206
import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const out=process.argv[2],kinds=(process.argv[3]??'buggy,jet').split(','),worldQuery=process.argv[4]??'planet=alpine&seed=1',port=process.env.PORT??'5206'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[]
try{for(const kind of kinds){
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket(/\/ws/,s=>s.close())
 await page.goto(`http://localhost:${port}/?autoplay=1&vehicle=${kind}&${worldQuery}`);await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:120000})
 await page.evaluate(()=>{const s=window.mira;s.params.set('bots.count',0);s.params.set('gfx.auto',false);s.params.set('gfx.vehicleShading',0)})
 await page.waitForTimeout(2000)
 for(const speed of [60,120,250])for(const dive of [0,15,50])for(const site of [0,1,2]){
  const r=await page.evaluate(async({speed,dive,site})=>{const s=window.mira,v=s.player,t=s.terrain
   // Find rising ground: walk outward from a per-site bearing until the slope ahead climbs.
   const bearing=site*2.1+.4,dx=Math.sin(bearing),dz=Math.cos(bearing);let d=60
   for(;d<700;d+=10){if(t.heightAt(dx*(d+40),dz*(d+40))-t.heightAt(dx*d,dz*d)>10&&t.heightAt(dx*d,dz*d)>1)break}
   const x=dx*d,z=dz*d,ground=t.heightAt(x,z),heading=Math.atan2(-dx,-dz)
   v.teleport({x,y:ground+(dive?30:1.5),z},heading)
   const a=dive*Math.PI/180;v.body.setLinvel({x:dx*Math.cos(a)*speed,y:-Math.sin(a)*speed,z:dz*Math.cos(a)*speed},true)
   const trace=[];const probe={postPhysics(){const p=v.body.translation();trace.push([p.x,p.y,p.z,p.y-t.heightAt(p.x,p.z)])}};s.game.add(probe)
   const start=s.game.tick;await new Promise(done=>{const wait=()=>s.game.tick-start>=150?done():setTimeout(wait,50);wait()});s.game.remove(probe)
   let worst=Infinity,at=-1;trace.forEach((p,i)=>{if(p[3]<worst){worst=p[3];at=i}})
   // A rescue or respawn shows as a jump of more than 20 m in one step.
   let jumps=0;for(let i=1;i<trace.length;i++)if(Math.hypot(trace[i][0]-trace[i-1][0],trace[i][1]-trace[i-1][1],trace[i][2]-trace[i-1][2])>Math.max(20,speed*.02*3))jumps++
   return {speed,dive,site,worst:+worst.toFixed(2),at,jumps,guardHits:v.groundGuardHits,steps:trace.length,around:trace.slice(Math.max(0,at-3),at+3).map(p=>+p[3].toFixed(2))}},{speed,dive,site})
  results.push({kind,...r});if(r.worst<-1||r.jumps)console.log(JSON.stringify({kind,...r}))
 }
 results.push({kind,errors});await page.close()}
 await writeFile(out,JSON.stringify(results,null,1));const trials=results.filter(r=>'worst' in r),bad=trials.filter(r=>r.worst<-1||r.jumps);console.log(`trials ${trials.length}, through or rescued ${bad.length}, lowest clearance ${Math.min(...trials.map(r=>r.worst))}, guard hits by kind ${JSON.stringify(Object.fromEntries(kinds.map(k=>[k,Math.max(0,...trials.filter(r=>r.kind===k).map(r=>r.guardHits??0))])))}`);if(bad.length)process.exitCode=1
}finally{await browser.close()}
