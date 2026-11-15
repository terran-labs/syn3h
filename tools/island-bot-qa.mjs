/** tools/heavy.sh node tools/island-bot-qa.mjs [output]
 * Optional environment: PLANET, SEED, ROAD_ONLY=1, BOTS, ROAD_START (0..1),
 * CLIMB_SECONDS, TARGET_SPEED, QA_PORT. Bots chase relentlessly here (bots.freeSpirit 0): this run judges the
 * pursuit, not their own agenda, and the game mode is held off (bots in tag hunt and flee
 * each other instead of following the player). A third argument "recovery" skips the initial chase and climb.
 * One headed browser. The climbing player is a scripted target on the public centreline;
 * bots drive their real physics. This does not claim a human completed the climb.
 */
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { serveStable } from './serve-stable.mjs';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
const planet=process.env.PLANET??'volcanic',seed=process.env.SEED??'42';
const port=Number(process.env.QA_PORT??5186),targetSpeed=Number(process.env.TARGET_SPEED??11);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isFinite(targetSpeed)||targetSpeed<=0||targetSpeed>30)throw new Error('Invalid QA port or target speed');
const count=Number(process.env.BOTS??4),roadStart=Number(process.env.ROAD_START??0),climbSeconds=Number(process.env.CLIMB_SECONDS??240);
if(!Number.isInteger(count)||count<1||count>4||!Number.isFinite(roadStart)||roadStart<0||roadStart>1||!Number.isFinite(climbSeconds)||climbSeconds<=0||climbSeconds>600)throw new Error('Use 1 to 4 bots, road start 0 to 1 and climb duration up to 600 seconds');
const out=process.argv[2]??'/tmp/syn3h-island-bots';await mkdir(out,{recursive:true});
process.env.SYN3H_NO_ROOM_SERVER='1';process.env.VITE_SERVER_URL=`ws://127.0.0.1:${port}`;
const room=await serveStable({dir:process.cwd(),port:0});
const vite=await createServer({define:{'import.meta.env.VITE_SERVER_URL':JSON.stringify(`ws://127.0.0.1:${port}`)},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}});
let browser;const frames=[],results=[],errors=[];
async function smoke(){const result=await promisify(execFile)(process.execPath,['tools/smoke.mjs',`http://127.0.0.1:${port}/`,`${out}/smoke.png`]);console.log(result.stdout);if(result.stderr)console.error(result.stderr);}
try{
 await vite.listen();if(process.env.SMOKE_ONLY){await smoke();}else{browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:960,height:540}});page.on('websocket',ws=>{if(ws.url().includes('/ws?')){console.log('ROOM SOCKET',ws.url());if(!ws.url().startsWith(`ws://127.0.0.1:${port}/ws?`))errors.push('Wrong room endpoint: '+ws.url());}});page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${port}/?autoplay=1&room=island-bot-qa&planet=${planet}&seed=${seed}`);await page.waitForFunction(()=>window.syn3hNet?.connected,null,{timeout:90000});
 if(process.env.NORMAL_DEFAULTS){const defaults=await page.evaluate(()=>Object.fromEntries(['bots.count','bots.fleet','bots.jetForwardFlight','daydream.seconds'].map(id=>[id,window.syn3h.params.get(id).value])));console.log('NORMAL DEFAULTS',defaults);if(defaults['bots.count']!==4||defaults['bots.fleet']!==1||defaults['bots.jetForwardFlight']!==true||defaults['daydream.seconds']!==300)throw new Error('Normal bot defaults differ');}
 await page.evaluate(count=>{const s=window.syn3h;s.game.quality.frame=()=>{};s.params.set('gfx.level',1);s.params.set('bots.freeSpirit',Number(new URLSearchParams(location.search).get('freeSpirit')??0));if(new URLSearchParams(location.search).get('match')!=='1'){s.bots.setMatch(null);s.bots.setMatch=()=>{}};s.params.set('bots.fleet',0);s.params.set('bots.count',count);s.params.set('bots.canFire',false);},count);
 await page.waitForFunction(count=>window.syn3h.bots.vehicles.length===count,count);
 const sample=phase=>page.evaluate(phase=>{const s=window.syn3h,p=s.player.body.translation(),roads=s.terrain.roadPaths(),climb=roads.find(r=>r.kind==='volcano');return{phase,tick:s.game.tick,time:s.game.time,player:[p.x,p.y,p.z],bots:s.bots.vehicles.map(b=>{const q=b.body.translation();let contact=false;for(let i=0;i<b.body.numColliders();i++)for(let j=0;j<s.player.body.numColliders();j++)s.game.world.contactPair(b.body.collider(i),s.player.body.collider(j),m=>{if(m.numContacts())contact=true;});return{id:b.id,p:[q.x,q.y,q.z],distance:Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z),contact,roadDistance:Math.min(...climb.points.map(a=>Math.hypot(q.x-a.x,q.y-a.y,q.z-a.z))),liquid:s.terrain.liquidKindAt?.(q.x,q.z),visible:b.object.visible,input:{...b.input},velocity:b.body.linvel(),grounded:b.wheelsGrounded,motorSpeed:b.motorSpeed,motorTorque:b.motorTorque,enabled:b.body.isEnabled(),quaternion:b.body.rotation(),brain:(()=>{const a=s.game.systems.find(x=>x.vehicle===b&&'reversing'in x);return a?{reversing:a.reversing,rescues:a.rescues,waypoint:a.waypoint}:null})()};}),game:window.syn3hNet.game};},phase);
 async function phase(name,seconds){const start=Date.now();let shot=-20;while((Date.now()-start)/1000<seconds){const elapsed=(Date.now()-start)/1000;if(errors.length)throw new Error(errors[0]);results.push(await sample(name));if(elapsed-shot>=15){const file=`${out}/${name}-${Math.floor(elapsed)}.png`;await page.screenshot({path:file});frames.push({file,label:`${name} ${Math.floor(elapsed)}s`});shot=elapsed;}await writeFile(`${out}/trace.json`,JSON.stringify({results,errors}));await page.waitForTimeout(1000);}console.log('DONE',name,JSON.stringify(results.at(-1)));}
 if(process.argv[3]!=='recovery')await phase('pad',25);
 // Let shared count echoes settle before positioning the replacement vehicles.
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('bots.count',0);s.bots.update();});
 await page.waitForTimeout(500);
 await page.evaluate(count=>{const s=window.syn3h;s.params.set('bots.count',count);s.bots.update();},count);
 await page.waitForTimeout(1000);
 await page.evaluate(({roadStart,targetSpeed})=>{
  const s=window.syn3h,road=s.terrain.roadPaths().find(r=>r.kind==='volcano'),points=[...road.points];if(points[0].y>points.at(-1).y)points.reverse();
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y,points[i].z-points[i-1].z));
  const place=(v,index)=>{const a=points[index],b=points[Math.min(index+1,points.length-1)],p=v.object.position.clone().set(a.x,a.y+1.3,a.z);v.teleport(p,Math.atan2(a.x-b.x,a.z-b.z));};
  const startIndex=Math.min(points.length-22,Math.floor(roadStart*points.length));
  s.bots.vehicles.forEach((b,i)=>place(b,startIndex+i*2));place(s.player,startIndex+20);s.camera.setVehicle(s.bots.vehicles[0]);s.player.isLocal=false;s.player.body.setBodyType(2,true);
  let elapsed=0;window.islandDriver=s.game.add({fixedUpdate(dt){elapsed+=dt;const travelled=Math.min(lengths.at(-1),lengths[startIndex]+80+elapsed*targetSpeed);let i=lengths.findIndex(n=>n>=travelled);i=Math.max(1,i<0?points.length-1:i);const a=points[i-1],b=points[i],t=(travelled-lengths[i-1])/(lengths[i]-lengths[i-1]);s.player.body.setNextKinematicTranslation({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t+1.3,z:a.z+(b.z-a.z)*t});}});
  window.islandRoad={length:lengths.at(-1),points:points.length,width:road.width,path:points};
 },{roadStart,targetSpeed});
 const road=await page.evaluate(()=>window.islandRoad);await writeFile(`${out}/road.json`,JSON.stringify(road));console.log('ROAD',{length:road.length,points:road.points,width:road.width});
 if(process.argv[3]!=='recovery')await phase('spiral',climbSeconds);
 if(process.env.ROAD_ONLY){
  const last=results.at(-1),arrived=last.bots.filter(b=>b.distance<40).length;
  if(arrived!==count||last.bots.some(b=>(b.brain?.rescues??0)>0))throw new Error(`Summit acceptance failed: ${arrived}/${count} arrived or a rescue occurred`);
 }
 if(!process.env.ROAD_ONLY){
 await page.evaluate(()=>{const s=window.syn3h;s.game.remove(window.islandDriver);s.player.body.setBodyType(0,true);s.player.isLocal=true;s.camera.setVehicle(s.player);s.params.set('game.mode',1);const rim=s.terrain.roadPaths().find(r=>r.kind==='rim'),p=rim.points[0];s.player.teleport(s.player.object.position.clone().set(p.x,p.y+2,p.z));s.bots.vehicles.forEach((b,i)=>{const p=rim.points[(i+2)*3%rim.points.length];b.teleport(b.object.position.clone().set(p.x,p.y+2,p.z));});});
 await phase('hill',process.argv[3]==='recovery'?8:25);
 for(const kind of ['lake','sea']){
  await page.evaluate(kind=>{const s=window.syn3h,b=s.bots.vehicles[0],summit=s.terrain.summit();const x=kind==='lake'?summit.x:s.terrain.size*.48,z=kind==='lake'?summit.z:0,y=s.terrain.liquidHeightAt(x,z);b.teleport(b.object.position.clone().set(x,y-.5,z));s.camera.setVehicle(b);},kind);
  await phase(kind,14);
 }
 }
 await writeFile(`${out}/trace.json`,JSON.stringify({planet,seed,results,errors},null,2));
 await page.close();const sheet=await browser.newPage({viewport:{width:1280,height:Math.ceil(frames.length/4)*200}});
 await sheet.setContent('<body style="margin:0;background:#101820"><canvas id="sheet"></canvas></body>');
 const data=await Promise.all(frames.map(async f=>({label:f.label,url:'data:image/png;base64,'+(await readFile(f.file)).toString('base64')})));
 await sheet.evaluate(async frames=>{const c=document.getElementById('sheet');c.width=1280;c.height=Math.ceil(frames.length/4)*200;const ctx=c.getContext('2d');ctx.font='14px sans-serif';for(let i=0;i<frames.length;i++){const img=new Image();img.src=frames[i].url;await img.decode();const x=i%4*320,y=Math.floor(i/4)*200;ctx.drawImage(img,x,y,320,180);ctx.fillStyle='white';ctx.fillText(frames[i].label,x+5,y+195);}},data);
 await sheet.screenshot({path:`${out}/contact-sheet.png`});console.log('ERRORS',errors);if(errors.length)throw new Error(errors[0]);
 if(process.env.SMOKE){await browser.close();browser=null;await smoke();}
 }
}finally{await browser?.close();await vite.close();await room.close();}
