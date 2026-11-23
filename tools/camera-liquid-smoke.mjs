/** tools/heavy.sh node tools/camera-liquid-smoke.mjs [output directory]
 * Exact seed-1 shoreline repro from the Vehicles lane. One browser and owned Vite server.
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { serveStable } from './serve-stable.mjs'
const out = process.argv[2] ?? '/tmp/syn3h-camera-liquid'
await mkdir(out, { recursive: true })
process.env.MIRA_NO_ROOM_SERVER = '1'
const room = await serveStable({dir:process.cwd(),port:0})
const server = await createServer({define:{'import.meta.env.VITE_SERVER_URL':JSON.stringify('ws://127.0.0.1:5186')},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}})
let browser
try {
  await server.listen()
  browser = await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
  const page = await browser.newPage({viewport:{width:960,height:540}}), errors = []
  page.on('pageerror', e => errors.push(e.stack ?? e.message))
  page.on('console', m => { if(m.type()==='error')errors.push(m.text()) })
  await page.routeWebSocket(/\/ws/, socket=>socket.close())
  await page.goto('http://127.0.0.1:5186/?autoplay=1&vehicle=buggy&planet=volcanic&seed=1')
  await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:90000})
  const start = await page.evaluate(()=>{
    const s=window.mira
    s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12);s.params.set('sun.dayLength',0)
    s.player.teleport({x:-508.902333,y:-0.4,z:-761.626165},3.730641276)
    s.player.body.setLinvel({x:0,y:0,z:0},true)
    s.game.input.external.y=1;s.game.input.external.x=0;s.game.input.external.brakes=false
    window.shoreTrace=[];window.shoreExited=false
    window.shoreProbe=s.game.add({postPhysics(){
      const p=s.player.body.translation(),c=s.game.camera.position
      if(s.terrain.heightAt(p.x,p.z)>0.5&&s.player.lavaDepth===0){window.shoreExited=true;s.game.input.external.y=0;s.game.input.external.brakes=true}
      window.shoreTrace.push({tick:s.game.tick,vehicle:{...p},ground:s.terrain.heightAt(p.x,p.z),camera:c.toArray(),cameraGround:s.terrain.heightAt(c.x,c.z),cameraLiquid:s.terrain.liquidHeightAt?.(c.x,c.z),exited:window.shoreExited})
    }})
    return s.game.tick
  })
  for(const ticks of [250,500,1000]){
    await page.waitForFunction(t=>window.mira.game.tick>=t,start+ticks,{timeout:120000})
    await page.screenshot({path:`${out}/shore-${ticks}.png`})
  }
  const trace=await page.evaluate(()=>{window.mira.game.remove(window.shoreProbe);return window.shoreTrace})
  const belowLiquid=trace.filter(s=>Number.isFinite(s.cameraLiquid)&&s.camera[1]<s.cameraLiquid).length
  const belowClearance=trace.filter(s=>s.camera[1]<Math.max(s.cameraGround,Number.isFinite(s.cameraLiquid)?s.cameraLiquid:-Infinity)+0.5-1e-7).length
  const result={samples:trace.length,belowLiquid,belowClearance,exited:trace.some(s=>s.exited),errors,trace}
  await writeFile(`${out}/trace.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({...result,trace:undefined}))
  assert.equal(belowLiquid,0);assert.equal(belowClearance,0);assert.equal(result.exited,true);assert.deepEqual(errors,[])
  await browser.close();browser=null
  const smoke=await promisify(execFile)(process.execPath,['tools/smoke.mjs','http://127.0.0.1:5186/',`${out}/smoke.png`],{maxBuffer:1e6})
  console.log(smoke.stdout)
}finally{await browser?.close();await server.close();await room.close()}
