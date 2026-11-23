import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.routeWebSocket(/\/ws/,s=>s.close())
try{
 await page.goto('http://localhost:5185/?autoplay=1&vehicle=jet')
 await page.waitForFunction(()=>window.mira?.game.tick>10)
 const result=await page.evaluate(async()=>{
  const s=window.mira,{params}=await import('/shared/params.ts'),T=await import('/node_modules/.vite/deps/three_webgpu.js')
  const {attachVehicleEffects,createWeaponEffects}=await import('/src/vehicles/effects/index.ts')
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  params.set('bots.count',0);params.set('sun.hour',0);params.set('gfx.level',2)
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR'}));await wait(2000)
  const samples=[];for(let i=0;i<100;i++){await wait(20);samples.push({...s.game.scene.userData.vehicleEffects,...s.game.performance})}
  window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyR'}))
  const weapons=createWeaponEffects(s.game),p=s.player.object.position.clone()
  weapons.muzzle(p,new T.Vector3(0,0,1));weapons.impact(p,new T.Vector3(0,1,0),true);await wait(200)
  const lights=()=>{let n=0;s.player.object.traverse(o=>{if(o.isSpotLight)n++});return n}
  const localLights=lights();weapons.dispose();window.disposeTestEffects();window.disposeTestEffects();await wait(250)
  // Integrated weapons may retain the shared effects world after the player detaches.
  const cleaned=(s.game.scene.userData.vehicleEffects?.vehicles??0)===0&&lights()===0
  const remote=attachVehicleEffects(s.game,s.terrain,s.player,{local:false});await wait(200)
  const remoteLights=lights();params.set('gfx.level',0);await wait(500)
  const safe={...s.game.scene.userData.vehicleEffects};remote();await wait(100)
  return {samples,localLights,remoteLights,cleaned,safe,finalClean:(s.game.scene.userData.vehicleEffects?.vehicles??0)===0}
 })
 if(!result.cleaned||!result.finalClean||result.localLights!==1||result.remoteLights!==0||result.safe.particles!==60||errors.length)throw new Error(JSON.stringify({result,errors}))
 await writeFile('/tmp/syn3h-vehicles2/effects-performance.json',JSON.stringify({result,errors},null,2))
 console.log(JSON.stringify({localLights:result.localLights,remoteLights:result.remoteLights,cleaned:result.cleaned,safe:result.safe,meanEffectMs:result.samples.reduce((a,s)=>a+s.updateMs,0)/result.samples.length,meanFrameMs:result.samples.reduce((a,s)=>a+s.frameMs,0)/result.samples.length,errors}))
}finally{await browser.close()}
