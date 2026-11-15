import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.argv[2]??'/tmp/syn3h-vehicles2/draw-before'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.routeWebSocket(/\/ws/,s=>s.close())
await page.exposeFunction('saveVehicleShot',async kind=>{await page.screenshot({path:out+'/'+kind+'-close.png'})})
try{
 await page.goto('http://localhost:5185/?autoplay=1&seed=1')
 await page.waitForFunction(()=>window.syn3h?.game.tick>10)
 const results=await page.evaluate(async()=>{
  const s=window.syn3h,g=s.game,r=g.renderer,{createVehicle}=await import('/src/vehicles/index.ts'),{attachVehicleEffects}=await import('/src/vehicles/effects/index.ts')
  s.params.set('bots.count',0);s.params.set('gfx.level',2);await new Promise(a=>setTimeout(a,500));r.setAnimationLoop(null)
  s.player.object.visible=false;const center=s.terrain.spawnPoint(0).position.clone();center.y+=2
  const render=()=>{r.info.reset();r.render(g.scene,g.camera);return {draws:r.info.render.drawCalls,triangles:r.info.render.triangles}}
  const ready=async v=>{await(v.modelReady??v.skin?.ready);v.update(0,1)}
  const values=[]
  for(const kind of ['buggy','buggy-classic','jet','hovercraft','tank']){
   const v=createVehicle(g,s.terrain,kind,center.clone());await ready(v)
   for(const local of [true,false]){
    v.isLocal=local;const dispose=attachVehicleEffects(g,s.terrain,v,{local:false})
    for(const distance of [8,80]){
     g.camera.position.copy(center).add({x:distance*.3,y:distance*.3,z:-distance});g.camera.lookAt(center);g.camera.updateMatrixWorld();v.update(0,1)
     v.object.visible=false;render();const baseline=render();v.object.visible=true;render();const total=render()
     const mats=new Set();let meshes=0;v.object.traverseVisible(o=>{if(o.isMesh){meshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m.uuid)}})
     if(local&&distance===8)await window.saveVehicleShot(kind)
     values.push({kind,local,distance,draws:total.draws-baseline.draws,triangles:total.triangles-baseline.triangles,materials:mats.size,meshes})
    }
    dispose()
   }
   v.dispose()
  }
  const bots=[]
  for(let i=0;i<8;i++){const p=center.clone().add({x:(i%4-1.5)*5,y:0,z:Math.floor(i/4)*8});const v=createVehicle(g,s.terrain,'buggy',p);v.isLocal=false;v.setColors(`hsl(${i*40},80%,50%)`,'#ffffff');await ready(v);bots.push({v,dispose:attachVehicleEffects(g,s.terrain,v,{local:false})})}
  const batch=[]
  for(const level of [2,1])for(const distance of [30,80]){
   s.params.set('gfx.level',level);g.camera.position.copy(center).add({x:0,y:distance*.3,z:-distance});g.camera.lookAt(center);g.camera.updateMatrixWorld()
   bots.forEach(({v})=>{v.update(0,1);v.object.visible=false});render();const baseline=render()
   bots.forEach(({v})=>v.object.visible=true);render();const total=render();batch.push({level,distance,draws:total.draws-baseline.draws,triangles:total.triangles-baseline.triangles})
  }
  window.profileBots=bots;window.profileRender=render;window.profileCenter=center
  s.params.set('gfx.level',2);g.camera.position.copy(center).add({x:0,y:12,z:-25});g.camera.lookAt(center);bots.forEach(({v})=>v.update(0,1));render()
  return {values,batch}
 })
 await page.screenshot({path:out+'/game.png'})
 await page.goto('http://localhost:5185/skins.html');await page.waitForFunction(()=>window.skinViewer?.ready)
 await page.evaluate(()=>{const a=window.skinViewer,render=a.renderer.render.bind(a.renderer);a.renderer.render=(s,c)=>{window.viewerScene=s;window.viewerCamera=c;return render(s,c)}});await page.waitForTimeout(100)
 await page.evaluate(()=>{const a=window.skinViewer;a.renderer.setAnimationLoop(null);a.setOpen(1);a.skins.forEach(s=>{for(let i=0;i<4;i++)s.setWheel(i,s.object.position.clone().set(i%2?.7:-.7,-.3,i<2?-.8:.8),0,0);s.setWings(1,0,0)});a.renderer.render(window.viewerScene,window.viewerCamera)})
 await page.screenshot({path:out+'/skins.png'})
 for(const [i,name] of [[0,'classic'],[1,'syn3h']]){await page.evaluate(i=>{window.skinViewer.focus(i);window.skinViewer.renderer.render(window.viewerScene,window.viewerCamera)},i);await page.screenshot({path:out+'/'+name+'-skin-close.png'})}
 await writeFile(out+'/profile.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}))
 if(errors.length)process.exitCode=1
}finally{await browser.close()}
