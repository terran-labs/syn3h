// Zorb hop and pulse browser evidence: rest, the pulse peak, mid-hop and settled, through the
// real KeyX and Space paths, with the shield's alpha and swell and the vehicle's wing and gear
// state. Serve with a private cache (see zorb-vite.config.ts) and run:
//   KIND=buggy,jet node tests/vehicles2/zorb-hop-capture.mjs [/tmp/syn3h-zorb-hop] [url]
import {chromium} from 'playwright-core'
import {mkdir} from 'node:fs/promises'
const out=process.argv[2]??'/tmp/syn3h-zorb-hop',base=process.argv[3]??'http://localhost:5206/'
await mkdir(out,{recursive:true})
const kinds=(process.env.KIND??'buggy,jet').split(',')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const ticks=(page,n)=>page.evaluate(n=>new Promise(r=>{const s=window.syn3h,t=s.game.tick+n;const f=()=>s.game.tick>=t?r():requestAnimationFrame(f);f()}),n)
const read=page=>page.evaluate(()=>{const s=window.syn3h,v=s.player,sh=s.game.scene.getObjectByName('zorb-shield'),c=v.zorb.centre(v.object.position.clone())
 return {hops:v.zorb.hops,vy:+v.body.linvel().y.toFixed(2),lift:+(c.y-v.zorb.radius-s.terrain.heightAt(c.x,c.z)).toFixed(2),alpha:+(sh?.userData.zorbShield.alpha??0).toFixed(3),swell:+(sh?(sh.scale.x/v.zorb.radius-1):0).toFixed(3),wingsOpen:v.wingsOpen,gear:v.gearAmount,special:v.input.special}})
try{
 for(const kind of kinds){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push('pageerror: '+e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`${base}?autoplay=1&vehicle=${kind}&seed=3`);await page.waitForFunction(()=>window.syn3h?.game.tick>10,null,{timeout:120000})
  await page.evaluate(()=>{const s=window.syn3h;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12);s.params.set('sun.dayLength',0)})
  await page.evaluate(()=>{
   const s=window.syn3h,p=s.player.body.translation();let best=null
   for(let a=0;a<24;a++)for(let r=0;r<400;r+=20){const x=p.x+Math.sin(a/24*Math.PI*2)*r,z=p.z+Math.cos(a/24*Math.PI*2)*r
    const h=s.terrain.heightAt(x,z),liquid=s.terrain.liquidHeightAt?.(x,z)??-Infinity
    if(Number.isFinite(liquid)&&liquid>h-1)continue
    let rough=0;for(let k=0;k<8;k++){const ang=k/8*Math.PI*2;rough+=Math.abs(s.terrain.heightAt(x+Math.sin(ang)*25,z+Math.cos(ang)*25)-h)}
    if(!best||rough<best.rough)best={x,z,h,rough}}
   s.player.teleport({x:best.x,y:best.h+2,z:best.z},0)})
  await ticks(page,60)
  await page.keyboard.press('KeyX');await ticks(page,400)
  const frames={rest:await read(page)}
  await page.screenshot({path:`${out}/${kind}-rest.png`})
  await page.keyboard.press('Space');await ticks(page,3)
  frames.pulse=await read(page);await page.screenshot({path:`${out}/${kind}-pulse.png`})
  await ticks(page,15);frames.midHop=await read(page);await page.screenshot({path:`${out}/${kind}-midhop.png`})
  // A second press in mid-air must not hop again.
  await page.keyboard.press('Space');await ticks(page,3);frames.airPress=await read(page)
  await ticks(page,150);frames.settled=await read(page);await page.screenshot({path:`${out}/${kind}-settled.png`})
  await page.keyboard.press('KeyX');await ticks(page,200);frames.off=await read(page)
  console.log(JSON.stringify({kind,frames,errors}))
  await page.close()
 }
}finally{await browser.close()}
