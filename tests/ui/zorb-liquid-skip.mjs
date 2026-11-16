// Source-prepared actual-app fixture. Requires its own reviewed, allocated launcher.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST, 'Allocated manifest required')
const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
assert.ok(launch.roomPid && launch.roomStart && launch.vitePid && launch.viteStart)
const deadline = Date.now() + 480000, workEnd = deadline - 30000
let cleanup = false, browser, page, disconnected = false
const remaining = cap => { const n = Math.min(cap, (cleanup ? deadline : workEnd) - Date.now()); assert.ok(n > 0, 'fixture deadline'); return n }
async function bounded(p, cap, label) { let timer; try { return await Promise.race([p, new Promise((_,reject) => { timer=setTimeout(()=>reject(new Error(`${label}: deadline`)),remaining(cap)) })]) } finally { clearTimeout(timer) } }
const hash = b => createHash('sha256').update(b).digest('hex')
const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:5000}).trim()
const required = ['src/main.ts','src/core/Game.ts','src/core/Input.ts','src/vehicles/Vehicle.ts','src/vehicles/zorb.ts','src/world/terrain/ProceduralTerrain.ts','src/audio/index.ts','shared/params.ts']
const report = {source:expected,launch,cases:[],responses:[],parsedScripts:[],errors:[],warnings:[],cleanupErrors:[],captureComplete:false,
  scope:'Chrome only; controlled initial placements plus native controls in the real app. No private float or physics ticks. Not a production/FPS benchmark.',
  limitations:['Visual review required after screenshots/video','Audio invocation logs are not a listening check','No physical-device or network-peer validation']}
