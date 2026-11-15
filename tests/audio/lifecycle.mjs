import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
await mkdir('tests/audio/artifacts',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--js-flags=--expose-gc']})
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[]
 page.on('pageerror',e=>errors.push(e.message));const cdp=await page.context().newCDPSession(page),nodes=new Map();cdp.on('WebAudio.audioNodeCreated',({node})=>nodes.set(node.nodeId,node.nodeType));cdp.on('WebAudio.audioNodeWillBeDestroyed',({nodeId})=>nodes.delete(nodeId));await cdp.send('WebAudio.enable')
 await page.goto('http://127.0.0.1:5187/');await page.waitForFunction(()=>window.syn3h?.audio,null,{timeout:60000})
 assert.equal(await page.evaluate(()=>syn3h.audio.state),'locked');assert.equal(nodes.size,0)
 await page.touchscreen.tap(30,200);await page.evaluate(()=>syn3h.audio.ready())
 await page.evaluate(async()=>{syn3h.shell.showPanel('music');await document.fonts.ready});await page.waitForTimeout(600);await page.screenshot({path:'tests/audio/artifacts/phone-mix.png'})
 await page.evaluate(()=>{syn3h.params.set('bots.count',0);syn3h.shell.stopAttract();syn3h.shell.onPlay=()=>{};syn3h.shell.play();syn3h.game.remove(syn3h.camera)})
 await page.waitForTimeout(6000)
 const start=Date.now(),samples=[]
 for(let i=0;Date.now()-start<Number(process.env.AUDIO_TEST_MS??300000);i++){
  await page.evaluate(i=>{
   const {audio,terrain,game}=syn3h,kinds=['buggy-syn3h','buggy-classic','jet','hovercraft','tank']
   const fake=(index)=>({kind:kinds[(i+index)%kinds.length],object:{position:game.camera.position.clone().addScalar(index*3)},body:{isValid:()=>true,linvel:()=>({x:20,y:0,z:10})},input:{y:1,z:.8},wheelsGrounded:i%3?4:0,wingsOpen:i%3===0,landedThisStep:false,landingImpact:8,getWheelEffects:()=>[{grounded:true,slip:5}]})
   audio.setPlayer(fake(0),terrain);audio.setVehicles(()=>Array.from({length:12},(_,n)=>fake(n+1)));audio.enabled=true
   for(const cue of ['capture','contested','lost','win','tick','tag','join','leave','click','deploy','retract','lava'])audio.cue(cue)
   audio.setMuted(i%5===0)
  },i)
  // Retain one fleet per cycle, not a fresh fleet on every provider call.
  await page.evaluate(()=>{const fleet=syn3h.audio.vehicleSource();syn3h.audio.setVehicles(()=>fleet)})
  await page.waitForTimeout(3000);await page.evaluate(()=>window.gc?.());await cdp.send('HeapProfiler.collectGarbage')
  const d=await page.evaluate(()=>syn3h.audio.diagnostics);assert.equal(d.remoteVoices,4);assert.ok(d.oneShots===0,JSON.stringify(d));assert.ok(d.trackedVehicles<=5)
  samples.push({seconds:Math.round((Date.now()-start)/1000),nodes:nodes.size,...d});if(i%10===0)console.log(samples.at(-1))
 }
 const counts=samples.slice(Math.min(3,samples.length-1)).map(s=>s.nodes);assert.ok(Math.max(...counts)-Math.min(...counts)<30,'audio graph grows across vehicle replacements')
 await page.evaluate(()=>{syn3h.audio.dispose();window.gc?.()});await page.waitForTimeout(200);await cdp.send('HeapProfiler.collectGarbage')
 const end=await page.evaluate(()=>syn3h.audio.diagnostics);assert.equal(end.engineNodes,0);assert.equal(end.remoteVoices,0);assert.equal(end.oneShots,0);assert.equal(end.state,'closed');assert.deepEqual(errors,[]);// After shutdown only the closed context's destination may remain, plus the adaptive score's
 // worklet nodes: Chrome keeps a worklet node listed until its processor is collected, even
 // with the context closed. They make no sound and cost no audio thread time by then.
 const left=[...nodes.values()];assert.ok(left.every(type=>/^AudioDestination(Node)?$|^AudioWorklet(Node)?$/.test(type)),JSON.stringify(left));assert.ok(left.filter(type=>/Worklet/.test(type)).length<=4,JSON.stringify(left))
 await writeFile(`tests/audio/artifacts/${process.env.AUDIO_TEST_MS?'teardown':'lifecycle'}.json`,JSON.stringify({elapsedMs:Date.now()-start,samples,end,remainingNodes:[...nodes.values()],errors},null,2));console.log('Audio lifecycle passed',end,'nodes',nodes.size)
}finally{await browser.close()}
