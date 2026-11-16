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
const required = ['src/main.ts','src/core/Game.ts','src/core/Input.ts','src/vehicles/Vehicle.ts','src/vehicles/zorb.ts','src/vehicles/Jet.ts','src/vehicles/Hovercraft.ts','src/vehicles/Tank.ts','src/vehicles/Syn3hBuggy.ts','src/world/terrain/ProceduralTerrain.ts','src/audio/index.ts','shared/params.ts']
const report = {source:expected,launch,cases:[],responses:[],parsedScripts:[],errors:[],warnings:[],cleanupErrors:[],captureComplete:false,productAccepted:false,disposition:'review-required',navigation:{},canvasActions:[],vehicleSelections:[],
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
    const record={label,url:u.href,status:response.status(),path,resourceType:response.request().resourceType(),navigationRequest:response.request().isNavigationRequest(),mainFrame:response.frame()===p.mainFrame()};report.responses.push(record)
    const job=(async()=>{
      const bytes=await bounded(response.body(),10000,'actual response body')
      record.sha256=hash(bytes);record.bytes=bytes.length
      await bounded(writeFile(`${out}/response-${label}-${report.responses.indexOf(record)}.txt`,bytes),5000,'response evidence')
      assert.equal(response.status(),200);assert.equal(response.fromServiceWorker(),false);assert.equal(u.searchParams.has('t'),false)
      if(record.resourceType==='document'&&record.navigationRequest&&record.mainFrame) {
        assert.ok(bytes.length>0,'nonempty main-frame document')
        assert.match(response.headers()['content-type']??'',/text\/html/i)
        const html=bytes.toString();assert.match(html,/<!doctype html>/i);assert.match(html,/src=["']\/src\/main\.ts["']/)
        const comparison=await bounded(fetch(u.href,{cache:'no-store',signal:AbortSignal.timeout(remaining(10000))}),10000,'document comparison')
        assert.equal(comparison.status,200);assert.equal(comparison.url,u.href)
        const expectedBody=Buffer.from(await bounded(comparison.arrayBuffer(),10000,'document comparison bytes'))
        record.comparisonSha256=hash(expectedBody)
        assert.equal(record.sha256,record.comparisonSha256,'actual navigation differs from owned served document')
        record.documentVerified=true
      }
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
function behaviorSummary(rows) {
  if(!rows.length)return {disposition:'incomplete',sampleCount:0,productAccepted:false}
  const range=values=>({min:Math.min(...values),max:Math.max(...values),first:values[0],last:values.at(-1)})
  const magnitude=v=>Math.hypot(v.x,v.y,v.z)
  const tail=rows.slice(-20),contacts=rows.filter(r=>r.contact)
  return {disposition:'review-required',productAccepted:false,sampleCount:rows.length,
    phases:[...new Set(rows.map(r=>r.phase))],radius:range(rows.map(r=>r.radius)),
    endpoint:{tick:rows.at(-1).tick,time:rows.at(-1).time,phase:rows.at(-1).phase},
    tangentSpeed:range(rows.map(r=>r.tangentSpeed)),worldSpeed:range(rows.map(r=>magnitude(r.velocity))),
    spin:{magnitude:range(rows.map(r=>magnitude(r.omega))),x:range(rows.map(r=>r.omega.x)),y:range(rows.map(r=>r.omega.y)),z:range(rows.map(r=>r.omega.z))},
    gap:range(rows.map(r=>r.gap)),normalSpeed:range(rows.map(r=>r.normalSpeed)),
    stuck:{observed:rows.some(r=>r.liquidState.stuck),samples:rows.filter(r=>r.liquidState.stuck).length,final:rows.at(-1).liquidState.stuck},
    contacts:contacts.map((r,i)=>({tick:r.tick,time:r.time,count:r.contact.count,gapBefore:r.contact.previousGap,gapAfter:r.gap,
      tangentBefore:r.contact.previousTangentSpeed,tangentAfter:r.tangentSpeed,tangentDelta:r.tangentSpeed-r.contact.previousTangentSpeed,
      omegaBefore:r.contact.previousOmega,omegaAfter:r.omega,omegaDelta:{x:r.omega.x-r.contact.previousOmega.x,y:r.omega.y-r.contact.previousOmega.y,z:r.omega.z-r.contact.previousOmega.z},
      secondsSincePrior:i?r.time-contacts[i-1].time:null})),
    settling:{status:'review-required',tailSamples:tail.length,tailDuration:tail.at(-1).time-tail[0].time,
      gap:range(tail.map(r=>r.gap)),normalSpeed:range(tail.map(r=>r.normalSpeed)),worldSpeed:range(tail.map(r=>magnitude(r.velocity))),
      finalLiquid:tail.at(-1).surface.kind,finalStuck:tail.at(-1).liquidState.stuck},
    review:['speed loss at contacts','full spin evolution','surface gap and settling','non-stuck motion','contact chatter','visuals and existing audio']}
}
async function persistPage() {
  if(page&&!page.isClosed()) {
    const evidence=await bounded(page.evaluate(()=>window.zorbProbe?.export()),5000,'partial observation')
    if(evidence) { if(evidence.overflow)report.errors.push('Observation capacity exceeded'); if(evidence.phaseOverflow||evidence.errorDrops||evidence.observationErrors?.length||evidence.checkpoint?.status==='failed'||evidence.checkpoint?.errors?.length)report.errors.push('Controller/float evidence incomplete'); report.activeEvidence=evidence; for(const record of report.cases) { const rows=evidence.rows.filter(r=>r.case===record.name);if(rows.length&&!record.endpointFrozen)record.behavior=behaviorSummary(rows) } await bounded(writeFile(`${out}/active-evidence.json`,JSON.stringify(evidence)),5000,'partial evidence'); await bounded(writeFile(`${out}/phases-${evidence.liquid}.json`,JSON.stringify({phases:evidence.phases,overflow:evidence.phaseOverflow,errors:evidence.observationErrors,errorDrops:evidence.errorDrops,boundVehicle:evidence.boundVehicle,checkpoint:evidence.checkpoint})),5000,'phase evidence') }
  }
  await save()
}
async function driveFocus() {
  const point=await page.evaluate(()=>{
    const canvas=syn3h.game.canvas,r=canvas.getBoundingClientRect()
    const left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom)
    for(let iy=1;iy<10;iy++)for(let ix=1;ix<10;ix++){
      const x=left+(right-left)*ix/10,y=top+(bottom-top)*iy/10
      if(document.elementFromPoint(x,y)===canvas)return {x,y,rect:{left:r.left,top:r.top,width:r.width,height:r.height}}
    }
    throw new Error('No exposed actual game canvas point; do not click an overlay')
  })
  await page.mouse.move(point.x,point.y)
  assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===syn3h.game.canvas,point),'canvas hit target changed')
  await page.mouse.click(point.x,point.y)
  await page.waitForFunction(()=>document.pointerLockElement===syn3h.game.canvas,null,{timeout:remaining(5000)})
  report.canvasActions.push({point,nativeClick:true,pointerLockVerified:true})
}
// Read-only DOM/public-state checks; never force a panel or dismiss a dialog.
function nativeSelectionState(stage) {
  const visible=el=>!!el&&!el.closest('[hidden]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'
  const inspector=document.querySelector('.world-inspector'),head=document.querySelector('[data-section="you"] .wi-head'),select=document.querySelector('[data-section="you"] .wi-vehicle-select')
  const state={locked:!!document.pointerLockElement,paused:syn3h.game.isPaused,
    modal:[...document.querySelectorAll('[aria-modal="true"],.pause-veil')].some(visible),
    playing:syn3h.shell.playing,suspended:syn3h.game.input.suspended,
    inspectorVisible:visible(inspector),inspectorInert:!!inspector?.closest('[inert]'),
    expanded:head?.getAttribute('aria-expanded'),selectVisible:visible(select),
    selectInert:!!select?.closest('[inert]'),selectDisabled:select?.disabled,
    activeElement:document.activeElement?.tagName}
  if(!stage)return state
  if(state.paused||state.modal||!state.playing||state.suspended)throw new Error('Unexpected pause/modal/menu during native selection: '+JSON.stringify(state))
  const panels=!state.locked&&state.inspectorVisible&&!state.inspectorInert
  return stage==='panels'?panels:panels&&state.expanded==='true'&&state.selectVisible&&!state.selectInert&&!state.selectDisabled
}
async function activate(kind) {
  const choices = {
    buggy: { optionId: 'buggy-syn3h', runtimeKinds: ['buggy', 'buggy-syn3h'] },
    jet: { optionId: 'jet', runtimeKinds: ['jet'] },
    hovercraft: { optionId: 'hovercraft', runtimeKinds: ['hovercraft'] },
    tank: { optionId: 'tank', runtimeKinds: ['tank'] },
  }
  assert.ok(Object.hasOwn(choices,kind),`Unsupported vehicle case ${kind}`)
  const choice=choices[kind]
  const transition={kind,before:await page.evaluate(nativeSelectionState)}
  report.selectionTransitions??=[];report.selectionTransitions.push(transition);await save()
  assert.ok(!transition.before.paused&&!transition.before.modal&&transition.before.playing&&!transition.before.suspended,'unexpected pause/modal/menu before vehicle selection')
  if(transition.before.locked)await page.keyboard.press('Escape')
  try {
    await page.waitForFunction(nativeSelectionState,'panels',{timeout:remaining(5000)})
  } catch(error) {
    transition.failure=String(error.stack??error);report.failure=transition.failure
    try { transition.failureState=await page.evaluate(nativeSelectionState) }
    catch(secondary) { report.cleanupErrors.push(`UI failure-state observation: ${secondary.stack??secondary}`) }
    try { await save() }
    catch(secondary) { report.cleanupErrors.push(`UI failure evidence persistence: ${secondary.stack??secondary}`) }
    throw error
  }
  const card=page.locator('[data-section="you"] .wi-head')
  const select=page.locator('[data-section="you"] .wi-vehicle-select')
  const expanded=await card.getAttribute('aria-expanded')
  assert.ok(expanded==='true'||expanded==='false','Me card expansion state required')
  if(expanded==='false'){await card.scrollIntoViewIfNeeded();await card.click({timeout:remaining(5000)})}
  try {
    await page.waitForFunction(nativeSelectionState,'select',{timeout:remaining(5000)})
  } catch(error) {
    transition.failure=String(error.stack??error);report.failure=transition.failure
    try { transition.failureState=await page.evaluate(nativeSelectionState) }
    catch(secondary) { report.cleanupErrors.push(`UI failure-state observation: ${secondary.stack??secondary}`) }
    try { await save() }
    catch(secondary) { report.cleanupErrors.push(`UI failure evidence persistence: ${secondary.stack??secondary}`) }
    throw error
  }
  await select.scrollIntoViewIfNeeded()
  const selection={url:page.url(),kind,optionId:choice.optionId,available:await select.evaluate(el=>Array.from(el.options,option=>({value:option.value,label:option.label})))}
  report.vehicleSelections.push(selection);await save()
  assert.ok(selection.available.some(option=>option.value===choice.optionId),`Missing public vehicle option ${choice.optionId}`)
  transition.beforeSelection=await page.evaluate(nativeSelectionState);await save()
  try { await select.selectOption(choice.optionId,{timeout:remaining(5000)}) }
  catch(error) {
    transition.failure=String(error.stack??error);report.failure=transition.failure
    try { transition.failureState=await page.evaluate(nativeSelectionState) }
    catch(secondary) { report.cleanupErrors.push(`UI failure-state observation: ${secondary.stack??secondary}`) }
    try { await save() }
    catch(secondary) { report.cleanupErrors.push(`UI failure evidence persistence: ${secondary.stack??secondary}`) }
    throw error
  }
  selection.selectedValue=await select.inputValue();await save()
  assert.equal(selection.selectedValue,choice.optionId,'native vehicle selection')
  // The public Buggy option and cached runtime Buggy may use different explicit aliases.
  await page.waitForFunction(kinds=>kinds.includes(syn3h.player.kind)&&!syn3h.player.object.userData.materializing,choice.runtimeKinds,{timeout:remaining(15000)})
  selection.runtimeKind=await page.evaluate(()=>syn3h.player.kind)
  assert.ok(choice.runtimeKinds.includes(selection.runtimeKind),'runtime vehicle kind')
  selection.runtimeVerified=true;await save()
  await driveFocus()
  if(!await page.evaluate(()=>syn3h.game.input.state.zorb))await page.keyboard.press('x')
  await page.waitForFunction(()=>syn3h.player.zorb.active&&syn3h.player.zorb.radius>=.95*.5*(syn3h.params.get('zorb.size').value*15+(syn3h.player.camOffset??3)),null,{timeout:remaining(12000)})
}
async function installProbe(liquid) {
  await page.evaluate(liquid=>{
    const s=syn3h,t=s.terrain,rows=[],audio=[],restore=[];let current=null,previous=null,anchor=null,overflow=false
    const phases=[],observationErrors=[];let phaseOverflow=false,errorDrops=0,binding=null,callId=0
    const copy=v=>({x:v.x,y:v.y,z:v.z})
    // Diagnostic reads of exact source-pinned methods/fields, never substitute physics calls.
    const describe=e=>{try{return String(e?.stack??e)}catch{return '[unreadable thrown value]'}}
    const error=(where,e)=>{try{if(observationErrors.length<100)observationErrors.push({where,case:current,tick:s.game.tick,error:describe(e)});else errorDrops++}catch{errorDrops++}}
    const safely=(where,fn)=>{try{return fn()}catch(e){error(where,e)}}
    const value=v=>typeof v==='number'&&!Number.isFinite(v)?String(v):v
    const vector=v=>({x:value(v.x),y:value(v.y),z:value(v.z)})
    const snapshot=(v,phase,id,outcome)=>safely(phase,()=>{
      if(!current)return
      if(phases.length>=60000){phaseOverflow=true;return}
      const b=v.body,z=v.zorb,h=z.skipSample
      phases.push({case:current,phase,callId:id,tick:s.game.tick,time:s.game.time,now:performance.now(),
        vehicle:{uuid:v.object.uuid,kind:v.kind,bodyHandle:b.handle,selected:s.player===v},
        active:z.active,on:z.on,materializing:v.object.userData.materializing===true,input:{...v.input},
        held:Object.fromEntries(['KeyE','KeyQ','KeyR','KeyF','Space','KeyW','KeyA','KeyS','KeyD'].map(k=>[k,typeof s.game.input.held==='function'?s.game.input.held(k):null])),
        radius:value(z.radius),target:value(z.target),velocity:vector(b.linvel()),omega:vector(b.angvel()),
        force:vector(b.userForce()),torque:vector(b.userTorque()),
        decision:{onLiquid:z.onLiquid,hopPending:z.hopPending,armed:z.skipArmed,coasting:z.skipCoasting,cooldown:value(z.skipCooldown),skips:z.skips,hops:z.hops,
          previous:h?{x:value(h.x),y:value(h.y),z:value(h.z),radius:value(h.radius),gap:value(h.gap),speed:value(h.speed),kind:h.kind}:null},
        outcome})
    })
    // One bounded window in the original growing Buggy case. Keep only the current
    // candidate step until the second counted skip, then at most twelve ordinary steps.
    const checkpoint={case:'water-buggy-repeat',maxSteps:12,status:'not-started',steps:[],errors:[]}
    let checkpointStep=null,skipInvocation=null,skipBaseline=0
    const failCheckpoint=message=>{checkpoint.status='failed';if(checkpoint.errors.length<20)checkpoint.errors.push(message);else error('checkpoint overflow',message)}
    const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z
    const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z})
    const scale=(a,k)=>({x:a.x*k,y:a.y*k,z:a.z*k})
    const bodyState=v=>{
      const b=v.body,z=v.zorb,c=copy(z.centre(v.object.position.clone())),com=copy(b.worldCom())
      const velocity=copy(b.linvel()),omega=copy(b.angvel()),r=sub(c,com)
      return {position:copy(b.translation()),rotation:{...b.rotation()},com,centre:c,velocity,omega,
        centreVelocity:{x:velocity.x+omega.y*r.z-omega.z*r.y,y:velocity.y+omega.z*r.x-omega.x*r.z,z:velocity.z+omega.x*r.y-omega.y*r.x},
        radius:z.radius,target:z.target,mass:b.mass(),force:copy(b.userForce()),torque:copy(b.userTorque()),
        active:z.active,on:z.on,materializing:v.object.userData.materializing===true,input:{...v.input},
        held:Object.fromEntries(['KeyE','KeyQ','KeyR','KeyF','Space','KeyW','KeyA','KeyS','KeyD'].map(k=>[k,s.game.input.held(k)])),
        skips:z.skips,armed:z.skipArmed,coasting:z.skipCoasting}
    }
    const checkpointState=(v,phase,id)=>{
      if(!checkpointStep)return
      if(checkpointStep.states.length>=24){failCheckpoint('Step state capacity exceeded');return}
      const state=bodyState(v)
      const finite=o=>Object.values(o).every(a=>typeof a==='number'?Number.isFinite(a):a&&typeof a==='object'?finite(a):true)
      if(!finite(state))failCheckpoint('Nonfinite checkpoint state')
      checkpointStep.states.push({phase,callId:id,tick:s.game.tick,vehicle:v.object.uuid,bodyHandle:v.body.handle,...state})
    }
    const checkpointBefore=(v,label,id,args)=>{
      if(current!==checkpoint.case||['complete','failed'].includes(checkpoint.status))return null
      if(label==='fixed'){
        if(checkpointStep)failCheckpoint('Next fixed step arrived before postPhysics')
        if(checkpoint.status==='failed')return null
        checkpointStep={tick:s.game.tick,vehicle:v.object.uuid,bodyHandle:v.body.handle,dt:args[0],states:[],skipCalls:[]}
      }
      if(!checkpointStep)return null
      if(label==='skip'){
        if(skipInvocation){failCheckpoint('Nested skip invocation');return null}
        if(checkpointStep.skipCalls.length){failCheckpoint('Multiple skip calls in one ordinary step');return null}
        const [,kind,p,surface,dt,hopped]=args
        skipInvocation={callId:id,tick:s.game.tick,kind,centre:copy(p),surface,dt,hopped,queries:[],before:bodyState(v)}
        checkpointStep.skipCalls.push(skipInvocation)
        return skipInvocation
      }
      checkpointState(v,`${label}:before`,id)
      return null
    }
    const finishSkip=(v,call,result,thrown)=>{
      if(!call)return
      try {
        call.after=bodyState(v);call.result=result;call.thrown=thrown
        if(thrown)throw new Error(`Original skip call threw: ${thrown}`)
        const {centre:p,surface,queries:q}=call
        const one=(key,x,z)=>{const found=q.filter(a=>a.key===key&&a.x===x&&a.z===z&&!a.thrown);if(found.length!==1)throw new Error(`Expected one fresh ${key} at ${x},${z}`);return found[0]}
        const height=(x,z)=>one('liquidKindAt',x,z).result===call.kind?one('liquidHeightAt',x,z).result:NaN
        const left=height(p.x-.25,p.z),right=height(p.x+.25,p.z),back=height(p.x,p.z-.25),front=height(p.x,p.z+.25)
        const derivative=(lo,hi)=>Number.isFinite(lo)&&Number.isFinite(hi)?(hi-lo)/.5:Number.isFinite(hi)?(hi-surface)/.25:(surface-lo)/.25
        const dx=derivative(left,right),dz=derivative(back,front),length=Math.hypot(dx,1,dz)
        const derivedNormal={x:-dx/length,y:1/length,z:-dz/length}
        // Early returns have no heave/flow call. They are explicitly incomplete inputs,
        // never an invitation to read the private scratch vectors from an older call.
        const heave=one('liquidVerticalSpeedAt',p.x,p.z).result,flow=one('liquidFlowAt',p.x,p.z).out
        // These calls occur only after skipNormal.set(...).normalize() in the pinned
        // method. Reading it here is fresh for this invocation, not a prior branch.
        const n=copy(v.zorb.skipNormal)
        const vertical=heave+dx*flow.x+dz*flow.z
        if(![surface,dx,dz,n.x,n.y,n.z,heave,flow.x,flow.z,vertical].every(Number.isFinite))throw new Error('Nonfinite same-call inputs')
        const surfaceVelocity={x:flow.x,y:vertical,z:flow.z}
        call.inputs={valid:true,normal:n,derivedNormal,dx,dz,heave,flow,vertical,source:'same invocation arguments and forwarded query outputs'}
        call.comNormalSpeed=dot(sub(call.before.velocity,surfaceVelocity),n)
        call.centreNormalSpeed=dot(sub(call.before.centreVelocity,surfaceVelocity),n)
        call.afterComNormalSpeed=dot(sub(call.after.velocity,surfaceVelocity),n)
        const syncBefore=checkpointStep.states.find(a=>a.phase==='sync:before'),syncAfter=checkpointStep.states.find(a=>a.phase==='sync:after')
        call.radiusRate=syncBefore&&syncAfter&&call.dt>0?(syncAfter.radius-syncBefore.radius)/call.dt:null
        call.boundaryNormalSpeedWithoutNormalRotation=call.radiusRate===null?null:call.centreNormalSpeed-call.radiusRate
        call.gap=(p.y-surface)*n.y-call.before.radius
        const a=call.before,b=call.after,dv=sub(b.velocity,a.velocity),dw=sub(b.omega,a.omega)
        const impulse=scale(dv,a.mass),normalImpulse=dot(impulse,n),tangentImpulse=sub(impulse,scale(n,normalImpulse))
        const valid=b.skips===a.skips+1&&a.mass===b.mass&&Number.isFinite(a.mass)&&a.mass>0&&dw.x===0&&dw.y===0&&dw.z===0
        call.impulseWork={valid,impulse,normalImpulse,tangentImpulse,angularDelta:dw,
          normalWork:valid?normalImpulse*(dot(a.velocity,n)+dot(b.velocity,n))/2:null,
          tangentWork:valid?dot(tangentImpulse,scale({x:a.velocity.x+b.velocity.x,y:a.velocity.y+b.velocity.y,z:a.velocity.z+b.velocity.z},.5)):null,
          translationEnergyDelta:valid ? .5*a.mass*(dot(b.velocity,b.velocity)-dot(a.velocity,a.velocity)):null}
        if(!checkpoint.anchor&&b.skips-skipBaseline===2&&b.skips===a.skips+1){checkpoint.anchor={tick:call.tick,callId:call.callId};if(checkpoint.status!=='failed'&&!checkpoint.errors.length)checkpoint.status='collecting'}
        if(checkpoint.anchor&&call.tick!==checkpoint.anchor.tick&&(b.armed||call.comNormalSpeed<0))checkpointStep.terminal=b.armed?'rearmed':'returned-inward'
      }catch(e){call.inputs={valid:false,reason:describe(e)};if(checkpoint.anchor)failCheckpoint(`Missing exact skip inputs: ${describe(e)}`)}
      finally{skipInvocation=null}
    }
    const checkpointAfter=(v,label,id,token,result,thrown)=>{
      if(label==='skip'){finishSkip(v,token,result,thrown);return}
      if(current===checkpoint.case&&checkpointStep)checkpointState(v,`${label}:${thrown?'throw':'after'}`,id)
    }
    const checkpointWorld=(phase)=>safely(`checkpoint ${phase}`,()=>{
      if(!checkpointStep)return
      checkpointState(s.player,phase,null)
      if(phase!=='postPhysics')return
      if(checkpoint.anchor){
        const required=['fixed:before','sync:before','sync:after','controller:before','controller:after','float:before','float:after','fixed:after','preWorld-afterControllers','postPhysics']
        for(const name of required)if(checkpointStep.states.filter(a=>a.phase===name).length!==1)failCheckpoint(`Missing or duplicated ${name}`)
        if(checkpointStep.states.some(a=>a.tick!==checkpointStep.tick||a.vehicle!==checkpointStep.vehicle||a.bodyHandle!==checkpointStep.bodyHandle))failCheckpoint('Step identity or tick mismatch')
        if(checkpointStep.skipCalls.length!==1||checkpointStep.skipCalls[0].inputs?.valid!==true)failCheckpoint('Missing complete same-call skip inputs')
        if(checkpoint.steps.length>=12)failCheckpoint('Twelve-step bound exceeded')
        else checkpoint.steps.push(checkpointStep)
        if(checkpoint.status!=='failed'&&!checkpoint.errors.length){
          if(checkpointStep.terminal)checkpoint.status='complete'
          else if(checkpoint.steps.length===12)failCheckpoint('No inward return or rearm within twelve ordinary steps')
        }
      }
      checkpointStep=null
    })
    const endCheckpoint=()=>{if(current===checkpoint.case&&checkpoint.status!=='complete')failCheckpoint('Case ended without complete bounded rebound evidence')}
    const restoreBinding=()=>{
      const old=binding;if(!old)return
      binding=null
      for(const entry of old.entries.slice().reverse())safely(`restore ${entry.key}`,()=>{
        if(entry.object[entry.key]!==entry.wrapper){error('wrapper ownership',entry.key);return}
        if(entry.descriptor)Object.defineProperty(entry.object,entry.key,entry.descriptor)
        else delete entry.object[entry.key]
      })
    }
    const verifyBinding=()=>safely('binding check',()=>{
      if(!binding)return
      if(s.player!==binding.vehicle)error('vehicle changed during case','No retarget permitted')
      for(const e of binding.entries)if(e.object[e.key]!==e.wrapper)error('wrapper replaced',e.key)
    })
    const bind=()=>{
      if(binding)throw new Error('Previous case observer still bound')
      const v=s.player;binding={vehicle:v,entries:[]}
      const wrap=(object,key,label)=>{
        const original=object[key],descriptor=Object.getOwnPropertyDescriptor(object,key)
        if(typeof original!=='function')throw new Error(`Missing observed method ${key}`)
        const wrapper=function(...args){
          const id=++callId
          if(label==='fixed')verifyBinding()
          if(label==='dispose')safely('dispose observation',()=>{error('disposed during case',v.object.uuid);restoreBinding()})
          if(label!=='sync'&&label!=='skip')snapshot(v,`${label}:before`,id,{argumentCount:args.length,dt:typeof args[0]==='number'?value(args[0]):typeof args[2]==='number'?value(args[2]):null})
          const token=safely('checkpoint before',()=>checkpointBefore(v,label,id,args))
          let returned=false,result,thrown
          try {result=Reflect.apply(original,this,args);returned=true;return result}
          catch(e){thrown=describe(e);if(label!=='sync'&&label!=='skip')snapshot(v,`${label}:throw`,id,{thrown});throw e}
          finally {safely('checkpoint after',()=>checkpointAfter(v,label,id,token,result,thrown));if(returned&&label!=='sync'&&label!=='skip')snapshot(v,`${label}:after`,id,{returnType:typeof result,returnValue:result===undefined?'undefined':result===null?null:['boolean','number','string'].includes(typeof result)?value(result):'[opaque]'})}
        }
        Object.defineProperty(object,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:wrapper})
        binding.entries.push({object,key,descriptor,wrapper})
      }
      try {
        // fixed supplies restored-input boundaries; these two wrap the actual nested calls.
        wrap(v,'applyForces','controller');wrap(v.zorb,'float','float');wrap(v,'fixedUpdate','fixed');wrap(v,'dispose','dispose')
        if(current===checkpoint.case){
          skipBaseline=v.zorb.skips;if(checkpoint.status!=='failed'&&!checkpoint.errors.length)checkpoint.status='waiting-for-second-skip'
          wrap(v.zorb,'sync','sync');wrap(v.zorb,'skipLiquid','skip')
          for(const key of ['liquidKindAt','liquidHeightAt','liquidVerticalSpeedAt','liquidFlowAt']){
            const original=t[key],descriptor=Object.getOwnPropertyDescriptor(t,key)
            if(typeof original!=='function')throw new Error(`Missing exact query ${key}`)
            const wrapper=function(...args){
              const call=skipInvocation
              let result,thrown
              try{result=Reflect.apply(original,this,args);return result}
              catch(e){thrown=describe(e);throw e}
              finally{if(call)safely(`query ${key}`,()=>{
                if(call.queries.length>=12){failCheckpoint('Query capacity exceeded');return}
                call.queries.push({key,callId:call.callId,tick:s.game.tick,x:args[0],z:args[1],result:key==='liquidFlowAt'?'[original object]':result,
                  out:key==='liquidFlowAt'?{x:args[2].x,z:args[2].z}:null,thrown})
              })}
            }
            Object.defineProperty(t,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:wrapper})
            binding.entries.push({object:t,key,descriptor,wrapper})
          }
        }
        verifyBinding()
      }catch(e){restoreBinding();throw e}
    }
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
        skips:v.zorb.skips,hops:v.zorb.hops,pulse:v.zorb.pulse,input:{...v.input},quality:s.game.quality.getQualityState(),landed:v.landedThisStep,impact:v.landingImpact,liquidState:{stuck:v.liquidState.stuck,heat:v.liquidState.heat}}
      if(previous&&previous.case===current&&row.skips>previous.skips)row.contact={count:row.skips-previous.skips,previousTick:previous.tick,previousVelocity:previous.velocity,previousOmega:previous.omega,previousTangentSpeed:previous.tangentSpeed,previousGap:previous.gap,previousTime:previous.time}
      if(rows.length>=24000){overflow=true;return}
      rows.push(row);previous=row
    }
    const observer={fixedUpdate(){verifyBinding();checkpointWorld('preWorld-afterControllers');sample('preWorld-afterControllers')},postPhysics(){verifyBinding();checkpointWorld('postPhysics');sample('postPhysics')}}
    s.game.add(observer)
    window.zorbProbe={
      begin(name){current=name;previous=null;bind()},end(){endCheckpoint();restoreBinding();current=null;previous=null},
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
      export(){return {liquid,rows,audio,overflow,phases,phaseOverflow,observationErrors,errorDrops,checkpoint,boundVehicle:binding?.vehicle.object.uuid??null,clock:'Unmodified app/network clock',surfaceQuery:'actual ProceduralTerrain'}} ,
      dispose(){endCheckpoint();restoreBinding();s.game.remove(observer,false);for(const f of restore)safely('restore audio',f);current=null}
    }
  },liquid)
}
async function observeCase(liquid,kind,mode,site) {
  const name=`${liquid}-${kind}-${mode}`, record={name,status:'incomplete',classification:'controlled placement, real app stepping',disposition:'review-required',productAccepted:false}
  report.cases.push(record);await save()
  record.start=await page.evaluate(({site,mode,name})=>{zorbProbe.begin(name);return zorbProbe.place(site,mode)},{site,mode,name})
  await page.screenshot({path:`${out}/${name}-start.png`,timeout:remaining(5000)})
  if(mode==='hop')await page.keyboard.press('Space')
  if(mode==='drive')await page.keyboard.down('w')
  try {
    const end=Date.now()+(mode==='repeat'?12000:mode==='drive'?6000:5000)
    while(Date.now()<end){await page.waitForTimeout(Math.min(500,remaining(500)));await persistPage()}
  }finally{if(mode==='drive')await page.keyboard.up('w')}
  const data=await page.evaluate(name=>{zorbProbe.end();return zorbProbe.export().rows.filter(r=>r.case===name)},name)
  record.endpointFrozen=true;record.behavior=behaviorSummary(data)
  await writeFile(`${out}/${name}.json`,JSON.stringify(data,null,2))
  record.finalFraming=await page.evaluate(()=>{
    const p=syn3h.player.object.position.clone().project(syn3h.game.camera)
    return {x:p.x,y:p.y,z:p.z,visible:Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>=-1&&p.z<=1}
  })
  await page.screenshot({path:`${out}/${name}-end.png`,timeout:remaining(5000)})
  record.behavior=behaviorSummary(data);await save()
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
  record.status='assertions-passed-review-pending';await save()
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
    const navigationURL=`${origin}?room=zorb-${liquid}-${Date.now()}`
    const navigation=await page.goto(navigationURL,{timeout:remaining(45000),waitUntil:'domcontentloaded'})
    assert.ok(navigation,'main-frame navigation response required');assert.equal(navigation.url(),navigationURL)
    assert.equal(navigation.request().frame(),page.mainFrame());assert.ok(navigation.request().isNavigationRequest())
    report.navigation[liquid]={requestedURL:navigationURL,responseURL:navigation.url(),status:navigation.status()}
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
    await page.evaluate(()=>zorbProbe.dispose());await persistPage();await context.close();page=undefined
  }
}catch(e){report.failure=String(e.stack??e);try{await persistPage()}catch(partial){report.cleanupErrors.push(`partial: ${partial}`)}}
finally {
  cleanup=true
  if(page&&!page.isClosed())try{await bounded(page.evaluate(()=>window.zorbProbe?.dispose()),5000,'probe restoration');await persistPage()}catch(e){report.cleanupErrors.push(`probe restoration: ${e.stack??e}`)}
  for(const c of contexts)try{await bounded(c.close(),5000,'context close')}catch(e){report.cleanupErrors.push(String(e))}
  if(browser)try{await bounded(browser.close(),10000,'browser close')}catch(e){report.cleanupErrors.push(String(e))}
  try {
    // Producer is closed. Drain dynamically because body handlers can append errors.
    let cursor=0;while(cursor<pending.length){const batch=pending.slice(cursor);cursor=pending.length;await bounded(Promise.all(batch),10000,'body drain')}
    assert.ok(!browser||disconnected,'browser disconnect required')
    for(const label of ['water','lava']) {
      const navigation=report.navigation[label]
      assert.ok(navigation,`${label} navigation receipt required`)
      assert.ok(report.responses.some(r=>r.label===label&&r.url===navigation.responseURL&&r.resourceType==='document'&&r.navigationRequest&&r.mainFrame&&r.documentVerified&&r.bytes>0&&!r.error),`${label} verified main-frame document required independently of modules`)
    }
    for(const label of ['water','lava'])for(const path of required){
      assert.ok(report.responses.some(r=>r.label===label&&r.path===path&&r.sourceSha256&&!r.error),`actual source missing ${label}/${path}`)
      assert.ok(report.parsedScripts.some(r=>r.label===label&&new URL(r.url).pathname===`/${path}`),`parsed module missing ${label}/${path}`)
    }
    assert.deepEqual(report.errors,[]);report.after=await pins();assert.deepEqual(report.after,report.before)
    assert.equal(report.cases.length,16,'all planned cases required; interrupted cases are not a full matrix')
    assert.ok(report.cases.filter(c=>c.name.startsWith('water-')).some(c=>c.anchorHeightRange?.[1]>c.anchorHeightRange?.[0]),'actual water wave evolution required')
    report.captureComplete=!report.failure&&!report.cleanupErrors.length&&!report.errors.length
    report.disposition='review-required';report.productAccepted=false // Capture completeness is not owner-behavior acceptance.
  }catch(e){report.cleanupErrors.push(String(e.stack??e))}
  await save()
}
if(report.failure||report.cleanupErrors.length||!report.captureComplete)process.exitCode=1