const pending = [], locals = new Map(), contexts = []
await mkdir(out,{recursive:true})
const save = () => bounded(writeFile(`${out}/report.json`,JSON.stringify(report,null,2)),5000,'save report')
async function pins() {
  assert.equal(git('rev-parse','HEAD'),expected); assert.equal(git('status','--porcelain','--untracked-files=all'),'')
  const result={}
  for(const path of [...required,'vite.config.ts','server/dev.ts','tests/ui/zorb-liquid-skip.mjs']) {
    const b=await readFile(new URL(path,new URL('../../',import.meta.url))); result[path]=hash(b); locals.set(path,b.toString())
  }
  return result
}
async function watch(p,context,label) {
  const cdp=await bounded(context.newCDPSession(p),5000,'CDP')
  await bounded(cdp.send('Network.enable'),5000,'network observer')
  await bounded(cdp.send('Network.setCacheDisabled',{cacheDisabled:true}),5000,'cache disable')
  cdp.on('Debugger.scriptParsed',e=>{ if(e.url.startsWith(origin)) report.parsedScripts.push({label,url:e.url}) })
  await bounded(cdp.send('Debugger.enable'),5000,'parsed module observer')
  cdp.on('Network.responseReceived',({response:r})=>{ if(r.url.startsWith(origin)&&(r.fromDiskCache||r.fromServiceWorker||r.fromPrefetchCache))report.errors.push(`Cached response ${r.url}`) })
  p.on('pageerror',e=>report.errors.push(`${label}: ${e.stack??e}`))
  p.on('console',m=>{ if(['warning','error'].includes(m.type()))report.warnings.push({label,type:m.type(),text:m.text()}) })
  p.on('websocket',ws=>{
    const u=new URL(ws.url()); if(u.origin.replace(/^ws/,'http')!==new URL(origin).origin)report.errors.push(`Unexpected websocket ${ws.url()}`)
    ws.on('framereceived',({payload})=>{try {if(['update','full-reload','prune'].includes(JSON.parse(String(payload)).type))report.errors.push('HMR mutation')}catch{}})
  })
  p.on('response',response=>{
    const u=new URL(response.url()), path=u.pathname.slice(1)
    if(u.origin!==new URL(origin).origin || !(required.includes(path)||response.request().resourceType()==='document'))return
    const record={label,url:u.href,status:response.status(),path};report.responses.push(record)
    const job=(async()=>{
      const bytes=await bounded(response.body(),10000,'actual response body')
      record.sha256=hash(bytes);record.bytes=bytes.length
      await bounded(writeFile(`${out}/response-${label}-${report.responses.indexOf(record)}.txt`,bytes),5000,'response evidence')
      assert.equal(response.status(),200);assert.equal(response.fromServiceWorker(),false);assert.equal(u.searchParams.has('t'),false)
      if(required.includes(path)) {
        const encoded=bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
        assert.ok(encoded,`actual module source map ${path}`)
        assert.ok(JSON.parse(Buffer.from(encoded[1],'base64')).sourcesContent?.includes(locals.get(path)),`actual source ${path}`)
        record.sourceSha256=hash(locals.get(path))
      }
    })().catch(e=>{record.error=String(e.stack??e);report.errors.push(record.error)})
    pending.push(job)
  })
}
async function persistPage() {
  if(page&&!page.isClosed()) {
    const evidence=await bounded(page.evaluate(()=>window.zorbProbe?.export()),5000,'partial observation')
    if(evidence) { if(evidence.overflow)report.errors.push('Observation capacity exceeded'); report.activeEvidence=evidence; await bounded(writeFile(`${out}/active-evidence.json`,JSON.stringify(evidence)),5000,'partial evidence') }
  }
  await save()
}
async function driveFocus() {
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur()})
  await page.mouse.click(100,150)
  await page.waitForFunction(()=>document.pointerLockElement===syn3h.game.canvas,null,{timeout:remaining(5000)})
}
async function activate(kind) {
  if(await page.evaluate(()=>!!document.pointerLockElement))await page.keyboard.press('Escape')
  const card=page.locator('[data-section="vehicles"] .wi-head')
  if(!await page.locator('.wi-vehicle-select').isVisible())await card.click({timeout:remaining(5000)})
  await page.locator('.wi-vehicle-select').selectOption(kind,{timeout:remaining(5000)})
  await page.waitForFunction(k=>syn3h.player.kind===k&&!syn3h.player.object.userData.materializing,kind,{timeout:remaining(15000)})
  await driveFocus()
  if(!await page.evaluate(()=>syn3h.game.input.state.zorb))await page.keyboard.press('x')
  await page.waitForFunction(()=>syn3h.player.zorb.active&&syn3h.player.zorb.radius>=.95*.5*(syn3h.params.get('zorb.size').value*15+(syn3h.player.camOffset??3)),null,{timeout:remaining(12000)})
}
async function installProbe(liquid) {
  await page.evaluate(liquid=>{
    const s=syn3h,t=s.terrain,rows=[],audio=[],restore=[];let current=null,previous=null,anchor=null,overflow=false
    const copy=v=>({x:v.x,y:v.y,z:v.z})
    const context=(x,z)=>{
      const h=t.liquidHeightAt(x,z),d=.25
      const neighbors=[[x-d,z],[x+d,z],[x,z-d],[x,z+d]].map(([a,b])=>({x:a,z:b,kind:t.liquidKindAt(a,b),height:t.liquidHeightAt(a,b)}))
      const slopeX=(neighbors[1].height-neighbors[0].height)/(.5),slopeZ=(neighbors[3].height-neighbors[2].height)/(.5)
      const len=Math.hypot(slopeX,1,slopeZ),normal={x:-slopeX/len,y:1/len,z:-slopeZ/len}
      return {kind:t.liquidKindAt(x,z),height:h,ground:t.heightAt(x,z),verticalSpeed:t.liquidVerticalSpeedAt(x,z),normal,neighbors,flow:copy(t.liquidFlowAt(x,z,{x:0,y:0,z:0}))}
    }
    for(const name of ['cue','impact','zorbPulse'])if(typeof s.audio[name]==='function') {
      const original=s.audio[name];s.audio[name]=function(...args){if(audio.length<2000)audio.push({tick:s.game.tick,time:s.game.time,name,args:args.map(a=>typeof a==='object'?{...a}:a)});return Reflect.apply(original,this,args)}
      restore.push(()=>s.audio[name]=original)
    }
    const sample=phase=>{
      if(!current)return
      const v=s.player,b=v.body,c=v.zorb.centre(v.object.position.clone()),q=context(c.x,c.z)
      const velocity=copy(b.linvel()),omega=copy(b.angvel()),n=q.normal
      const rel={x:velocity.x-q.flow.x,y:velocity.y-q.verticalSpeed,z:velocity.z-q.flow.z}
      const vn=rel.x*n.x+rel.y*n.y+rel.z*n.z
      const row={case:current,phase,anchorHeight:anchor?t.liquidHeightAt(anchor.x,anchor.z):null,tick:s.game.tick,time:s.game.time,now:performance.now(),position:copy(b.translation()),centre:copy(c),velocity,omega,
        surface:q,radius:v.zorb.radius,gap:(c.y-q.height)*n.y-v.zorb.radius,normalSpeed:vn,tangentSpeed:Math.sqrt(Math.max(0,rel.x**2+rel.y**2+rel.z**2-vn**2)),
        skips:v.zorb.skips,hops:v.zorb.hops,pulse:v.zorb.pulse,input:{...v.input},quality:s.game.quality.getQualityState(),landed:v.landedThisStep,impact:v.landingImpact}
      if(previous&&previous.case===current&&row.skips>previous.skips)row.contact={count:row.skips-previous.skips,previousTick:previous.tick,previousVelocity:previous.velocity,previousOmega:previous.omega}
      if(rows.length>=24000){overflow=true;return}
      rows.push(row);previous=row
    }
    const observer={fixedUpdate(){sample('preWorld-afterControllers')},postPhysics(){sample('postPhysics')}}
    s.game.add(observer)
    window.zorbProbe={
      begin(name){current=name;previous=null},end(){current=null;previous=null},
      site(){
        // Search actual generated terrain; never replace its sampler or liquid methods.
        const size=t.data.size,limit=Math.min(size*.45,850)
        for(let z=-limit;z<=limit;z+=40)for(let x=-limit;x<=limit;x+=40){
          const q=context(x,z)
          if(q.kind===liquid&&q.height-q.ground>16&&q.normal.y>.98&&q.neighbors.every(a=>a.kind===liquid)&&[0,40,80,120,160].every(dx=>t.liquidKindAt(x+dx,z)===liquid&&t.liquidHeightAt(x+dx,z)-t.heightAt(x+dx,z)>16))return {x,z,context:q}
        }
        throw new Error(`No sufficiently deep ${liquid} corridor found`)
      },
      shore(){
        const limit=Math.min(t.data.size*.4,750)
        for(let z=-limit;z<=limit;z+=20)for(let x=-limit;x<=limit;x+=20){
          if(t.liquidKindAt(x,z)!==null||t.liquidKindAt(x+30,z)!==liquid)continue
          const points=[0,5,10,15,20,25,30].map(dx=>({x:x+dx,z,ground:t.heightAt(x+dx,z),kind:t.liquidKindAt(x+dx,z),height:t.liquidHeightAt(x+dx,z)}))
          if(points.every((p,i)=>i===0||Math.abs(p.ground-points[i-1].ground)<2)&&points[0].ground-points.at(-1).height<3)return {x,z,shoreline:points}
        }
        throw new Error('No gently sloping actual shoreline found; no substitute terrain')
      },
      place(site,mode){
        anchor={x:site.x,z:site.z}
        const v=s.player,q=context(site.x,site.z),n=q.normal,r=v.zorb.radius
        const p=v.object.position.clone().set(site.x,mode==='drive'?t.heightAt(site.x,site.z)+r+1:q.height+r+.2,site.z)
        v.teleport(p,-Math.PI/2)
        const c=v.zorb.centre(v.object.position.clone()),b=v.body.translation(),gap=mode==='hop'?-.02:.2
        const targetY=mode==='drive'?t.heightAt(site.x,site.z)+r+.2:q.height+(r+gap)/n.y
        p.set(b.x+site.x-c.x,b.y+targetY-c.y,b.z+site.z-c.z)
        v.teleport(p,-Math.PI/2)
        const speed=mode==='drive'?0:mode==='slow'?3:mode==='steep'?8:mode==='hop'?0:30
        const inward=mode==='drive'?0:mode==='steep'?20:mode==='slow'?1:mode==='hop'?0:3
        const tx=1,ty=-n.x/n.y,tlen=Math.hypot(tx,ty)
        v.body.setLinvel({x:speed/tlen-inward*n.x,y:mode==='drive'?0:speed*ty/tlen-inward*n.y+q.verticalSpeed,z:-inward*n.z},true)
        v.body.setAngvel({x:0,y:mode==='drive'?0:2,z:0},true)
        return {mode,site,actualContext:q,settingsDiagnostic:true,placementDiagnostic:true,skipBefore:v.zorb.skips,hopBefore:v.zorb.hops}
      },
      export(){return {liquid,rows,audio,overflow,clock:'Unmodified app/network clock',surfaceQuery:'actual ProceduralTerrain'}} ,
      dispose(){s.game.remove(observer,false);for(const f of restore)f();current=null}
    }
  },liquid)
}
async function observeCase(liquid,kind,mode,site) {
  const name=`${liquid}-${kind}-${mode}`, record={name,status:'incomplete',classification:'controlled placement, real app stepping'}
  report.cases.push(record);await save()
  record.start=await page.evaluate(({site,mode,name})=>{zorbProbe.begin(name);return zorbProbe.place(site,mode)},{site,mode,name})
  await page.screenshot({path:`${out}/${name}-start.png`,timeout:remaining(5000)})
  if(mode==='hop')await page.keyboard.press('Space')
  if(mode==='drive')await page.keyboard.down('w')
  try {
    const end=Date.now()+(mode==='repeat'?12000:mode==='drive'?6000:5000)
    while(Date.now()<end){await page.waitForTimeout(Math.min(500,remaining(500)));await persistPage()}
  }finally{if(mode==='drive')await page.keyboard.up('w')}
  const data=await page.evaluate(name=>zorbProbe.export().rows.filter(r=>r.case===name),name)
  await writeFile(`${out}/${name}.json`,JSON.stringify(data,null,2))
  record.finalFraming=await page.evaluate(()=>{
    const p=syn3h.player.object.position.clone().project(syn3h.game.camera)
    return {x:p.x,y:p.y,z:p.z,visible:Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>=-1&&p.z<=1}
  })
  await page.screenshot({path:`${out}/${name}-end.png`,timeout:remaining(5000)})
  assert.ok(record.finalFraming.visible,'vehicle centre must be in captured view')
  assert.ok(data.length>4,'actual physics samples required')
  const contacts=data.filter(r=>r.contact),hops=data.at(-1).hops-record.start.hopBefore
  record.contacts=contacts;record.physicsTicks=new Set(data.map(r=>r.tick)).size
  record.firstLastTime=[data[0].time,data.at(-1).time];record.hops=hops
  record.anchorHeightRange=[Math.min(...data.map(r=>r.anchorHeight)),Math.max(...data.map(r=>r.anchorHeight))]
  record.surfaceHeightRange=[Math.min(...data.map(r=>r.surface.height)),Math.max(...data.map(r=>r.surface.height))]
  record.contactSpacings=contacts.slice(1).map((r,i)=>({seconds:r.time-contacts[i].time,ticks:r.tick-contacts[i].tick,metres:Math.hypot(r.centre.x-contacts[i].centre.x,r.centre.y-contacts[i].centre.y,r.centre.z-contacts[i].centre.z)}))
  assert.ok(data.at(-1).time>data[0].time,'normal clock must advance')
  if(mode==='repeat'){assert.ok(contacts.length>=3,'three actual skips required');assert.equal(hops,0);assert.ok(record.contactSpacings.every(s=>s.seconds>=.02-1e-9),'skip cooldown spacing')}
  if(mode==='slow'||mode==='steep'){assert.equal(contacts.length,0,'slow/steep entry cannot skip');assert.equal(hops,0);record.settleEvidence=data.slice(-20)}
  if(mode==='hop'){assert.equal(hops,1,'one physical Space press must hop');const h=data.find(r=>r.hops>record.start.hopBefore);assert.ok(h&&!h.contact,'manual hop priority in observed step')}
  if(mode==='drive'){
    assert.ok(data.some(r=>r.input.y>0),'native W must reach normal input')
    assert.ok(data.some(r=>r.surface.kind===null)&&data.some(r=>r.surface.kind===liquid),'normal driving must cross actual shoreline')
  }
  assert.ok(data.every(r=>Object.values(r.velocity).concat(Object.values(r.omega)).every(Number.isFinite)),'finite motion')
  record.status='assertions-passed-review-pending';await page.evaluate(()=>zorbProbe.end());await save()
}
try {
  report.before=await pins();await save()
  browser=await bounded(chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']}),20000,'Chrome launch')
  browser.on('disconnected',()=>{disconnected=true})
  for(const [liquid,planet] of [['water','archipelago'],['lava','volcanic']]) {
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',recordVideo:{dir:out}});contexts.push(context)
    await context.route('**/*',route=>{
      const url=new URL(route.request().url())
      if(url.origin===new URL(origin).origin||['data:','blob:'].includes(url.protocol))return route.continue()
      report.errors.push(`Unexpected external request ${url.href}`);return route.abort()
    })
    page=await context.newPage();page.setDefaultTimeout(10000);await watch(page,context,liquid)
    await page.goto(`${origin}?room=zorb-${liquid}-${Date.now()}`,{timeout:remaining(45000),waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.syn3h?.shell,null,{timeout:remaining(60000)})
    await page.locator('.boot-veil').waitFor({state:'hidden',timeout:remaining(60000)})
    await page.locator(`.galaxy-label[data-world="${planet}"]`).click({timeout:remaining(15000)})
    await page.waitForFunction(()=>document.querySelector('.syn3h-shell').classList.contains('is-playing')&&window.syn3hNet?.connected&&syn3hNet.isHost,null,{timeout:remaining(45000)})
    report[liquid+'Settings']=await page.evaluate(()=>{
      const s=syn3h,prior={daydream:s.params.get('daydream.seconds').value,quality:s.game.quality.getQualityState()}
      s.params.set('daydream.seconds',0);s.game.quality.setLevel(3);s.game.quality.setAuto(false)
      return {prior,diagnosticOverrides:{daydreamSeconds:0,quality:3,auto:false},params:s.params.snapshot('world'),room:syn3hNet.isHost}
    })
    await installProbe(liquid)
    for(const kind of ['buggy','jet','hovercraft','tank']) {
      await activate(kind);const site=await page.evaluate(()=>zorbProbe.site())
      await observeCase(liquid,kind,'repeat',site)
      if(kind==='buggy')for(const mode of ['slow','steep','hop','drive'])await observeCase(liquid,kind,mode,mode==='drive'?await page.evaluate(()=>zorbProbe.shore()):site)
    }
    await persistPage();await page.evaluate(()=>zorbProbe.dispose());await context.close();page=undefined
  }
}catch(e){report.failure=String(e.stack??e);try{await persistPage()}catch(partial){report.cleanupErrors.push(`partial: ${partial}`)}}
finally {
  cleanup=true
  for(const c of contexts)try{await bounded(c.close(),5000,'context close')}catch(e){report.cleanupErrors.push(String(e))}
  if(browser)try{await bounded(browser.close(),10000,'browser close')}catch(e){report.cleanupErrors.push(String(e))}
  try {
    // Producer is closed. Drain dynamically because body handlers can append errors.
    let cursor=0;while(cursor<pending.length){const batch=pending.slice(cursor);cursor=pending.length;await bounded(Promise.all(batch),10000,'body drain')}
    assert.ok(!browser||disconnected,'browser disconnect required')
    for(const label of ['water','lava'])for(const path of required){
      assert.ok(report.responses.some(r=>r.label===label&&r.path===path&&r.sourceSha256&&!r.error),`actual source missing ${label}/${path}`)
      assert.ok(report.parsedScripts.some(r=>r.label===label&&new URL(r.url).pathname===`/${path}`),`parsed module missing ${label}/${path}`)
    }
    assert.deepEqual(report.errors,[]);report.after=await pins();assert.deepEqual(report.after,report.before)
    assert.equal(report.cases.length,16,'all planned cases required; interrupted cases are not a full matrix')
    assert.ok(report.cases.filter(c=>c.name.startsWith('water-')).some(c=>c.anchorHeightRange?.[1]>c.anchorHeightRange?.[0]),'actual water wave evolution required')
    report.captureComplete=!report.failure&&!report.cleanupErrors.length
  }catch(e){report.cleanupErrors.push(String(e.stack??e))}
  await save()
}
if(report.failure||report.cleanupErrors.length||!report.captureComplete)process.exitCode=1
