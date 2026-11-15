/** tools/heavy.sh node tools/island-bot-qa.mjs [output]
 * One headed browser. The climbing player is a scripted target on the public centreline;
 * bots drive their real physics. This does not claim a human completed the climb.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { serveStable } from './serve-stable.mjs';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
const out=process.argv[2]??'/tmp/syn3h-island-bots';await mkdir(out,{recursive:true});
process.env.SYN3H_NO_ROOM_SERVER='1';
const room=await serveStable({dir:process.cwd(),port:0});
const vite=await createServer({define:{'import.meta.env.VITE_SERVER_URL':JSON.stringify('ws://127.0.0.1:5186')},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/ws':{target:`ws://127.0.0.1:${room.server.address().port}`,ws:true}}}});
let browser;const frames=[],results=[],errors=[];
try{
 await vite.listen();browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:960,height:540}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5186/?autoplay=1&room=island-bot-qa&seed=42');await page.waitForFunction(()=>window.syn3hNet?.connected,null,{timeout:90000});
 await page.evaluate(()=>{const s=window.syn3h;s.game.quality.frame=()=>{};s.params.set('gfx.level',1);s.params.set('bots.count',4);s.params.set('bots.canFire',false);});
 await page.waitForFunction(()=>window.syn3h.bots.vehicles.length===4);
 const sample=phase=>page.evaluate(phase=>{const s=window.syn3h,p=s.player.body.translation(),roads=s.terrain.roadPaths(),climb=roads.find(r=>r.kind==='volcano');return{phase,tick:s.game.tick,time:s.game.time,player:[p.x,p.y,p.z],bots:s.bots.vehicles.map(b=>{const q=b.body.translation();let contact=false;for(let i=0;i<b.body.numColliders();i++)for(let j=0;j<s.player.body.numColliders();j++)s.game.world.contactPair(b.body.collider(i),s.player.body.collider(j),m=>{if(m.numContacts())contact=true;});return{id:b.id,p:[q.x,q.y,q.z],distance:Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z),contact,roadDistance:Math.min(...climb.points.map(a=>Math.hypot(q.x-a.x,q.y-a.y,q.z-a.z))),liquid:s.terrain.liquidKindAt?.(q.x,q.z),visible:b.object.visible,input:{...b.input},velocity:b.body.linvel(),grounded:b.wheelsGrounded,motorSpeed:b.motorSpeed,motorTorque:b.motorTorque,enabled:b.body.isEnabled(),quaternion:b.body.rotation(),brain:(()=>{const a=s.game.systems.find(x=>x.vehicle===b&&'reversing'in x);return a?{reversing:a.reversing,rescues:a.rescues,waypoint:a.waypoint}:null})()};}),game:window.syn3hNet.game};},phase);
 async function phase(name,seconds){const start=Date.now();let shot=-20;while((Date.now()-start)/1000<seconds){const elapsed=(Date.now()-start)/1000;results.push(await sample(name));if(elapsed-shot>=15){const file=`${out}/${name}-${Math.floor(elapsed)}.png`;await page.screenshot({path:file});frames.push({file,label:`${name} ${Math.floor(elapsed)}s`});shot=elapsed;}await writeFile(`${out}/trace.json`,JSON.stringify({results,errors}));await page.waitForTimeout(1000);}console.log('DONE',name,JSON.stringify(results.at(-1)));}
 if(process.argv[3]!=='recovery')await phase('pad',25);
 // Let shared count echoes settle before positioning the replacement vehicles.
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('bots.count',0);s.bots.update();});
 await page.waitForTimeout(500);
 await page.evaluate(()=>{const s=window.syn3h;s.params.set('bots.count',4);s.bots.update();});
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{
  const s=window.syn3h,road=s.terrain.roadPaths().find(r=>r.kind==='volcano'),points=[...road.points];if(points[0].y>points.at(-1).y)points.reverse();
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y,points[i].z-points[i-1].z));
  const place=(v,index)=>{const a=points[index],b=points[Math.min(index+1,points.length-1)],p=v.object.position.clone().set(a.x,a.y+1.3,a.z);v.teleport(p,Math.atan2(a.x-b.x,a.z-b.z));};
  s.bots.vehicles.forEach((b,i)=>place(b,i*2));place(s.player,20);s.camera.setVehicle(s.bots.vehicles[0]);s.player.isLocal=false;s.player.body.setBodyType(1,true);
  let elapsed=0;window.islandDriver=s.game.add({fixedUpdate(dt){elapsed+=dt;const travelled=Math.min(lengths.at(-1),80+elapsed*11);let i=lengths.findIndex(n=>n>=travelled);place(s.player,i<0?points.length-1:i);}});
  window.islandRoad={length:lengths.at(-1),points:points.length};
 });
 console.log('ROAD',await page.evaluate(()=>window.islandRoad));
 if(process.argv[3]!=='recovery')await phase('spiral',190);
 await page.evaluate(()=>{const s=window.syn3h;s.game.remove(window.islandDriver);s.player.body.setBodyType(0,true);s.player.isLocal=true;s.camera.setVehicle(s.player);s.params.set('game.mode',1);const rim=s.terrain.roadPaths().find(r=>r.kind==='rim'),p=rim.points[0];s.player.teleport(s.player.object.position.clone().set(p.x,p.y+2,p.z));s.bots.vehicles.forEach((b,i)=>{const p=rim.points[(i+2)*3%rim.points.length];b.teleport(b.object.position.clone().set(p.x,p.y+2,p.z));});});
 await phase('hill',process.argv[3]==='recovery'?8:25);
 for(const kind of ['lake','sea']){
  await page.evaluate(kind=>{const s=window.syn3h,b=s.bots.vehicles[0],summit=s.terrain.summit();const x=kind==='lake'?summit.x:s.terrain.size*.48,z=kind==='lake'?summit.z:0,y=s.terrain.liquidHeightAt(x,z);b.teleport(b.object.position.clone().set(x,y-.5,z));s.camera.setVehicle(b);},kind);
  await phase(kind,14);
 }
 await writeFile(`${out}/trace.json`,JSON.stringify({results,errors},null,2));
 await page.close();const sheet=await browser.newPage({viewport:{width:1280,height:Math.ceil(frames.length/4)*200}});
 await sheet.setContent('<body style="margin:0;background:#101820"><canvas id="sheet"></canvas></body>');
 const data=await Promise.all(frames.map(async f=>({label:f.label,url:'data:image/png;base64,'+(await readFile(f.file)).toString('base64')})));
 await sheet.evaluate(async frames=>{const c=document.getElementById('sheet');c.width=1280;c.height=Math.ceil(frames.length/4)*200;const ctx=c.getContext('2d');ctx.font='14px sans-serif';for(let i=0;i<frames.length;i++){const img=new Image();img.src=frames[i].url;await img.decode();const x=i%4*320,y=Math.floor(i/4)*200;ctx.drawImage(img,x,y,320,180);ctx.fillStyle='white';ctx.fillText(frames[i].label,x+5,y+195);}},data);
 await sheet.screenshot({path:`${out}/contact-sheet.png`});console.log('ERRORS',errors);
}finally{await browser?.close();await vite.close();await room.close();}
