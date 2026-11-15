/** Real automatic races on an isolated room, using ordinary entry and enabled defaults. */
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { serveStable } from './serve-stable.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const port=Number(process.env.QA_PORT??5199),out=process.argv[2]??'/tmp/syn3h-race-acceptance'
await mkdir(out,{recursive:true})
process.env.SYN3H_NO_ROOM_SERVER='1';process.env.VITE_SERVER_URL=`ws://127.0.0.1:${port}`
const room=await serveStable({dir:process.cwd(),port:0})
const vite=await createServer({server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}})
const browsers=[],errors=[],events=[],checks=[]
const check=(name,value,detail)=>{checks.push({name,pass:!!value,detail});console.log(value?'PASS':'FAIL',name,JSON.stringify(detail));assert.ok(value,name)}
const state=p=>p.evaluate(()=>{const n=window.syn3hNet,s=window.syn3h;return {id:n.id,host:n.isHost,connected:n.connected,race:n.race,own:s.bots.vehicles.length,remote:[...n.remotes.keys()].filter(id=>id>=0xff00).length,playing:s.shell.playing,hud:document.querySelector('.race-hud')?.textContent,visible:!!document.querySelector('.race-hud:not([hidden])'),defaults:Object.fromEntries(['bots.count','bots.fleet','daydream.seconds','game.rejoin','bungee.allowed','yoink.allowed','pester.allowed','laser.allowed'].map(id=>[id,s.params.get(id)?.value]))}})
async function open(label,key){
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});browsers.push(browser)
 const page=await browser.newPage({viewport:{width:960,height:640}})
 page.on('pageerror',e=>errors.push(`${label}: ${e.message}`))
 page.on('websocket',ws=>{if(!ws.url().includes('/ws?'))return;check(`${label} uses isolated endpoint`,ws.url().startsWith(`ws://127.0.0.1:${port}/ws?`));ws.on('framereceived',({payload})=>{if(typeof payload!=='string')return;try{const m=JSON.parse(payload);if(m.type==='race')events.push({label,at:Date.now(),race:m.race});}catch{}})})
 await page.goto(`http://127.0.0.1:${port}/?room=${key}&name=${label}`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.syn3h?.shell,null,{timeout:90000})
 return page
}
async function play(page){await page.locator('.galaxy-label.is-current').press('Enter',{timeout:15000});await page.waitForFunction(()=>window.syn3h.shell.playing&&window.syn3hNet?.connected,null,{timeout:90000})}
async function diagnostic(page) {
 return page.evaluate(()=>{
 const d=window.syn3h.bots.races, cs=d.hooks?.candidates()??[], t=d.terrain, n=d.navigator;
 const from=cs.find(c=>c.human)?.vehicle.body.translation();
 const delta=(x,y)=>t.wrapSize?((x-y+t.wrapSize*1.5)%t.wrapSize)-t.wrapSize/2:x-y;
 const profile={maxGrade:.45,liquid:'blocked',flies:false,roadCost:.35,cruiseAltitude:0};
 return {state:d.state,nextAt:d.nextAt,now:d.hooks?.now(),candidates:cs.map(c=>({id:c.id,active:c.active,human:c.human,kind:c.vehicle.kind,p:c.vehicle.body.translation()})),places:d.places().map(p=>({name:p.name,kind:p.kind,x:p.x,z:p.z,distance:from?Math.hypot(delta(p.x,from.x),delta(p.z,from.z)):null,safe:n.passable(p.x,p.z,profile)})),playing:window.syn3h.shell.playing};
 });
}
async function stageEncounter(page){
 // Arrange the encounter just before the ordinary eligibility scan, so tag behavior
 // cannot disperse the pair during the initial thirty-second race delay.
 await page.waitForFunction(()=>{const d=window.syn3h.bots.races;return d.hooks&&d.nextAt-d.hooks.now()<.5},null,{timeout:45000});
 const setup=await page.evaluate(async()=>{
  const b=window.syn3h.bots,d=b.races,t=d.terrain;
  const profile={maxGrade:.45,liquid:'blocked',flies:false,roadCost:.35,cruiseAltitude:0};
  const pad=d.places().find(p=>p.kind==='spawn');
  // Stage only bodies on real terrain. Timers, director, room and UI remain production code.
  for(let i=0;i<16;i++){
   const angle=Math.PI/2+i*Math.PI/8,x=pad.x+Math.cos(angle)*120,z=pad.z+Math.sin(angle)*120;
   if(!b.navigator.passable(x,z,profile)||!b.navigator.route({x,z},pad,profile)?.reached)continue;
   const ground=b.vehicles.find(v=>v.kind!=='hovercraft'&&v.kind!=='jet');if(!ground)throw Error('No ground bot');
   b.player.teleport({x,y:t.heightAt(x,z)+2,z},angle);
   ground.teleport({x:x+8,y:t.heightAt(x+8,z)+2,z},angle);
   return {x,z,landmark:pad.name,bot:ground.id};
  }
  throw Error('No dry reachable encounter near pad');
 });
 console.log('STAGED PHYSICS ENCOUNTER',JSON.stringify(setup));
}
async function waitRace(page){
 try{await page.waitForFunction(()=>['countdown','running'].includes(window.syn3hNet.race?.phase),null,{timeout:100000})}
 catch(e){console.log('RACE DIAGNOSTIC',JSON.stringify(await diagnostic(page)));throw e}
}
try{
 await vite.listen()
 const key=`raceqa${Date.now()}`
 const a=await open('Host',key),b=await open('Guest',key)
 check('lobby spectators do not start a race',await a.evaluate(()=>!window.syn3hNet?.race)&&await b.evaluate(()=>!window.syn3hNet?.race))
 await play(a);await play(b)
 await a.locator('.inspector-toggle').click();await a.locator('.exit-world').click();check('return to menu excludes host',!(await state(a)).playing);await a.keyboard.press('Escape');await a.waitForFunction(()=>window.syn3h.shell.playing);
 const defaults=await state(a);check('ordinary entry enables mixed bots and gear',defaults.defaults['bots.count']===4&&defaults.defaults['bots.fleet']===1&&defaults.defaults['daydream.seconds']===300&&['bungee.allowed','yoink.allowed','pester.allowed'].every(id=>defaults.defaults[id]===true),defaults.defaults)

 await stageEncounter(a);await waitRace(a)
 const start=await state(a);await b.waitForFunction(id=>window.syn3hNet.race?.id===id,start.race.id,{timeout:10000})
 await b.waitForFunction(()=>{const h=document.querySelector('.race-hud');return h&&!h.hidden&&h.textContent.includes('Watching')},null,{timeout:10000})
 const guest=await state(b)
 check('host and bots automatically enrolled',start.race.participants.some(p=>p.id===start.id)&&start.race.participants.filter(p=>p.id>=0xff00).length>=1,start.race)
 check('guest observes canonical race',!guest.race.participants.some(p=>p.id===guest.id)&&guest.visible&&guest.hud.includes('Watching'),guest)
 check('guest cannot leave or cancel',!(await b.getByRole('button',{name:'Leave race',exact:true}).isVisible())&&!(await b.getByRole('button',{name:'Cancel race',exact:true}).isVisible()))
 await a.screenshot({path:`${out}/host-race.png`});await b.screenshot({path:`${out}/guest-race.png`})
 await a.waitForFunction(()=>window.syn3hNet.race?.phase==='running',null,{timeout:15000})
 await a.waitForFunction(()=>['finished','cancelled'].includes(window.syn3hNet.race?.phase),null,{timeout:135000})
 const result=await state(a);await b.waitForFunction(p=>window.syn3hNet.race?.phase===p,result.race.phase,{timeout:5000})
 check('race reaches shared terminal result',(await state(b)).race.winnerId===result.race.winnerId,result.race)
 await a.screenshot({path:`${out}/result.png`})
 // Fresh room avoids shortening the production cooldown just to exercise dropout.
 const key2=`${key}hold`
 await a.goto(`http://127.0.0.1:${port}/?room=${key2}&name=Host`);await a.waitForFunction(()=>window.syn3h?.shell,null,{timeout:90000})
 await b.goto(`http://127.0.0.1:${port}/?room=${key2}&name=Guest`);await b.waitForFunction(()=>window.syn3h?.shell,null,{timeout:90000})
 await play(a);await play(b);await stageEncounter(a);await waitRace(a)
 const held=await state(a)
 await a.evaluate(()=>window.syn3hNet.conn.close())
 await a.waitForFunction(()=>!window.syn3hNet.connected&&window.syn3h.bots.vehicles.length===0,null,{timeout:10000})
 await b.waitForFunction(()=>[...window.syn3hNet.remotes.keys()].every(id=>id<0xff00)&&window.syn3hNet.race?.phase==='cancelled',null,{timeout:10000})
 check('dropout clears bots and cancels guest race',true,await state(b))
 await a.evaluate(()=>window.syn3hNet.conn.open())
 await a.waitForFunction(id=>window.syn3hNet.connected&&window.syn3hNet.id===id&&window.syn3hNet.isHost&&window.syn3h.bots.vehicles.length>0,held.id,{timeout:15000})
 await b.waitForFunction(()=>[...window.syn3hNet.remotes.keys()].some(id=>id>=0xff00),null,{timeout:10000})
 check('return restores host and bots without reviving race',!['countdown','running'].includes((await state(a)).race?.phase),await state(a))
 await a.evaluate(()=>window.syn3hNet.conn.close())
 await b.waitForFunction(()=>window.syn3hNet.isHost&&window.syn3h.bots.vehicles.length>0,null,{timeout:45000})
 check('expired hold transfers host and restores bots',true,await state(b))
 check('no page errors',errors.length===0,errors)
 console.log('RACE ACCEPTANCE OK')
}catch(e){console.error(e);process.exitCode=1;for(let i=0;i<browsers.length;i++){const p=browsers[i].contexts()[0]?.pages()[0];if(!p)continue;await p.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});console.log('FAILURE PAGE',i,await p.locator('body').innerText().catch(()=>''));}}

finally{await writeFile(`${out}/evidence.json`,JSON.stringify({checks,events,errors},null,2));await Promise.all(browsers.map(b=>b.close()));await vite.close();await room.close()}
