/** Sequential headed phone emulation. No physical-phone performance claim.
 * node tools/phone-soak.mjs [output directory] [probe]
 * Four 5-minute cases, then 15 minutes repeating the slowest case. Probe uses 20s/30s.
 * Owns port 5186 and a random loopback room port. Closes all resources on exit.
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serveStable } from './serve-stable.mjs';
const run=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const output=process.argv[2]??'/tmp/syn3h-phone-soak',probe=process.argv[3]==='probe';
const iphone={width:390,height:844,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',memory:4};
const android={width:412,height:915,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',memory:4};
const cases=[{id:'iphone-auto-4x',device:iphone,cpu:4},{id:'android-auto-6x',device:android,cpu:6},{id:'iphone-safe-4x',device:iphone,cpu:4,level:0},{id:'android-webgl-6x',device:android,cpu:6,webgl:true}];
const results=[];let browser,vite,room;
const percentile=(a,p)=>{const v=a.slice().sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*p))]??null;};
await mkdir(output,{recursive:true});
try {
  process.env.MIRA_NO_ROOM_SERVER='1';
  room=await serveStable({dir:process.cwd(),port:0});
  vite=await createServer({define:{'import.meta.env.VITE_SERVER_URL':JSON.stringify('ws://127.0.0.1:5186')},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}});await vite.listen();
  if(!probe){const gate=await run(process.execPath,['tools/smoke.mjs','http://127.0.0.1:5186/',`${output}/gate.png`],{maxBuffer:1e6});await writeFile(`${output}/smoke.log`,gate.stdout+gate.stderr);console.log('SMOKE OK before soak');}
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--enable-precise-memory-info']});
  const browserCDP=await browser.newBrowserCDPSession();
  const hostGPU=await browserCDP.send('SystemInfo.getInfo');await writeFile(`${output}/host-gpu.json`,JSON.stringify(hostGPU,null,2));
  async function one(config,duration){
    const {id,device,cpu,level,webgl}=config;
    console.log('START',id,new Date().toISOString(),'duration',duration,'load',loadavg());
    const result={id,config,durationSeconds:duration,started:new Date().toISOString(),loadStart:loadavg(),samples:[],errors:[],touch:[],frames:[]};
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:device.userAgent});
    await context.addInitScript(({memory,webgl,level})=>{
      Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});
      if(webgl)Object.defineProperty(navigator,'gpu',{get:()=>undefined});
      if(level!==undefined)sessionStorage.setItem('mira.graphics.level',String(level));
      const resources=[];
      const observe=(prototype,name,estimate)=>{if(!prototype)return;const original=prototype[name];prototype[name]=function(desc){const resource=original.call(this,desc),record={ref:new WeakRef(resource),kind:name,bytes:estimate(desc),dead:false};resources.push(record);const destroy=resource.destroy.bind(resource);resource.destroy=()=>{record.dead=true;return destroy();};return resource;};};
      observe(globalThis.GPUDevice?.prototype,'createBuffer',d=>d.size);
      observe(globalThis.GPUDevice?.prototype,'createTexture',d=>{const size=Array.isArray(d.size)?d.size:[d.size.width,d.size.height??1,d.size.depthOrArrayLayers??1];const bytes=({r8unorm:1,rg8unorm:2,rgba8unorm:4,'rgba8unorm-srgb':4,bgra8unorm:4,'bgra8unorm-srgb':4,rgba16float:8,rgba32float:16,r16float:2,rg16float:4,depth24plus:4,'depth24plus-stencil8':4,depth32float:4})[d.format];if(!bytes)return null;let total=0;for(let m=0;m<(d.mipLevelCount??1);m++)total+=Math.max(1,size[0]>>m)*Math.max(1,(size[1]??1)>>m)*(size[2]??1)*bytes*(d.sampleCount??1);return total;});
      window.soakResources=()=>{let textures=0,buffers=0,unknown=0,live=0;for(let i=resources.length-1;i>=0;i--){const r=resources[i];if(r.dead||!r.ref.deref()){resources.splice(i,1);continue;}live++;if(r.bytes===null)unknown++;else if(r.kind==='createTexture')textures+=r.bytes;else buffers+=r.bytes;}return{textureBytesEstimated:textures,bufferBytesRequested:buffers,unknownFormats:unknown,liveResources:live,totalGpuMemoryBytes:null};};
    },{memory:device.memory,webgl,level});
    const page=await context.newPage(),cdp=await context.newCDPSession(page),nodes=new Map();
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});await cdp.send('Performance.enable');
    await cdp.send('WebAudio.enable');cdp.on('WebAudio.audioNodeCreated',({node})=>nodes.set(node.nodeId,node.nodeType));cdp.on('WebAudio.audioNodeWillBeDestroyed',({nodeId})=>nodes.delete(nodeId));
    page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});page.on('crash',()=>result.errors.push('PAGE CRASH'));
    try {
      const roomName=`phone-${id}-${Date.now()}`;const started=Date.now();
      await page.goto(`http://127.0.0.1:5186/?room=${roomName}&seed=42`,{waitUntil:'domcontentloaded',timeout:180000});
      await page.waitForFunction(()=>window.mira?.game.tick>2,null,{timeout:180000});
      await page.locator('[data-panel=index] [data-goto=explore]').tap({timeout:60000});
      await page.locator('#shell-name').fill('Phone QA');
      result.timeToInteractiveMs=Date.now()-started;
      await page.screenshot({path:`${output}/${id}-lobby.png`});
      await page.locator('.shell-play').tap();await page.waitForFunction(()=>window.miraNet?.connected,null,{timeout:60000});
      result.joinedMs=Date.now()-started;
      result.initial=await page.evaluate(async()=>{const s=window.mira,g=s.game,r=g.renderer;window.soakFrames=[];const frame=g.quality.frame.bind(g.quality);g.quality.frame=m=>{window.soakFrames.push([m.frameMs,m.physicsMs,m.drawCalls,m.triangles]);frame(m);};const a=await navigator.gpu?.requestAdapter();return{quality:s.params.get('gfx.level').value,backend:g.backend,adapter:a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,isFallbackAdapter:a.info.isFallbackAdapter}:null,deviceMemory:navigator.deviceMemory,dpr:devicePixelRatio,buffer:[r.domElement.width,r.domElement.height],loadingFlag:sessionStorage.getItem('mira.loading.level'),p:s.player.getState().p};});
      const touchAudit=()=>page.evaluate(()=>[...document.querySelectorAll('.touch-stick,.touch-actions button,.hud-navigation button')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden'&&!e.hidden).map(e=>{const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:e.textContent.trim(),rect:{x:r.x,y:r.y,w:r.width,h:r.height},inViewport:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,reachable:e===top||e.contains(top),overlaps:[...document.querySelectorAll('.shell-minimap,.shell-hud,.hud-navigation,.shell-touchdown-help')].filter(x=>!x.hidden).filter(x=>{const b=x.getBoundingClientRect();return b.width&&r.x<b.right&&r.right>b.x&&r.y<b.bottom&&r.bottom>b.y;}).map(x=>x.className)};}));
      result.touch.push({phase:'drive',controls:await touchAudit()});
      result.buttons=[];
      for(const action of ['special','brakes','fire']) {
        const button=page.locator(`.touch-actions [data-action=${action}]`),box=await button.boundingBox();
        if(!box){result.buttons.push({action,missing:true});continue;}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:2}]});await sleep(250);
        result.buttons.push({action,state:await page.evaluate(()=>({special:window.mira.game.input.state.special,external:{...window.mira.game.input.external}}))});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        if(action==='special')await button.tap();
      }
      await page.locator('.shell-menu-button').tap();
      result.menuOpened=await page.evaluate(()=>window.mira.shell.menuOpen);
      await page.locator('[data-resume]').tap();
      const stick=await page.locator('.touch-stick').boundingBox();
      if(!stick)throw Error('Touch joystick unavailable');
      const point=(phase)=>({x:stick.x+stick.width*.5+Math.sin(phase)*stick.width*.18,y:stick.y+stick.height*.21,id:1,radiusX:5,radiusY:5,force:1});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0)]});
      const start=Date.now();let hill=false,lastShot=0,lastSample=0,lastLog=0;
      while(Date.now()-start<duration*1000){
        const elapsed=(Date.now()-start)/1000;
        if(!hill&&elapsed>duration*.35){
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await page.evaluate(()=>{const s=window.mira;s.params.set('game.mode',1);s.params.set('bots.count',4);const summit=s.terrain.summit?.();if(summit){const p=s.player.object.position.clone();p.set(summit.x+summit.rimRadius,0,summit.z);p.y=s.terrain.heightAt(p.x,p.z)+2;s.player.teleport(p,0);}});
          hill=true;result.touch.push({phase:'hill',controls:await touchAudit()});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(elapsed*.15)]});
        }
        // Real touch events feed the shipped joystick; never assign vehicle.input directly.
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(elapsed*.15)]});
        if(elapsed-lastSample>=10||lastSample===0){
          const snapshot=await page.evaluate(()=>{const s=window.mira,r=s.game.renderer;return{time:performance.now(),heap:performance.memory?.usedJSHeapSize,heapTotal:performance.memory?.totalJSHeapSize,resources:window.soakResources(),renderer:r.info.memory,audio:s.audio.diagnostics,quality:s.params.get('gfx.level').value,bots:s.bots.vehicles.length,mode:s.params.get('game.mode').value,loadingFlag:sessionStorage.getItem('mira.loading.level'),position:s.player.getState().p,frames:window.soakFrames.splice(0),input:{...s.game.input.external}};});
          result.frames.push(...snapshot.frames);delete snapshot.frames;snapshot.audioNativeNodes=nodes.size;snapshot.elapsed=elapsed;result.samples.push(snapshot);lastSample=elapsed;
          await writeFile(`${output}/${id}.json`,JSON.stringify(result));
        }
        if(elapsed-lastShot>=60||lastShot===0){await page.screenshot({path:`${output}/${id}-${Math.round(elapsed)}s.png`});lastShot=elapsed;}
        if(elapsed-lastLog>=30){console.log('PROGRESS',id,Math.round(elapsed),'s',JSON.stringify(result.samples.at(-1)));lastLog=elapsed;}
        await sleep(1000);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      result.final=await page.evaluate(()=>{const s=window.mira;return{p:s.player.getState().p,quality:s.params.get('gfx.level').value,bots:s.bots.vehicles.length,loadingFlag:sessionStorage.getItem('mira.loading.level')};});
      result.frameMedian=percentile(result.frames.map(x=>x[0]),.5);result.frameP95=percentile(result.frames.map(x=>x[0]),.95);result.elapsedSeconds=(Date.now()-start)/1000;
      await page.screenshot({path:`${output}/${id}-final.png`});
      await page.setViewportSize({width:device.height,height:device.width});await sleep(750);
      result.touch.push({phase:'landscape',controls:await touchAudit()});
      await page.screenshot({path:`${output}/${id}-landscape.png`});
    } catch(e){result.failure=String(e);await page.screenshot({path:`${output}/${id}-failure.png`}).catch(()=>{});}
    finally{result.loadEnd=loadavg();await context.close();await writeFile(`${output}/${id}.json`,JSON.stringify(result,null,2));}
    console.log('DONE',id,JSON.stringify({median:result.frameMedian,p95:result.frameP95,failure:result.failure,errors:result.errors}));results.push(result);await writeFile(`${output}/summary.json`,JSON.stringify(results.map(({frames,...r})=>r),null,2));return result;
  }
  for(const config of cases)await one(config,probe?20:300);
  const heaviest=results.filter(r=>!r.failure).sort((a,b)=>b.frameP95-a.frameP95)[0];
  if(heaviest)await one({...heaviest.config,id:heaviest.id+'-long'},probe?30:900);
} finally {await browser?.close();await vite?.close();await room?.close();}
console.log('SOAK COMPLETE',output);
