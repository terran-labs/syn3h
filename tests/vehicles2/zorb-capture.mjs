// Zorb mode browser evidence: noon and night, grown, rolling, and just after an impact, plus the
// graphics level 0 fresnel-only shield. Toggles through the real KeyX path.
//   npx vite --port 5206 --strictPort --config tests/vehicles2/zorb-vite.config.ts
//   node tests/vehicles2/zorb-capture.mjs [/tmp/syn3h-vehicles2/zorb] [url]
import {chromium} from 'playwright-core'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const out=process.argv[2]??'/tmp/syn3h-vehicles2/zorb',base=process.argv[3]??'http://localhost:5206/'
await mkdir(out,{recursive:true})
const kinds=(process.env.KIND??'buggy').split(',')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[],images=[]
const ticks=(page,n)=>page.evaluate(n=>new Promise(r=>{const s=window.mira,t=s.game.tick+n;const f=()=>s.game.tick>=t?r():requestAnimationFrame(f);f()}),n)
try{
 for(const kind of kinds)for(const [label,hour,level] of [['noon',12,2],['night',23,2],['noon-level0',12,0]].filter(([l])=>!process.env.LABELS||process.env.LABELS.split(',').includes(l))){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push('pageerror: '+e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`${base}?autoplay=1&vehicle=${kind}&seed=3`);await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:120000})
  await page.evaluate(([hour,level])=>{const s=window.mira;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',hour);s.params.set('sun.dayLength',0);s.params.set('gfx.level',level)},[hour,level])
  // Find a gentle open patch near spawn so the ball can roll.
  const spot=await page.evaluate(()=>{
   const s=window.mira,p=s.player.body.translation();let best=null
   for(let a=0;a<24;a++)for(let r=0;r<400;r+=20){const x=p.x+Math.sin(a/24*Math.PI*2)*r,z=p.z+Math.cos(a/24*Math.PI*2)*r
    const h=s.terrain.heightAt(x,z),liquid=s.terrain.liquidHeightAt?.(x,z)??-Infinity
    if(Number.isFinite(liquid)&&liquid>h-1)continue
    let rough=0;for(let k=0;k<8;k++){const ang=k/8*Math.PI*2;rough+=Math.abs(s.terrain.heightAt(x+Math.sin(ang)*25,z+Math.cos(ang)*25)-h)}
    if(!best||rough<best.rough)best={x,z,h,rough}}
   s.player.teleport({x:best.x,y:best.h+2,z:best.z},0);return best
  })
  await ticks(page,60)
  // Draw calls and frame time without the ball, then with it (CPU side; no GPU timer here).
  const sample=()=>page.evaluate(()=>new Promise(r=>{const g=window.mira.game,calls=[],ms=[];const f=()=>{calls.push(g.performance.drawCalls);ms.push(g.performance.frameMs);calls.length<30?requestAnimationFrame(f):r({drawCalls:Math.round(calls.reduce((a,b)=>a+b)/calls.length*10)/10,frameMs:Math.round(ms.reduce((a,b)=>a+b)/ms.length*10)/10})};f()}))
  const without=await sample()
  await page.keyboard.press('KeyX')
  await ticks(page,250)
  const grown=await page.evaluate(()=>{const v=window.mira.player,c=window.mira.game.camera.position,p=v.object.position
   return {zorb:v.input.zorb,radius:v.zorb.radius,y:v.body.translation().y,ground:window.mira.terrain.heightAt(p.x,p.z),cameraDistance:c.distanceTo(p),shield:window.mira.game.scene.getObjectByName('zorb-shield')?.material.name}})
  grown.cost={without,with:await sample()}
  await page.screenshot({path:`${out}/${kind}-${label}-grown.png`});images.push(`${kind}-${label}-grown.png`)
  await page.keyboard.down('KeyW');await ticks(page,120)
  const rolling=await page.evaluate(()=>{const v=window.mira.player,l=v.body.linvel(),w=v.body.angvel();return {speed:Math.hypot(l.x,l.z),spin:Math.hypot(w.x,w.y,w.z),contact:v.zorb.contact}})
  await page.screenshot({path:`${out}/${kind}-${label}-rolling.png`});images.push(`${kind}-${label}-rolling.png`)
  await page.keyboard.up('KeyW');await ticks(page,100)
  // Drop from 18 m and photograph the frame after the first hard impact.
  await page.evaluate(()=>{const s=window.mira,p=s.player.body.translation();s.player.teleport({x:p.x,y:s.terrain.heightAt(p.x,p.z)+s.player.zorb.radius+18,z:p.z},0)
   window.zorbImpacts=s.player.zorb.impacts})
  await page.waitForFunction(()=>window.mira.player.zorb.impacts>window.zorbImpacts,null,{timeout:30000})
  await page.waitForTimeout(60)
  const impact=await page.evaluate(()=>{const s=window.mira.game.scene.getObjectByName('zorb-shield');return {alpha:s?.userData.zorbShield.alpha,impacts:window.mira.player.zorb.impacts}})
  await page.screenshot({path:`${out}/${kind}-${label}-impact.png`});images.push(`${kind}-${label}-impact.png`)
  // Let the ball settle, as a player would, before switching off.
  await ticks(page,150);await page.keyboard.press('KeyX');await ticks(page,150)
  const off=await page.evaluate(()=>{const v=window.mira.player,p=v.body.translation(),q=v.body.rotation(),l=v.body.linvel()
   return {zorb:v.input.zorb,active:v.zorb.active,shield:!!window.mira.game.scene.getObjectByName('zorb-shield'),wheels:v.wheelsGrounded,height:p.y-window.mira.terrain.heightAt(p.x,p.z),upY:1-2*(q.x*q.x+q.z*q.z),speed:Math.hypot(l.x,l.y,l.z)}})
  await page.screenshot({path:`${out}/${kind}-${label}-off.png`});images.push(`${kind}-${label}-off.png`)
  results.push({kind,label,hour,level,spot,grown,rolling,impact,off,errors})
  console.log(JSON.stringify(results.at(-1)))
  await page.close()
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2))
 const page=await browser.newPage(),tiles=await Promise.all(images.map(async file=>({file,data:(await readFile(out+'/'+file)).toString('base64')})))
 const png=await page.evaluate(async tiles=>{const c=document.createElement('canvas');c.width=1920;c.height=Math.ceil(tiles.length/4)*286;const ctx=c.getContext('2d');ctx.fillStyle='#17202c';ctx.fillRect(0,0,c.width,c.height);for(let i=0;i<tiles.length;i++){const im=new Image();im.src='data:image/png;base64,'+tiles[i].data;await im.decode();const x=i%4*480,y=Math.floor(i/4)*286;ctx.drawImage(im,x,y,480,270);ctx.fillStyle='white';ctx.font='12px monospace';ctx.fillText(tiles[i].file,x+5,y+282)}return c.toDataURL().split(',')[1]},tiles)
 await writeFile(out+'/contact-sheet.png',Buffer.from(png,'base64'))
 if(results.some(r=>r.errors.length))process.exitCode=1
}finally{await browser.close()}
