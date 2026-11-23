// Captures every effect and material that used to load a vehicle image, at noon and night, and
// records any request for /models/textures/ or /models/effects/ while each vehicle kind drives.
//   node tests/vehicles2/nobitmaps-capture.mjs <out> [kinds] [backend]     PORT=5207 by default
// kinds: buggy,jet,hovercraft,tank (default all). backend: webgpu (default) or webgl.
// Exits non-zero on a browser error, any image request under those two folders, or a tank whose
// tread maps did not scroll while it drove. No bitmap exceptions remain.
//
// The buggy run also stages a "lab": with the buggy parked and a settled camera, it emits dust,
// exhaust, both plasma colours and a set of tyre marks straight into the shared effect batches,
// so before and after images show the same effect in the same place.
import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2],kinds=(process.argv[3]??'buggy,jet,hovercraft,tank').split(','),backend=process.argv[4]??'webgpu'
const port=process.env.PORT??'5207',hours=[12,23]
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[]
const allowed=()=>[]
// Camera in the vehicle frame: forward f, right r, up u, looking at forward tf, up tu. The game
// camera eases toward this pose, so callers wait before a screenshot or repeat it while moving.
const pose=(page,f,r,u,tf=0,tu=.3)=>page.evaluate(({f,r,u,tf,tu})=>{const s=window.mira,o=s.player.object,V=o.position.constructor
 const fw=new V(0,0,-1).applyQuaternion(o.quaternion),rt=new V(1,0,0).applyQuaternion(o.quaternion),up=new V(0,1,0)
 s.camera.setCinematicPose(o.position.clone().addScaledVector(fw,f).addScaledVector(rt,r).addScaledVector(up,u),o.position.clone().addScaledVector(fw,tf).addScaledVector(up,tu))},{f,r,u,tf,tu})
const drive=(page,y,x=0,cap=12,steps=40)=>page.evaluate(async({y,x,cap,steps})=>{const s=window.mira;s.game.input.external.brakes=false;s.game.input.external.y=y;s.game.input.external.x=x
 for(let i=0;i<steps;i++){await new Promise(r=>setTimeout(r,50));const v=s.player.body.linvel(),sp=Math.hypot(v.x,v.z);if(sp>cap)s.player.body.setLinvel({x:v.x*cap/sp,y:v.y,z:v.z*cap/sp},true)}},{y,x,cap,steps})
