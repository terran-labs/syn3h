import{chromium}from'playwright-core';import assert from'node:assert/strict';import{writeFile}from'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5187/');await page.waitForFunction(()=>window.mira?.audio,null,{timeout:60000});await page.keyboard.press('h');await page.evaluate(()=>mira.audio.ready())
 const r=await page.evaluate(async()=>{
  const {audio,shell}=mira,cues=[],original=audio.cue.bind(audio);audio.cue=(name,p)=>{cues.push(name);original(name,p)}
  const base={mode:'koth',holderName:null,holderIsYou:false,contested:false,scores:[],target:60,winner:null}
  shell.setMatchState(base);shell.setMatchState({...base,holderName:'Me',holderIsYou:true});shell.setMatchState({...base,holderName:'Me',holderIsYou:true});shell.setMatchState({...base,holderName:'Me',holderIsYou:true,contested:true});shell.setMatchState({...base,holderName:'Other'});shell.setMatchState({...base,winner:'Other',winnerColor:'#00aaff',nextRoundIn:2})
  await new Promise(r=>setTimeout(r,1200));shell.setMatchState(null)
  shell.setStatus(['Alex joined']);shell.setStatus(['Alex joined']);shell.setStatus(['Alex left']);shell.setStatus(['Alex tagged Sam']);shell.showPanel('music')
  const slider=document.querySelector('[data-audio-param="audio.engine"]');slider.value='.3';slider.dispatchEvent(new Event('input'))
  audio.setMuted(true);await new Promise(r=>setTimeout(r,400));const mutedGain=audio.master.gain.value;audio.setMuted(false)
  return {cues,mutedGain,engineVolume:mira.params.get('audio.engine').value,sliders:document.querySelectorAll('[data-audio-param]').length}
 });assert.equal(r.cues.filter(c=>c==='capture').length,1);for(const cue of ['contested','lost','win','tick','join','leave','tag','click'])assert.ok(r.cues.includes(cue));assert.equal(r.cues.filter(c=>c==='join').length,1);assert.ok(r.mutedGain<.0001);assert.equal(r.engineVolume,.3);assert.equal(r.sliders,8);await writeFile('tests/audio/artifacts/cues.json',JSON.stringify(r,null,2));console.log(r)
}finally{await browser.close()}
