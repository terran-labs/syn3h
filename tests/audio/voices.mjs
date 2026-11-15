import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
await mkdir('tests/audio/artifacts',{recursive:true})
await writeFile('tests/audio/artifacts/listen.html',`<!doctype html><meta charset="utf-8"><title>Syn3h sound audition</title><style>body{background:#101722;color:white;font:18px sans-serif;max-width:720px;margin:40px auto}audio{width:100%}</style><h1>Syn3h sound audition</h1><p>Vehicle clips: idle, load and slip, flight, idle, fade out. Unmastered voices.</p>${['buggy-syn3h','buggy-classic','jet','hovercraft','tank','game-cues'].map(name=>`<h2>${name}</h2><audio controls preload="none" src="${name}.wav"></audio>`).join('')}<p>Cues, two seconds apart: capture, contested, lost, win, tick, tag, join, leave, click, deploy, retract, lava.</p>`)
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--js-flags=--expose-gc']})
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5187/');await page.waitForFunction(()=>window.syn3h?.audio)
 assert.equal(await page.evaluate(()=>syn3h.audio.state),'locked')
 await page.keyboard.press('h');await page.evaluate(()=>syn3h.audio.ready())
 const results=[]
 for(const kind of ['buggy-syn3h','buggy-classic','jet','hovercraft','tank']){
  const result=await page.evaluate(async kind=>{
   const {Engine}=await import('/src/audio/Engine.ts');const ctx=new OfflineAudioContext(1,44100*9,44100),engine=new Engine(ctx,ctx.destination)
   engine.update({kind,speed:0,throttle:0,airborne:false})
   const stages=[[2,{speed:35,throttle:1,airborne:false,slip:7}],[4,{speed:55,throttle:1,airborne:true,wings:true}],[6,{speed:0,throttle:0,airborne:false}]]
   const changes=stages.map(([time,state])=>ctx.suspend(time).then(()=>{engine.update({kind,...state});return ctx.resume()}))
   changes.push(ctx.suspend(7).then(()=>{engine.dispose();return ctx.resume()}))
   const buffer=await ctx.startRendering();await Promise.all(changes);const data=buffer.getChannelData(0)
   let peak=0,sum=0,step=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];if(i)step=Math.max(step,Math.abs(data[i]-data[i-1]))}
   const bytes=new ArrayBuffer(44+data.length*2),v=new DataView(bytes);const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)))
   str(0,'RIFF');v.setUint32(4,36+data.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,data.length*2,true);for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,data[i]))*32767,true)
   return {kind,peak,rms:Math.sqrt(sum/data.length),maxStep:step,first:data[0],loopStep:Math.abs(data[Math.round(2.92*44100)]-data[Math.round(2.92*44100)-1]),last:data[data.length-1],wav:Array.from(new Uint8Array(bytes))}
  },kind)
  const {wav,...stats}=result;assert.ok(stats.peak<.95&&stats.rms>.001);assert.equal(stats.last,0);assert.equal(stats.first,0);assert.ok(stats.loopStep<.03);await writeFile(`tests/audio/artifacts/${kind}.wav`,Buffer.from(wav));results.push(stats)
 }
 await writeFile('tests/audio/artifacts/voice-levels.json',JSON.stringify(results,null,2));console.log(results);assert.deepEqual(errors,[])
}finally{await browser.close()}
