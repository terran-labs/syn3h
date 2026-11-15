/** Raw acceptance matrix, separate from recommendation eligibility. Run through absolute heavy. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
export const MATRIX_SCENES = ['lobby', 'spawn', 'water', 'mixedbots', 'twohumans']
export const MATRIX_TIERS = [0, 1, 2]
export const DRIVE_SECONDS = 60

/** Invalid/hidden observations stay in the artifact and prevent an unqualified gate pass. */
export function summarizeFrames(frames) {
  const valid = frames.filter(f => Number.isFinite(f.frameMs) && f.frameMs > 0)
  const sorted = valid.map(f => f.frameMs).sort((a,b) => a-b)
  const at = q => sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))] ?? null
  const over2x = valid.filter(f => f.frameMs > 2*f.targetBudgetMs).length
  return { frames:frames.length, invalid:frames.length-valid.length, hidden:frames.filter(f=>f.hidden).length,
    p50:at(.5),p99:at(.99),max:sorted.at(-1)??null,over1000:valid.filter(f=>f.frameMs>1000).length,over2x,
    noFrameOver2x:frames.length>0&&valid.length===frames.length&&frames.every(f=>!f.hidden&&Number.isFinite(f.targetBudgetMs)&&f.targetBudgetMs>0)&&over2x===0 }
}

/** Injected before application modules; Object.assign(window,{syn3h}) occurs before game.start. */
export function installRawCollector() {
  const raw={frames:[],phase:'startup',events:[],initial:null,overflow:false}
  window.performanceMatrix=raw
  let value
  Object.defineProperty(window,'syn3h',{configurable:true,get:()=>value,set:s=>{
    value=s
    const g=s.game,q=g.quality,r=g.renderer,b=r.backend,device=b.device,info=device?.adapterInfo
    const settings=()=>({level:q.governor.level,rung:q.governor.rung,auto:q.governor.auto,levelPinned:q.governor.levelPinned,settings:{...q.governor.settings},targetMs:q.governor.targetMs})
    raw.initial={at:performance.now(),firstFrameMs:g.performance.firstFrameMs,deviceLevel:q.deviceLevel,adapterProbe:q.adapterProbe,quality:settings(),backend:g.backend,
      hardware:{userAgent:navigator.userAgent,touchPoints:navigator.maxTouchPoints,memoryGB:navigator.deviceMemory??null,adapter:info?{vendor:info.vendor,architecture:info.architecture,description:info.description}:null,maxTextureSize:device?.limits.maxTextureDimension2D??null},
      viewport:[innerWidth,innerHeight],buffer:[g.canvas.width,g.canvas.height],devicePixelRatio,storage:{level:sessionStorage.getItem('syn3h.graphics.level'),manual:sessionStorage.getItem('syn3h.graphics.manual')}}
    let renderCpuMs=0,pipelineMs=0,pipelines=0,uploads=0,uploadCpuMs=0
    const wrap=(object,key,done)=>{if(typeof object?.[key]!=='function')return;const original=object[key].bind(object);object[key]=(...args)=>{const t=performance.now();try{return original(...args)}finally{done(performance.now()-t)}}}
    wrap(g.postChain??r,'render',ms=>renderCpuMs+=ms)
    wrap(b,'createRenderPipeline',ms=>{pipelineMs+=ms;pipelines++})
    // Existing backend method only. Counts CPU submission calls, not GPU transfer completion.
    wrap(b,'updateTexture',ms=>{uploadCpuMs+=ms;uploads++})
    const original=q.frame.bind(q)
    q.frame=(m,judge)=>{
      const before=performance.now(),effective=settings()
      const row={...m,at:before,phase:raw.phase,hidden:document.hidden,judge,quality:effective,targetBudgetMs:effective.targetMs,renderCpuMs,pipelineMs,pipelines,uploads,uploadCpuMs,
        camera:{...g.camera.position},waterDepth:s.terrain.liquidKindAt?.(g.camera.position.x,g.camera.position.z)==='water'?s.terrain.liquidHeightAt(g.camera.position.x,g.camera.position.z)-g.camera.position.y:null,sceneNodes:{fog:g.scene.fogNode?.uuid??null,background:g.scene.backgroundNode?.uuid??null,environment:g.scene.environmentNode?.uuid??null},position:{...s.player.body.translation()},bots:s.bots.vehicles.length,remotes:window.syn3hNet?.remotes.size??0}
      original(m,judge);row.telemetryMs=performance.now()-before
      if(raw.frames.length<100000)raw.frames.push(row);else raw.overflow=true
      renderCpuMs=pipelineMs=pipelines=uploads=uploadCpuMs=0
      if(raw.phase==='crossings'&&raw.crossing){
        const c=raw.crossing,index=Math.floor((performance.now()-c.start)/5000),above=index%2===0
        const surface=s.terrain.liquidHeightAt(c.x,c.z),position=g.camera.position.clone().set(c.x,surface+(above?3:-3),c.z)
        s.camera.setCinematicPose(position,position.clone().add({x:0,y:0,z:-15}))
        if(index!==c.index){c.index=index;raw.events.push({type:'requested-water-crossing',at:performance.now(),above,index})}
      }
      if(raw.phase==='measurement'&&raw.drive){
        const elapsed=(performance.now()-raw.driveStart)/1000
        g.input.external.y=.65;g.input.external.x=.18*Math.sin(elapsed*Math.PI/10)
      }
    }
    raw.settings=settings
  }})
  document.addEventListener('visibilitychange',()=>raw.events.push({at:performance.now(),type:'visibility',hidden:document.hidden}))
}

