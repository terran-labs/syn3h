/** Run under tools/heavy.sh. Frozen files are served unchanged; both origins use this branch's Room.
 * node tools/mixed-version-check.mjs /path/to/frozen/version [report.json]
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { WebSocketServer } from 'ws'
import { chromium } from 'playwright-core'
import { createServer as createVite } from 'vite'
import assert from 'node:assert/strict'
import { legacyPageNames } from './lib/legacy-page-names.mjs'
const root = resolve(process.argv[2])
const output = process.argv[3] ?? '/tmp/syn3h-mixed-version.json'
const { Room } = await tsImport(pathToFileURL(resolve('server/room.ts')).href, import.meta.url)
const { RoomRegistry } = await tsImport(pathToFileURL(resolve('server/registry.ts')).href, import.meta.url)
const rooms = new Map(), browsers = [], results = [], errors = [], wire = []
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.glb':'model/gltf-binary' }
const server = createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://fixture').pathname
    if (path === '/presence') {
      const registry = new RoomRegistry(), now = Date.now()
      for (const [name,room] of rooms) { const p = room.presence(); registry.report(name,p.players,now,p.recipeId) }
      res.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify(registry.presence(now)))
      return
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)))
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type':mime[extname(file)] ?? 'application/octet-stream' }).end(data)
  } catch { console.log('FIXTURE 404',req.url); res.writeHead(404).end() }
})
const sockets = new WebSocketServer({ noServer:true })
server.on('upgrade',(req,socket,head) => {
  const url = new URL(req.url,'http://fixture')
  if (url.pathname !== '/ws') { socket.destroy(); return }
  sockets.handleUpgrade(req,socket,head,ws => {
    const name = url.searchParams.get('room')
    if (!rooms.has(name)) rooms.set(name,new Room(name))
    const room = rooms.get(name)
    const peer = { send:data => { if(ws.readyState === 1) ws.send(data) }, close:(code,reason) => { wire.push({close:code,reason}); ws.close(code,reason) } }
    room.connect(peer)
    ws.on('message',(data,binary) => { if(!binary) { const m=JSON.parse(data.toString()); if(m.type==='hello') wire.push({room:name,v:m.v,modes:m.modes,name:m.name}) }; room.receive(peer,binary ? new Uint8Array(data) : data.toString()) })
    ws.on('close',()=>room.disconnect(peer))
  })
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port
process.env.MIRA_NO_ROOM_SERVER='1'
process.env.MIRA_ROOM_PORT=String(port)
const vite=await createVite({server:{port:0,host:'127.0.0.1'}})
await vite.listen()
const origins={old:`http://127.0.0.1:${port}/`,new:`http://127.0.0.1:${vite.httpServer.address().port}/`}
const build=JSON.parse(await readFile(resolve(root,'build.json'),'utf8'))
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2])
async function open(kind,room) {
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
  browsers.push(browser)
  const page=await browser.newPage({viewport:{width:640,height:360}})
  await page.addInitScript(legacyPageNames) // the frozen page may predate window.mira
  let navigations=0
  // Play uses history.replaceState; count document requests, not same-document URL changes.
  page.on('request',req=>{if(req.isNavigationRequest() && req.frame()===page.mainFrame())navigations++})
  page.on('pageerror',e=>errors.push(`${kind}: ${e.message}`))
  page.on('websocket',ws=>ws.on('framereceived',({payload})=>{if(typeof payload==='string'){try{const m=JSON.parse(payload);if(m.type==='error')errors.push(`${kind}: ${payload}`)}catch{}}}))
  await page.goto(`${origins[kind]}?room=${room}&name=${kind}&autoplay=1`,{waitUntil:'load'})
  await page.waitForFunction(()=>window.mira?.shell,null,{timeout:60000})
  await page.evaluate(()=>{const s=window.mira;s.params.set('gfx.auto',false);s.params.set('gfx.level',0);s.shell.play();document.activeElement?.blur?.()})
  await page.waitForFunction(()=>window.miraNet?.connected,null,{timeout:60000})
  return {page,kind,navigations:()=>navigations,id:await page.evaluate(()=>window.miraNet.id)}
}
async function drive(a,b) {
  const before=await a.page.evaluate(()=>{const p=window.mira.player.body.translation();return [p.x,p.y,p.z]})
  const remoteBefore=await b.page.evaluate(id=>{const p=window.miraNet.remotes.get(id).vehicle.body.translation();return [p.x,p.y,p.z]},a.id)
  await a.page.keyboard.down('KeyW')
  try {await a.page.waitForFunction(([x,z])=>{const p=window.mira.player.body.translation();return Math.hypot(p.x-x,p.z-z)>12},[before[0],before[2]],{timeout:20000})} finally {await a.page.keyboard.up('KeyW')}
  await a.page.keyboard.down('ShiftLeft')
  try {await a.page.waitForFunction(()=>{const v=window.mira.player.body.linvel();return Math.hypot(v.x,v.z)<0.3},null,{timeout:15000})} finally {await a.page.keyboard.up('ShiftLeft')}
  let sample
  for(let i=0;i<60;i++) {
    const real=await a.page.evaluate(()=>{const p=window.mira.player.body.translation();return [p.x,p.y,p.z]})
    const remote=await b.page.evaluate(id=>{const p=window.miraNet.remotes.get(id).vehicle.body.translation();return [p.x,p.y,p.z]},a.id)
    sample={driver:a.kind,moved:distance(before,real),remoteMoved:distance(remoteBefore,remote),error:distance(real,remote),real,remote}
    if(sample.error<2 && sample.remoteMoved>3)break
    await wait(200)
  }
  results.push(sample);console.log('DRIVE',JSON.stringify(sample))
  assert(sample.moved>10 && sample.remoteMoved>3 && sample.error<2,'Both clients must drive and track within 2m when stopped')
}
try {
  for(const order of [['old','new'],['new','old']]) {
    const room=`mixed${Date.now()}`
    const a=await open(order[0],room),b=await open(order[1],room)
    for(const [self,other] of [[a,b],[b,a]]) await self.page.waitForFunction(id=>window.miraNet.remotes.has(id),other.id,{timeout:30000})
    const initial=await Promise.all([a,b].map(c=>c.page.evaluate(()=>({mode:window.miraNet.game.mode,it:window.miraNet.game.it,race:window.miraNet.race}))))
    assert(initial.every(g=>g.mode===2&&g.it===0&&!g.race),'Fresh mixed room must Explore')
    // Default startup is covered above. Remove bots to isolate human movement.
    await a.page.evaluate(()=>window.mira.params.set('bots.count',0))
    await drive(a,b);await drive(b,a)
    const fresh= a.kind==='new'?a:b
    for(const mode of [0,1,2]) {
      await fresh.page.evaluate(mode=>window.mira.params.set('game.mode',mode),mode)
      for(const c of [a,b]) await c.page.waitForFunction(mode=>window.miraNet.game.mode===mode,mode,{timeout:10000})
    }
    const final=await Promise.all([a,b].map(c=>c.page.evaluate(()=>({connected:window.miraNet.connected,mode:window.miraNet.game.mode,it:window.miraNet.game.it,fps:window.mira.game.fps,race:window.miraNet.race}))))
    assert(final.every(g=>g.connected&&g.mode===2&&g.it===0&&!g.race))
    assert.equal(a.navigations(),1);assert.equal(b.navigations(),1)
    results.push({order,initial,final,navigations:[a.navigations(),b.navigations()]})
    for(const browser of browsers.splice(0))await browser.close()
  }
  assert.equal(errors.length,0,JSON.stringify(errors))
  assert(!wire.some(m=>m.close),'No server-initiated close')
  console.log('MIXED VERSION OK',build.version)
  if (process.env.MIXED_SMOKE === '1') {
    const smoke = await promisify(execFile)(process.execPath, ['tools/smoke.mjs', origins.new, '/tmp/syn3h-explore-smoke.png'], { timeout:120000 })
    console.log(smoke.stdout)
  }
} catch(e) {errors.push(e.stack);process.exitCode=1;console.error(e)} finally {
  await writeFile(output,JSON.stringify({build,results,errors,wire},null,2))
  for(const browser of browsers)await browser.close()
  await vite.close()
  for(const ws of sockets.clients)ws.terminate()
  sockets.close();await new Promise(r=>server.close(r))
}
