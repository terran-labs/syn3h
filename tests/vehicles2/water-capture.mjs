/** Real island liquid journeys. One Chrome; deterministic spawn headings, tick-based sampling. */
import {chromium} from 'playwright-core'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const out=process.argv[2],planet=process.argv[3]??'volcanic',shallow=process.env.SHALLOW==='1',seed=Number(process.env.SEED??7),exitGround=Number(process.env.EXIT_GROUND??5);await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const images=[],runs=[]
 for(const hour of [12]){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`http://localhost:5185/?autoplay=1&vehicle=buggy&seed=${seed}&planet=${planet}`);await page.waitForFunction(()=>window.syn3h?.game.tick>10,null,{timeout:90000})
  const route=await page.evaluate(hour=>{
   const s=window.syn3h;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',hour);s.params.set('sun.dayLength',0)
   let best=null
   for(let a=0;a<32;a++){
    const angle=a*Math.PI/16,dx=Math.sin(angle),dz=Math.cos(angle)
    for(let r=450;r<1100;r+=2){
     const x=dx*r,z=dz*r,h=s.terrain.heightAt(x,z),prev=s.terrain.heightAt(dx*(r-2),dz*(r-2))
     if(h<0&&prev>=0){if([10,30,60].some(d=>s.terrain.heightAt(dx*(r+d),dz*(r+d))>-Math.min(d*.2,8)))continue;const slope=(s.terrain.heightAt(dx*(r-5),dz*(r-5))-s.terrain.heightAt(dx*(r+5),dz*(r+5)))/10;if(!best||slope<best.slope)best={x,z,dx,dz,r,slope,angle};break}
    }
   }
   if(!best)throw new Error('No sea crossing found')
   return {shore:best,summit:s.terrain.summit?.()}
  },hour)
  const {shore, summit}=route
  const phases=[{name:'sea-exit',x:shore.dx*(shore.r+(shallow?2:15)),z:shore.dz*(shore.r+(shallow?2:15)),y:shallow?-.4:0,heading:shore.angle,speed:0,ticks:1000,exitGround}]
  const traces=[]
  for(const phase of phases){
   const start=await page.evaluate(p=>{
    const s=window.syn3h;s.player.liquidState.heat=0;s.player.liquidState.heatHeight=-100;s.player.teleport({x:p.x,y:p.y??s.terrain.heightAt(p.x,p.z)+.8,z:p.z},p.heading)
    s.player.body.setLinvel({x:-Math.sin(p.heading)*p.speed,y:0,z:-Math.cos(p.heading)*p.speed},true)
    s.game.input.external.y=1;s.game.input.external.x=0;s.game.input.external.brakes=false
    window.lavaTrace=[];window.lavaExit=false;window.lavaProbe={postPhysics(){const v=s.player,position=v.body.translation(),speed=v.body.linvel();if(p.name==='sea-exit'&&s.terrain.heightAt(position.x,position.z)>p.exitGround&&v.lavaDepth===0){window.lavaExit=true;s.game.input.external.y=0;s.game.input.external.brakes=true}const p1=position;window.lavaTrace.push({tick:s.game.tick,x:p1.x,y:p1.y,z:p1.z,speed:Math.hypot(speed.x,speed.y,speed.z),depth:v.lavaDepth,stuck:v.stuck,heat:v.liquidState.heat,rotation:{...v.body.rotation()},wheels:v.wheelsGrounded,input:{...v.input},camera:s.game.camera.position.toArray(),cameraGround:s.terrain.heightAt(s.game.camera.position.x,s.game.camera.position.z),cameraLiquid:s.terrain.liquidHeightAt?.(s.game.camera.position.x,s.game.camera.position.z),kind:s.terrain.liquidKindAt?.(p1.x,p1.z),ground:s.terrain.heightAt(p1.x,p1.z),exited:window.lavaExit})}};s.game.add(window.lavaProbe);return s.game.tick
   },phase)
   for(const fraction of [.1,.25,.5,1]){
    await page.waitForFunction(t=>window.syn3h.game.tick>=t,start+Math.round(phase.ticks*fraction),{timeout:120000})
    const file=`${hour}-${phase.name}-${fraction}.png`;await page.screenshot({path:out+'/'+file});images.push({file,label:`${hour}:00 ${phase.name} ${fraction===1?'end':'entry'}`})
   }
   traces.push({phase,trace:await page.evaluate(()=>{window.syn3h.game.remove(window.lavaProbe);return window.lavaTrace})})
  }
  const glowDraws=await page.evaluate(()=>{const s=window.syn3h,g=s.game;g.renderer.setAnimationLoop(null);const old=s.player.liquidState.heat;s.player.liquidState.heat=0;g.renderer.info.reset();g.renderer.render(g.scene,g.camera);g.renderer.info.reset();g.renderer.render(g.scene,g.camera);const cold=g.renderer.info.render.drawCalls;s.player.liquidState.heat=1;g.renderer.info.reset();g.renderer.render(g.scene,g.camera);g.renderer.info.reset();g.renderer.render(g.scene,g.camera);const hot=g.renderer.info.render.drawCalls;s.player.liquidState.heat=old;return {cold,hot}})
  runs.push({hour,route,traces,glowDraws,errors});await writeFile(out+'/trace.json',JSON.stringify({planet,runs},null,2));await page.close();if(glowDraws.cold!==glowDraws.hot)throw new Error(JSON.stringify(glowDraws))
 }
 const page=await browser.newPage();const tiles=await Promise.all(images.map(async i=>({...i,data:(await readFile(out+'/'+i.file)).toString('base64')})))
 const data=await page.evaluate(async tiles=>{const c=document.createElement('canvas');c.width=960;c.height=Math.ceil(tiles.length/2)*294;const ctx=c.getContext('2d');ctx.fillStyle='#17202c';ctx.fillRect(0,0,c.width,c.height);for(let i=0;i<tiles.length;i++){const image=new Image();image.src='data:image/png;base64,'+tiles[i].data;await image.decode();const x=i%2*480,y=Math.floor(i/2)*294;ctx.drawImage(image,x,y,480,270);ctx.fillStyle='white';ctx.font='14px monospace';ctx.fillText(tiles[i].label,x+8,y+287)}return c.toDataURL().split(',')[1]},tiles)
 await writeFile(out+'/contact-sheet.png',Buffer.from(data,'base64'));console.log(JSON.stringify(runs.map(r=>({hour:r.hour,errors:r.errors,phases:r.traces.map(t=>({name:t.phase.name,first:t.trace[0],last:t.trace.at(-1),maxDepth:Math.max(...t.trace.map(s=>s.depth))}))}))));if(runs.some(r=>r.errors.length))process.exitCode=1
}finally{await browser.close()}
