/** Tests proposed main.ts integration without changing it. Owns port 5186 for this run. */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { integrateResume } from './resume-integration.mjs';
import { manualReload } from './manual-reload.mjs';
import { serveStable } from './serve-stable.mjs';
import assert from 'node:assert/strict';
const roomServer = await serveStable({ dir: process.argv[2] ?? '/tmp/syn3h-stable-verify', port: 0 });
const port = roomServer.server.address().port;
const vite = await createServer({ configFile:false, plugins:[{name:'resume-test-integration',enforce:'pre',transform(code,id){if(id.endsWith('/src/main.ts'))return integrateResume(code);}},manualReload()],server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${port}`,ws:true}}} });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5186/?autoplay=1&room=resume-smoke&seed=42');
  await page.waitForFunction(()=>window.syn3hNet?.connected);
  const before=await page.evaluate(async()=>{
    const s=window.syn3h, spawn=s.terrain.spawnPoint(3);
    s.player.teleport(spawn.position.clone().add({x:0,y:8,z:0}),.7);
    s.player.body.setLinvel({x:3,y:1,z:2},true);
    s.player.setColors('#123456','#abcdef');
    s.params.set('camera.mode',2);s.params.set('world.gravity',4);
    s.game.input.state.special=true;
    // Save immediately at pagehide, as on a real refresh, without adding a test session.
    window.dispatchEvent(new Event('pagehide'));
    return JSON.parse(sessionStorage.getItem('syn3h.resume.v1'));
  });
  assert.ok(before); assert.equal(before.seed,42); assert.equal(before.world['world.gravity'],4);
  await page.reload(); await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('Resumed') || [...document.querySelectorAll('[role=status]')].some(x=>x.textContent.includes('Resumed')));
  const after=await page.evaluate(()=>{const s=window.syn3h;return{p:s.player.getState().p,colors:s.player.colors,special:s.game.input.state.special,mode:s.params.get('camera.mode').value,gravity:s.params.get('world.gravity').value};});
  assert.ok(Math.hypot(...after.p.map((n,i)=>n-before.p[i]))<5,JSON.stringify({before,after}));
  assert.equal(after.special,true);assert.equal(after.mode,2);assert.deepEqual(after.colors,before.colors);assert.equal(after.gravity,4);
  console.log('PASS real refresh restores pose, wings command, colors, camera and host parameter',JSON.stringify({before:before.p,after:after.p}));
  const marker=await page.evaluate(()=>window.resumePageIdentity=Date.now());
  vite.ws.send({type:'full-reload'});
  await page.waitForSelector('#syn3h-build-notice');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.resumePageIdentity),marker);
  console.log('PASS full reload event keeps the running game and displays notice');
  await page.screenshot({path:'/tmp/syn3h-resume-notice.png'});
  await Promise.all([page.waitForEvent('load'),page.click('#syn3h-build-notice')]);
  await page.waitForFunction(()=>window.syn3hNet?.connected);
  assert.equal(await page.evaluate(()=>window.resumePageIdentity),undefined);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS notice click reloads; zero page errors');
} finally {await browser?.close();await vite.close();await roomServer.close();}
