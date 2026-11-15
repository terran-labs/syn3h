import {chromium} from 'playwright-core'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const out=process.argv[2];await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[],images=[]
try{
 for(const planet of ['volcanic','alpine'])for(const kind of (process.env.KIND?[process.env.KIND]:['buggy','buggy-classic'])){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`http://localhost:5185/?autoplay=1&vehicle=${kind}&planet=${planet}&seed=${planet==='alpine'?7:1}`);await page.waitForFunction(()=>window.syn3h?.game.tick>10)
  const setup=await page.evaluate(planet=>{
   const s=window.syn3h;s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12);s.params.set('sun.dayLength',0)
   // Known coast from the earlier liquid captures. Alpine is 0.468 rise/m.
   let angle=3.5342917352885173,r=924
   if(planet==='volcanic'){
    let best=null
    for(let a=0;a<32;a++)for(let radius=450;radius<1050;radius+=2){
     const angle=a*Math.PI/16,dx=Math.sin(angle),dz=Math.cos(angle),h=d=>s.terrain.heightAt(dx*(radius+d),dz*(radius+d))
     if(h(0)<0&&h(-2)>=0&&h(15)<-3&&h(-10)>2&&h(-30)>5&&h(-60)>5){const slope=(h(-5)-h(5))/10;if(!best||slope<best.slope)best={angle,r:radius,slope};break}
    }
    if(!best)throw new Error('No mainland lava beach found');angle=best.angle;r=best.r
   }
   const dx=Math.sin(angle),dz=Math.cos(angle),x=dx*(r+15),z=dz*(r+15)
   s.player.teleport({x,y:-.45,z},angle);s.game.input.external.y=0
   return {x,z,heading:angle,bed:s.terrain.heightAt(x,z),slope:(s.terrain.heightAt(dx*(r-5),dz*(r-5))-s.terrain.heightAt(dx*(r+5),dz*(r+5)))/10,tick:s.game.tick}
  },planet)
  await page.waitForFunction(t=>window.syn3h.game.tick>=t,setup.tick+100)
  const before=await page.evaluate(()=>{const v=window.syn3h.player;return {position:{...v.body.translation()},stuck:v.stuck,canLiftOut:v.canLiftOut,depth:v.lavaDepth}})
  const prefix=`${planet}-${kind}`
  await page.screenshot({path:`${out}/${prefix}-before.png`});images.push(`${prefix}-before.png`)
  await page.evaluate(()=>{
   const s=window.syn3h;window.escapeTrace=[];window.escapeClosed=false;window.escapeLanded=false
   const space=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))}
   s.game.input.external.y=1;space()
   window.escapeProbe={postPhysics(){const v=s.player,p=v.body.translation(),ground=s.terrain.heightAt(p.x,p.z)
    if(!window.escapeClosed&&ground>5){space();window.escapeClosed=true;s.game.input.external.y=0}
    if(window.escapeClosed&&!v.wingsOpen&&v.wheelsGrounded>=2&&ground>2){window.escapeLanded=true;s.game.input.external.brakes=true}
    window.escapeTrace.push({tick:s.game.tick,x:p.x,y:p.y,z:p.z,ground,wheels:v.wheelsGrounded,wings:v.wingsOpen,stuck:v.stuck,heat:v.liquidState.heat,landed:window.escapeLanded})
   }};s.game.add(window.escapeProbe)
  })
  await page.waitForFunction(()=>window.escapeTrace.some(t=>t.y>1)||window.escapeTrace.length>400,null,{timeout:90000})
  await page.screenshot({path:`${out}/${prefix}-rising.png`});images.push(`${prefix}-rising.png`)
  await page.waitForFunction(()=>window.escapeLanded||window.escapeTrace.length>=1100,null,{timeout:120000})
  await page.screenshot({path:`${out}/${prefix}-end.png`});images.push(`${prefix}-end.png`)
  const trace=await page.evaluate(()=>{window.syn3h.game.remove(window.escapeProbe);return window.escapeTrace})
  const first=trace[0].tick,clear=trace.find(t=>t.y>1),land=trace.find(t=>t.landed)
  results.push({planet,kind,setup,before,errors,climbSeconds:clear?(clear.tick-first)*.02:null,landSeconds:land?(land.tick-first)*.02:null,peakHeight:Math.max(...trace.map(t=>t.y)),last:trace.at(-1),trace})
  await writeFile(out+'/trace.json',JSON.stringify(results,null,2));console.log(JSON.stringify({...results.at(-1),trace:undefined}));await page.close()
 }
 const page=await browser.newPage(),tiles=await Promise.all(images.map(async file=>({file,data:(await readFile(out+'/'+file)).toString('base64')})))
 const png=await page.evaluate(async tiles=>{const c=document.createElement('canvas');c.width=960;c.height=Math.ceil(tiles.length/2)*294;const ctx=c.getContext('2d');ctx.fillStyle='#17202c';ctx.fillRect(0,0,c.width,c.height);for(let i=0;i<tiles.length;i++){const im=new Image();im.src='data:image/png;base64,'+tiles[i].data;await im.decode();const x=i%2*480,y=Math.floor(i/2)*294;ctx.drawImage(im,x,y,480,270);ctx.fillStyle='white';ctx.font='12px monospace';ctx.fillText(tiles[i].file,x+5,y+286)}return c.toDataURL().split(',')[1]},tiles)
 await writeFile(out+'/contact-sheet.png',Buffer.from(png,'base64'))
 if(results.some(r=>r.errors.length||!r.last.landed))process.exitCode=1
}finally{await browser.close()}