const stop=page=>page.evaluate(()=>{const e=window.mira.game.input.external;e.y=0;e.x=0;e.brakes=true})
const chase=page=>page.evaluate(()=>window.mira.camera.clearCinematicPose())
try{
 for(const kind of kinds){
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],requests=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  page.on('request',r=>{if(/\/models\/(textures|effects)\//.test(r.url()))requests.push(new URL(r.url()).pathname)})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  await page.goto(`http://localhost:${port}/?autoplay=1&vehicle=${kind}&planet=alpine&seed=1${backend==='webgl'?'&webgl':''}`)
  await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:90000})
  await page.evaluate(()=>{const s=window.mira;s.params.set('bots.count',0);s.params.set('sun.dayLength',0);s.params.set('gfx.vehicleShading',0);s.game.input.external.brakes=true})
  await page.waitForTimeout(4000)
  const shot=name=>page.screenshot({path:`${out}/${kind}-${name}.png`})
  for(const hour of hours){
   await page.evaluate(h=>window.mira.params.set('sun.timeOfDay',h),hour);await page.waitForTimeout(800)
   const h=`h${hour}`
   if(kind==='buggy'){
    // Gameplay: chase camera while driving, then a hard turn.
    await chase(page);await drive(page,.7);await shot(`${h}-drive`)
    await drive(page,.6,.9,11);await shot(`${h}-turn`)
    await stop(page);await page.waitForTimeout(1200)
    // Lab, parked: settle a camera behind and above, then emit into the shared batches.
    await pose(page,-6,0,3.2,4,0);await page.waitForTimeout(3000)
    await page.evaluate(()=>{const s=window.mira,w=s.game.systems.find(x=>x.dust&&x.marks),o=s.player.object,V=o.position.constructor
     const fw=new V(0,0,-1).applyQuaternion(o.quaternion),rt=new V(1,0,0).applyQuaternion(o.quaternion),ground=s.player.getWheelEffects().find(c=>c.grounded)?.point.y??o.position.y-.5
     const at=(f,r,u)=>{const p=o.position.clone().addScaledVector(fw,f).addScaledVector(rt,r);p.y=ground+u;return p}
     // Tyre marks: four parallel S curves ahead of the buggy, widths .3 to .6.
     const col={r:.055,g:.035,b:.022},side=new V()
     for(let k=0;k<4;k++)for(let i=0;i<24;i++){const a=at(2+i*.5,-2.4+k*1.1+Math.sin(i*.35)*.8,.05),b=at(2.5+i*.5,-2.4+k*1.1+Math.sin((i+1)*.35)*.8,.05);side.subVectors(b,a).cross(new V(0,1,0)).normalize();w.marks.add(a,b,side,.3+k*.1,60,.5,col)}
     window.__lab={at,w,fw}})
    await page.evaluate(async()=>{const {createWeaponEffects}=await import('/src/vehicles/effects/index.ts'),fx=createWeaponEffects(window.mira.game),{at,w,fw}=window.__lab,V=fw.constructor
     for(let i=0;i<6;i++){
      w.puff(at(5,-3,.2),1.2)
      const e=at(6,0,1.2);for(let j=0;j<3;j++)w.energy.emit(e,new V(0,1.5+j*.5,0),1,.8,-.3,{r:.4,g:.85,b:1})
      fx.impact(at(5,2.2,1.4),new V(0,1,0),false);fx.impact(at(5,3.6,1.4),new V(0,1,0),true)
      await new Promise(r=>setTimeout(r,60))}
     window.__fxKeep=fx})
    await page.waitForTimeout(250);await shot(`${h}-lab`)
    await page.evaluate(()=>{window.__fxKeep?.dispose();delete window.__fxKeep})
    // Marks from above, close.
    await pose(page,3,0,4,5.5,0);await page.waitForTimeout(3500);await shot(`${h}-marks`)
    await page.evaluate(()=>{const w=window.__lab.w;w.marks.clear();delete window.__lab})
   }else if(kind==='tank'){
    // Creep forward with a settled side camera so the treads are seen scrolling.
    await pose(page,0,5,1.4,0,.2);await page.waitForTimeout(3000)
    const a=await page.evaluate(()=>window.mira.player.treadMaps.map(t=>t.offset.y))
    await page.evaluate(()=>{window.__creep=setInterval(()=>{const s=window.mira,o=s.player.object,V=o.position.constructor,fw=new V(0,0,-1).applyQuaternion(o.quaternion),rt=new V(1,0,0).applyQuaternion(o.quaternion);s.camera.setCinematicPose(o.position.clone().addScaledVector(rt,5).add(new V(0,1.4,0)),o.position.clone().add(new V(0,.2,0)))},50)})
    await drive(page,.4,0,1.5,30);await shot(`${h}-tread-a`)
    await drive(page,.4,0,1.5,3);await shot(`${h}-tread-b`)
    const b=await page.evaluate(()=>{clearInterval(window.__creep);return window.mira.player.treadMaps.map(t=>t.offset.y)})
    results.push({kind,hour,treadOffsetA:a,treadOffsetB:b,treadMoved:a.some((v,i)=>v!==b[i])})
    await stop(page);await page.waitForTimeout(800)
   }else{
    // Parked thruster glow from behind, then paint close up from the side, both at shading tier 0.
    await pose(page,-4.5,1,1.3,0,.4);await page.waitForTimeout(3000);await shot(`${h}-glow`)
    await pose(page,1.6,2.4,1.5,.2,.3);await page.waitForTimeout(3000);await shot(`${h}-paint`)
    await chase(page);await drive(page,.8,0,20);await shot(`${h}-drive`);await stop(page);await page.waitForTimeout(1500)
   }
   results.push(await page.evaluate(({kind,hour})=>{const s=window.mira,i=s.game.renderer.info;return {kind,hour,draws:i.render.drawCalls,effects:{...s.game.scene.userData.vehicleEffects}}},{kind,hour}))
  }
  const actual=await page.evaluate(()=>window.mira.game.renderer.backend.isWebGPUBackend?'webgpu':'webgl')
  results.push({kind,backend:actual,imageRequests:[...new Set(requests)].filter(r=>!allowed(kind).includes(r)),allowedRequests:[...new Set(requests)].filter(r=>allowed(kind).includes(r)),errors:[...new Set(errors)].map(e=>e.slice(0,160))});await page.close()
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,1));console.log(JSON.stringify(results.filter(r=>'errors' in r||'treadMoved' in r)))
 if(results.some(r=>r.errors?.length||r.imageRequests?.length||r.treadMoved===false))process.exitCode=1
}finally{await browser.close()}
