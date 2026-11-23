import {chromium} from 'playwright-core'
import fs from 'node:fs'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
const errors=[],room='vehicles2-'+Date.now()
try{
 const pages=[]
 for(const [kind,body,accent] of [['jet','#d83c29','#19f8a2'],['hovercraft','#315fff','#ffcc22']]){
  const ctx=await browser.newContext({viewport:{width:1200,height:800}})
  await ctx.addInitScript(({body,accent})=>localStorage.setItem('mira.vehicle',JSON.stringify({bodyColor:body,accentColor:accent})),{body,accent})
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message))
  await p.goto(`http://localhost:5185/?autoplay=1&vehicle=${kind}&room=${room}&name=${kind}`)
  await p.waitForFunction(()=>window.miraNet?.connected,null,{timeout:60000});pages.push(p)
 }
 const [a,b]=pages
 await Promise.all(pages.map(p=>p.waitForFunction(()=>window.miraNet.remotes.size===1,null,{timeout:30000})))
 const inspect=()=>{
  const r=[...window.miraNet.remotes.values()][0],meshes=[]
  r.vehicle.object.traverse(o=>{if(o.isMesh&&o.visible)meshes.push({name:o.name,color:o.material.color?.getHexString()})})
  return {kind:r.vehicle.kind,colors:r.vehicle.colors,meshes,position:{...r.vehicle.body.translation()},mode:r.sample.mode,physical:r.physical,gear:r.vehicle.gear?.visible,sampleError:Math.hypot(r.vehicle.body.translation().x-r.sample.p[0],r.vehicle.body.translation().y-r.sample.p[1],r.vehicle.body.translation().z-r.sample.p[2])}
 }
 await a.evaluate(()=>{const s=window.mira;s.player.teleport({x:280,y:s.terrain.heightAt(280,280)+120,z:280});s.game.input.external.z=1})
 await b.evaluate(()=>{const s=window.mira;s.player.teleport({x:0,y:s.terrain.heightAt(0,0)+10,z:0});s.game.input.external.y=1})
 await a.waitForTimeout(4000)
 const snapshots=[]
 for(let i=0;i<8;i++){
  snapshots.push(await Promise.all(pages.map(p=>p.evaluate(inspect))))
  await a.waitForTimeout(200)
 }
 const ownerA=await a.evaluate(()=>({...window.mira.player.body.translation()})),remoteA=snapshots.at(-1)[1]
 const error=Math.hypot(ownerA.x-remoteA.position.x,ownerA.y-remoteA.position.y,ownerA.z-remoteA.position.z)
 if(snapshots[0][0].kind!=='hovercraft'||remoteA.kind!=='jet')throw Error('Wrong remote kinds')
 if(remoteA.colors.body!=='#d83c29'||snapshots[0][0].colors.accent!=='#ffcc22')throw Error('Remote colours were lost')
 if(!remoteA.meshes.some(m=>m.name==='Body_Main'&&m.color==='d83c29'))throw Error('Jet paint did not update')
 if(!snapshots[0][0].meshes.some(m=>m.name==='Main'&&m.color==='315fff'))throw Error('Hovercraft paint did not update')
 if(!remoteA.gear)throw Error('Kinematic remote hover gear missing')
 const sampleError=Math.max(...snapshots.flat().map(s=>s.sampleError))
 if(sampleError>2)throw Error('Remote proxy drifted from interpolated sample '+sampleError)
 if(error>15)throw Error('Remote interpolation lag '+error)
 await a.evaluate(()=>{window.mira.game.input.external.z=.5;window.mira.player.body.setLinvel({x:0,y:0,z:0},true)})
 await a.waitForTimeout(2500)
 const [settledOwner,settledRemote]=await Promise.all([a.evaluate(()=>({...window.mira.player.body.translation()})),b.evaluate(inspect)])
 const settledError=Math.hypot(settledOwner.x-settledRemote.position.x,settledOwner.y-settledRemote.position.y,settledOwner.z-settledRemote.position.z)
 if(settledError>1)throw Error('Remote did not converge in hover '+settledError)
 await Promise.all(pages.map(p=>p.evaluate(()=>window.mira.camera.setVehicle([...window.miraNet.remotes.values()][0].vehicle))))
 await a.waitForTimeout(1000)
 await a.screenshot({path:'/tmp/syn3h-vehicles2/multiplayer-remote-hovercraft.png'});await b.screenshot({path:'/tmp/syn3h-vehicles2/multiplayer-remote-jet.png'})
 // Restore local targets before contexts close and remove their remote rigid bodies.
 await Promise.all(pages.map(p=>p.evaluate(()=>window.mira.camera.setVehicle(window.mira.player))))
 const report={error,sampleError,settledError,errors,snapshots};fs.writeFileSync('/tmp/syn3h-vehicles2/multiplayer.json',JSON.stringify(report,null,2));console.log(JSON.stringify({error,sampleError,settledError,errors,remoteKinds:snapshots[0].map(s=>s.kind),gear:remoteA.gear,physical:remoteA.physical}))
 if(errors.length)throw Error('Browser errors')
}finally{await browser.close()}
