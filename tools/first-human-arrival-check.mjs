// Run against a locally served production build. Arguments: origin, webgpu|webgl, vehicle kind, output JSON.
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {chromium} from 'playwright-core'
const [origin,backend,kind,out]=process.argv.slice(2)
assert(['webgl','webgpu'].includes(backend)&&['buggy','jet','hovercraft'].includes(kind))
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))
const errors=[]
const browser=await chromium.launch({channel:'chrome',headless:false})
try {
 const host=await browser.newPage({viewport:{width:1280,height:720}})
 host.on('pageerror',error=>errors.push(error.message))
 const url=new URL(origin)
 url.searchParams.set('seed','1');url.searchParams.set('room','human-'+Date.now())
 if(backend==='webgl') url.searchParams.set('webgl','1')
 await host.goto(url.href)
 await host.waitForFunction(()=>window.mira?.game)
 await host.evaluate(()=>{
   const {game,shell}=window.mira,r=game.renderer,b=r.backend
   const events=window.humanEvents=[],seen=new Set()
   window.humanPhase='entry'
   function record(kind,ro,obj,mat) {
     if(!obj||!mat)return
     let root=obj
     while(root && !root.userData.vehicleHeat)root=root.parent
     if(!root)return
     const phase=window.humanPhase
     const source=r._currentSourceMaterial??obj.material
     const key=[phase,kind,obj.id,mat.id,mat.colorNode?.id,source.id,source.version,ro?.initialCacheKey].join('/')
     if(kind==='draw' && seen.has(key))return
     seen.add(key)
     events.push({phase,covered:game.holdDraws&&shell.transitioning,kind,frame:game.frames,root:root.id,o:obj.id,name:obj.name,m:mat.id,type:mat.type,mat:mat.name,
       source:source.name,src:source.id,ver:source.version,color:source.colorNode?.id,override:mat.colorNode?.id,
       geom:obj.geometry?.id,attrs:Object.keys(obj.geometry?.attributes??{}).sort().join(','),side:mat.side,cam:ro?.camera?.id,
       ctx:ro?.context?.id,ro:ro?.initialCacheKey,lv:game.quality.governor.level})
   }
   const build=b.createNodeBuilder,pipe=b.createRenderPipeline,draw=b.draw
   b.createNodeBuilder=function(...args){const node=build.apply(this,args),inner=node.build
     node.build=function(...args){record('graph',null,this.object,this.material);return inner.apply(this,args)};return node}
   b.createRenderPipeline=function(ro,...args){record('pipeline',ro,ro.object,ro.material);return pipe.call(this,ro,...args)}
   b.draw=function(ro,...args){record('draw',ro,ro.object,ro.material);return draw.call(this,ro,...args)}
   game.quality.setLevel(3);game.quality.setAuto(true);game.quality.governor.sample=()=>null
   void shell.play(true)
 })
 await host.waitForFunction(()=>window.mira.shell.playing&&!window.mira.shell.transitioning&&window.miraNet?.isHost,null,{timeout:90000})
 await host.waitForFunction(()=>{const {bots,materialize}=window.mira;return bots.vehicles.length===4&&bots.vehicles.every(v=>!materialize.isMaterializing(v))},null,{timeout:120000})
 await host.evaluate(()=>{window.humanPhase='join'})
 const peer=await browser.newPage({viewport:{width:640,height:480}})
 peer.on('pageerror',error=>errors.push(error.message))
 url.searchParams.set('vehicle',kind)
 await peer.goto(url.href);await peer.waitForFunction(()=>window.mira?.shell)
 await peer.evaluate(()=>{window.mira.game.quality.setLevel(0);return window.mira.shell.play(true)})
 await peer.waitForFunction(()=>window.miraNet?.id&&window.mira.shell.playing&&!window.mira.shell.transitioning)
 const id=await peer.evaluate(()=>window.miraNet.id)
 const at=await host.evaluate(()=>{const {game,player,terrain}=window.mira;const p=game.camera.getWorldDirection(player.object.position.clone()).multiplyScalar(12).add(game.camera.position);return [p.x,terrain.heightAt(p.x,p.z)+2,p.z]})
 await peer.evaluate(at=>{const v=window.mira.player;v.teleport(v.object.position.clone().fromArray(at),0)},at)
 await host.bringToFront();await host.waitForFunction(id=>window.miraNet.remotes.get(id)?.vehicle,id)
 await host.waitForTimeout(3000)
 const result=await host.evaluate(id=>{const v=window.miraNet.remotes.get(id).vehicle;return {root:v.object.id,kind:v.kind,backend:window.mira.game.backend,events:window.humanEvents}},id)
 await writeFile(out,JSON.stringify({...result,errors}))
 assert.deepEqual(errors,[])
 const rows=result.events.filter(e=>e.root===result.root&&e.phase==='join');assert.equal(result.kind,kind);assert.equal(result.backend,backend);assert(rows.some(e=>e.kind==='draw'))
 const misses=rows.filter(e=>e.kind!=='draw')
 console.log(kind,backend,misses.map(e=>[e.frame,e.kind,e.name,e.type,e.source]))
 assert.equal(misses.length,0,'The arriving remote vehicle built a graph or requested a pipeline')

}finally{await browser.close()}
