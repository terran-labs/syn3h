/** tools/heavy.sh node tools/bot-removal-smoke.mjs */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { serveStable } from './serve-stable.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
process.env.SYN3H_NO_ROOM_SERVER='1';
const room=await serveStable({dir:process.cwd(),port:0});
const vite=await createServer({define:{'import.meta.env.VITE_SERVER_URL':JSON.stringify('ws://127.0.0.1:5186')},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}});
let browser, page; const errors=[];
try {
 await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
 page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5186/?autoplay=1&room=bot-removal-check');await page.waitForFunction(()=>window.syn3hNet?.connected,null,{timeout:90000});
 await page.evaluate(()=>{const s=window.syn3h;s.game.quality.frame=()=>{};s.params.set('gfx.level',2);s.params.set('bots.count',4);});
 await page.waitForFunction(()=>window.syn3h.bots.vehicles.length===4,null,{timeout:30000});
 await page.mouse.click(900,450);await page.waitForTimeout(25000);
 const audio=await page.evaluate(()=>window.syn3h.audio.diagnostics);
 console.log('Warmed audio',audio);assert.equal(audio.state,'running');assert.equal(audio.remoteVoices,4);
 const initial=await page.evaluate(()=>{const s=window.syn3h;return{tick:s.game.tick,bodies:s.game.world.bodies.len(),bots:s.bots.vehicles.length};});
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('bots.count',0);s.bots.update();s.params.set('bots.count',4);s.bots.update();});
 await page.waitForFunction(tick=>window.syn3h.game.tick>tick+50,initial.tick,{timeout:30000});
 const final=await page.evaluate(()=>{const s=window.syn3h;return{tick:s.game.tick,bodies:s.game.world.bodies.len(),bots:s.bots.vehicles.length,effects:s.game.scene.userData.vehicleEffects?.vehicles,p:s.player.getState().p};});
 assert.equal(final.bots,4);assert.equal(final.bodies,initial.bodies);assert.equal(final.effects,5);assert.deepEqual(errors,[]);
 console.log('PASS warmed voices with four bots removed and replaced in same turn',JSON.stringify({initial,final,errors}));
 await browser.close();browser=null;
 const smoke=await promisify(execFile)(process.execPath,['tools/smoke.mjs','http://127.0.0.1:5186/','/tmp/syn3h-bot-removal-gate.png'],{maxBuffer:1e6});console.log(smoke.stdout);
}catch(error){console.error('Browser diagnostics',JSON.stringify({errors,url:page?.url(),state:await page?.evaluate(()=>({fatal:document.querySelector('#fatal')?.textContent,hasGame:!!window.syn3h,net:window.syn3hNet?.connected,playing:window.syn3h?.shell.playing})).catch(()=>null)}));await page?.screenshot({path:'/tmp/syn3h-bot-removal-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();await vite.close();await room.close();}
