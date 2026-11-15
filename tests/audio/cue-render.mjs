import{chromium}from'playwright-core';import{writeFile}from'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5187/');
 const result=await page.evaluate(async()=>{
 const {synthCue}=await import('/src/audio/Cues.ts'),{noiseBuffer}=await import('/src/audio/Engine.ts'),names=['capture','contested','lost','win','tick','tag','join','leave','click','deploy','retract','lava'];const rate=44100,ctx=new OfflineAudioContext(1,rate*names.length*2,rate),noise=noiseBuffer(ctx)
 synthCue(ctx,ctx.destination,names[0],noise)
 const tasks=names.slice(1).map((name,i)=>ctx.suspend((i+1)*2).then(()=>{synthCue(ctx,ctx.destination,name,noise);return ctx.resume()}));const buffer=await ctx.startRendering();await Promise.all(tasks);const data=buffer.getChannelData(0),bytes=new ArrayBuffer(44+data.length*2),v=new DataView(bytes),str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+data.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,data.length*2,true);let peak=0,sum=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];v.setInt16(44+i*2,Math.max(-1,Math.min(1,data[i]))*32767,true)}return{names,peak,rms:Math.sqrt(sum/data.length),wav:Array.from(new Uint8Array(bytes))}
 });await writeFile('tests/audio/artifacts/game-cues.wav',Buffer.from(result.wav));delete result.wav;await writeFile('tests/audio/artifacts/cue-levels.json',JSON.stringify(result,null,2));console.log(result)
}finally{await browser.close()}
