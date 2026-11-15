/** Tests the live NetClient callback wiring. Audio waveforms are tested separately by Weapons. */
import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
process.env.SYN3H_NO_ROOM_SERVER='1'
process.env.SYN3H_ROOM_PORT='18951'
const room=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','server/dev.ts'],{env:{...process.env,PORT:'18951'},stdio:'ignore'})
const vite=await createServer({server:{host:'127.0.0.1',port:0}})
const report={errors:[]};let browser
try{
 await vite.listen()
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 const page=await browser.newPage({viewport:{width:640,height:360}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/?autoplay=1&room=cues${Date.now()}`)
 await page.waitForFunction(()=>window.syn3h?.shell&&window.syn3hNet?.connected,null,{timeout:60000})
 await page.evaluate(()=>{window.syn3h.shell.play();document.activeElement?.blur?.()})
 await page.waitForFunction(()=>!window.syn3h.player.object.userData.materializing,null,{timeout:15000})
 report.mapping=await page.evaluate(()=>{
  const n=window.syn3hNet,s=window.syn3h,a=n.ctx.audio,names=[],plays=[]
  const cue=a.cue.bind(a),play=a.play.bind(a)
  a.cue=(name,at)=>{names.push(name);return cue(name,at)}
  a.play=(name,at)=>{plays.push(name);return play(name,at)}
  const at=s.player.object.position
  for(const name of ['yoinkGrab','yoinkFling','yoinkGust'])n.yoink.hooks.cue(name,at)
  for(const name of ['bigRedCharge','bigRedReady','bigRedFizzle'])n.bigRed.hooks.cue(name,at)
  s.params.set('pester.allowed',true);s.params.set('bigRed.allowed',true)
  const launched=n.launchPester([...n.players.keys()].find(id=>id!==n.id)??n.id)
  n.pesters.hooks.onCatch(n.id,999,n.id,at,{x:0,y:0,z:1})
  n.fire(undefined,undefined,'red');n.fire()
  const before=names.length,shots=n.stats.shotsFired
  s.player.object.userData.materializing=true
  n.fire(undefined,undefined,'red');const heldLaunch=n.launchPester(n.id)
  const heldSilent=names.length===before&&n.stats.shotsFired===shots&&!heldLaunch
  delete s.player.object.userData.materializing
  return {names,plays,launched,heldSilent}
 })
 assert.deepEqual(report.mapping.names,['yoinkGrab','yoinkFling','yoinkGust','bigRedCharge','bigRedReady','bigRedFizzle','pesterLaunch','pesterCatch','thunderFire'])
 assert.deepEqual(report.mapping.plays,['laserShot']);assert(report.mapping.launched);assert(report.mapping.heldSilent)
 await page.waitForTimeout(1500)
 assert.deepEqual(report.errors,[])
 console.log('GEAR CUE MAPPING OK',JSON.stringify(report))
}catch(e){report.failure=String(e);console.error(e);process.exitCode=1}finally{
 await browser?.close();await vite.close();room.kill('SIGTERM')
 await writeFile('/tmp/syn3h-gear-cue-mapping.json',JSON.stringify(report,null,2))
}
