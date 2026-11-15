import{chromium}from'playwright-core';import assert from'node:assert/strict';import{writeFile}from'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});try{
 const p=await browser.newPage();await p.goto('http://127.0.0.1:5187/');await p.waitForFunction(()=>window.syn3h?.audio,null,{timeout:60000});await p.keyboard.press('h');await p.evaluate(()=>syn3h.audio.ready())
 const result=await p.evaluate(()=>{const {audio,game,terrain}=syn3h,cues=[],impacts=[];audio.cue=(name)=>cues.push(name);audio.impact=(strength)=>impacts.push(strength);audio.enabled=true
 const v={kind:'buggy-syn3h',object:{position:game.camera.position.clone().set(0,10,0)},body:{linvel:()=>({x:20,y:0,z:0})},input:{y:1,z:0},wheelsGrounded:0,wingsOpen:false,landedThisStep:false,landingImpact:12,getWheelEffects:()=>[{grounded:true,slip:8}]}
 audio.setPlayer(v,{...terrain,heightAt:()=>0,liquidKindAt:()=> 'lava',liquidHeightAt:()=>0});audio.update();v.wingsOpen=true;audio.update();audio.update();v.wingsOpen=false;v.landedThisStep=true;audio.fixedUpdate();v.landedThisStep=false;audio.fixedUpdate();audio.update();v.object.position.y=0;audio.update();audio.update();return{cues,impacts,motion:audio.motion}
 });assert.deepEqual(result.cues,['deploy','retract','lava']);assert.deepEqual(result.impacts,[12]);assert.equal(result.motion.slip,8);await writeFile('tests/audio/artifacts/vehicle-events.json',JSON.stringify(result,null,2));console.log(result)
}finally{await browser.close()}