async function main() {
  const {chromium}=await import('playwright-core'),{createServer:createVite}=await import('vite'),{createServer}=await import('node:net')
  const {spawn,execFileSync}=await import('node:child_process'),{mkdir,writeFile,appendFile}=await import('node:fs/promises'),{loadavg}=await import('node:os')
  const out=process.argv[2];assert.ok(out,'Unique output directory required');await mkdir(out)
  const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const scenes=process.env.PERFORMANCE_SCENES?.split(',')??MATRIX_SCENES,tiers=process.env.PERFORMANCE_TIERS?.split(',').map(Number)??MATRIX_TIERS
  assert.ok(scenes.every(s=>MATRIX_SCENES.includes(s))&&tiers.every(t=>MATRIX_TIERS.includes(t)))
  const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})
  const roomPort=await freePort(),port=await freePort(),origin=`http://127.0.0.1:${port}`
  process.env.SYN3H_NO_ROOM_SERVER='1';process.env.VITE_SERVER_URL=`ws://127.0.0.1:${port}`
  const room=spawn(process.execPath,['--import','tsx','server/dev.ts'],{env:{...process.env,PORT:String(roomPort)},stdio:['ignore','pipe','pipe']})
  let roomLog='';room.stdout.on('data',x=>roomLog+=x);room.stderr.on('data',x=>roomLog+=x)
  let vite,browser;const results=[],errors=[]
  const pause=ms=>new Promise(r=>setTimeout(r,ms))
  try {
    for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${roomPort}/status`)).ok)break}catch{}if(i===99)throw Error('Room startup timeout');await pause(100)}
    vite=await createVite({server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${roomPort}`,ws:true},'/presence':{target:`http://127.0.0.1:${roomPort}`}}}});await vite.listen()
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
    for(const tier of tiers)for(const scene of scenes){
      const id=`${scene}-tier${tier}`,context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1}),roomName=`perf${Date.now()}`
      const host=await context.newPage(),cdp=await context.newCDPSession(host),cellErrors=[]
      let tracing=false,guest=null
      try{
        await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',categories:'devtools.timeline,v8,blink.user_timing,gpu,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,disabled-by-default-v8.gc,disabled-by-default-v8.cpu_profiler'})
        tracing=true
        const open=async(page,name)=>{
          page.on('pageerror',e=>cellErrors.push({at:Date.now(),type:'page',message:e.message}))
          page.on('console',m=>{if(m.type()==='error')cellErrors.push({at:Date.now(),type:'console',message:m.text()})})
          page.on('websocket',ws=>{if(ws.url().includes('/ws?'))assert.ok(ws.url().startsWith(`ws://127.0.0.1:${port}/ws?`),'isolated endpoint')})
          await page.addInitScript(installRawCollector)
          await page.goto(`${origin}/?room=${roomName}&name=${name}`)
          await page.waitForFunction(()=>window.syn3h?.shell,null,{timeout:90000})
        }
        const play=async page=>{await page.locator('.galaxy-label.is-current').press('Enter');await page.waitForFunction(()=>window.syn3h.shell.playing&&window.syn3hNet?.connected,null,{timeout:90000})}
        await open(host,'PerfHost')
        // Every cell starts with fresh storage and automatic detection before explicit tier choice.
        await host.evaluate(tier=>{const s=window.syn3h,p=window.performanceMatrix;p.phase='transition';p.events.push({at:performance.now(),type:'manual-tier',tier});s.params.set('gfx.auto',false);s.params.set('gfx.level',tier)},tier)
        if(scene!=='lobby'){
          await play(host)
          await host.evaluate(async scene=>{
            const s=window.syn3h,p=window.performanceMatrix;p.events.push({at:performance.now(),type:'world-change',scene})
            const {applyPlanet}=await import('/src/world/planets.ts');applyPlanet(scene==='water'?'archipelago':'volcanic',49731)
            s.params.set('bots.count',scene==='mixedbots'||scene==='twohumans'?4:0)
            if(scene==='water'){
              const t=s.terrain
              for(let z=-600;z<=600;z+=20)for(let x=-600;x<=600;x+=20){
                if(t.liquidKindAt(x,z)!==null)continue
                for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
                  if(t.liquidKindAt(x+dx*35,z+dz*35)!=='water')continue
                  const h=t.heightAt(x,z);if(h-t.liquidHeightAt(x+dx*35,z+dz*35)>12)continue
                  s.player.teleport({x,y:h+2,z},Math.atan2(dx,-dz));return
                }
              }
              throw Error('No dry shore viewpoint')
            }
          },scene)
          if(scene==='twohumans'){guest=await context.newPage();await open(guest,'PerfGuest');await guest.evaluate(tier=>{window.syn3h.params.set('gfx.auto',false);window.syn3h.params.set('gfx.level',tier)},tier);await play(guest);await host.bringToFront()}
        }
        await host.evaluate(()=>window.performanceMatrix.phase='warmup');await host.waitForTimeout(5000)
        await host.evaluate(drive=>{const p=window.performanceMatrix;p.phase='measurement';p.drive=drive;p.driveStart=performance.now()},scene!=='lobby')
        await host.waitForTimeout(DRIVE_SECONDS*1000)
        await host.evaluate(()=>{window.performanceMatrix.drive=false;window.performanceMatrix.phase='after';window.syn3h.game.input.external.y=0;window.syn3h.game.input.external.x=0})
        if(scene==='water'){
          await host.evaluate(()=>{
            const s=window.syn3h,t=s.terrain,p=window.performanceMatrix
            for(let z=-600;z<=600;z+=20)for(let x=-600;x<=600;x+=20){
              if(t.liquidKindAt(x,z)==='water'&&t.liquidHeightAt(x,z)-t.heightAt(x,z)>8){
                p.crossing={x,z,start:performance.now(),index:-1};p.phase='crossings';return
              }
            }
            throw Error('No sufficiently deep water for camera crossing fixture')
          })
          await host.waitForTimeout(30000)
          await host.evaluate(()=>{window.performanceMatrix.phase='after';window.syn3h.camera.clearCinematicPose()})
        }
        await host.screenshot({path:`${out}/${id}.png`})
      }catch(error){cellErrors.push({type:'harness',message:String(error)})}
      finally{
        const raw=await host.evaluate(()=>{const s=window.syn3h,p=window.performanceMatrix;return p?{...p,settings:undefined,final:s?{quality:p.settings(),memory:{...s.game.renderer.info.memory},startup:window.syn3hStartup}:null}:null}).catch(()=>null)
        const guestRaw=guest?await guest.evaluate(()=>{const p=window.performanceMatrix;return p?{...p,settings:undefined}:null}).catch(()=>null):null
        await writeFile(`${out}/${id}.raw.json`,JSON.stringify({raw,guestRaw},null,2))
        if(tracing){
          const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await done
          let bytes=0
          try{while(true){const part=await cdp.send('IO.read',{handle:stream,size:1048576});const buffer=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');bytes+=buffer.length;await appendFile(`${out}/${id}.trace.json`,buffer);if(bytes>512*1024*1024)throw Error('Trace exceeds512MiB; matrix aborted');if(part.eof)break}}finally{await cdp.send('IO.close',{handle:stream})}
        }
        const phases={};for(const phase of ['startup','transition','warmup','measurement','crossings','after'])phases[phase]=summarizeFrames(raw?.frames.filter(f=>f.phase===phase)??[])
        const crossingSigns=(raw?.frames??[]).filter(f=>f.phase==='crossings'&&Number.isFinite(f.waterDepth)&&Math.abs(f.waterDepth)>.5).map(f=>Math.sign(f.waterDepth))
        const crossingChanges=crossingSigns.reduce((n,s,i)=>n+(i>0&&s!==crossingSigns[i-1]?1:0),0)
        const crossingCoverage=scene!=='water'||(crossingSigns.includes(1)&&crossingSigns.includes(-1)&&crossingChanges>=5)
        const row={id,scene,tier,source,raw,guestRaw,phases,crossingChanges,crossingCoverage,errors:cellErrors,load:loadavg(),gate:!!raw&&!raw.overflow&&crossingCoverage&&cellErrors.length===0&&phases.measurement.noFrameOver2x&&(scene!=='water'||phases.crossings.noFrameOver2x)}
        results.push({...row,raw:undefined,guestRaw:undefined});await writeFile(`${out}/${id}.json`,JSON.stringify(row,null,2));console.log(JSON.stringify({...row,raw:undefined,guestRaw:undefined}))
        errors.push(...cellErrors);await context.close()
      }
      if(cellErrors.length)throw Error(`Rendering/setup failure in ${id}; remaining cells not run`)
    }
  }finally{
    await writeFile(`${out}/results.json`,JSON.stringify({source,scenes,tiers,driveSeconds:DRIVE_SECONDS,results,errors,roomLog,limitations:'Instrumented shared-host desktop; CPU submission is not GPU execution; manual tier cells do not validate weak hardware.'},null,2))
    await browser?.close();await vite?.close();room.kill('SIGTERM')
  }
  // Keep the full matrix even when a frame budget fails. Exit distinguishes evidence from acceptance.
  if(results.some(r=>!r.gate))process.exitCode=2
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
