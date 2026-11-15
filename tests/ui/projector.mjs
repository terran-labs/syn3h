import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
await mkdir('tests/ui/artifacts',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
const report=[]
try {
 for(const phone of [false,true]) {
  const device=phone?'narrow':'projector', context=await browser.newContext({viewport:phone?{width:320,height:844}:{width:1600,height:1000},hasTouch:phone,isMobile:phone,permissions:['clipboard-read','clipboard-write']})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto(`http://127.0.0.1:5187/?room=jam-${device}&attract=1`)
  await page.waitForFunction(()=>window.syn3h?.shell.attracting,null,{timeout:60000})
  await page.waitForTimeout(1000)
  await page.screenshot({path:`tests/ui/artifacts/${device}-attract-volcano.png`})
  const before=await page.evaluate(()=>syn3h.game.camera.position.toArray());await page.waitForTimeout(700)
  assert.notDeepEqual(await page.evaluate(()=>syn3h.game.camera.position.toArray()),before)
  await page.evaluate(()=>{for(let i=0;i<180;i++)syn3h.shell.update(.1)})
  await page.waitForTimeout(700);assert.equal(await page.locator('.attract-overlay').getAttribute('data-shot'),'road')
  await page.screenshot({path:`tests/ui/artifacts/${device}-attract-road.png`})
  await page.evaluate(()=>syn3h.params.set('bots.count',3));await page.waitForFunction(()=>syn3h.bots.vehicles.length>0)
  await page.evaluate(()=>{for(let i=0;i<180;i++)syn3h.shell.update(.1)})
  await page.waitForTimeout(700);assert.equal(await page.locator('.attract-overlay').getAttribute('data-shot'),'bot')
  await page.screenshot({path:`tests/ui/artifacts/${device}-attract-bot.png`})
  if(phone) await page.touchscreen.tap(160,400);else await page.keyboard.press('a')
  assert.equal(await page.evaluate(()=>syn3h.shell.attracting),false);assert.equal(await page.evaluate(()=>syn3h.game.input.suspended),true)
  const panel=async id=>{await page.evaluate(id=>syn3h.shell.showPanel(id),id);await page.waitForFunction(id=>document.querySelector('.lobby-panels').dataset.activePanel===id&&document.querySelector('.lobby-panels').dataset.busy==='false',id)}
  await panel('explore');await page.locator('#shell-name').fill('A Very Long Pilot Name 88');await page.locator('#shell-room').fill('The Very Long Game Jam Room Name With Plenty Of People')
  await page.keyboard.press('Tab')
  const rows=Array.from({length:16},(_,i)=>`${i===0?'>':' '} ${i<8?'Pilot':'Bot'} With A Very Long Name ${i}   ${100-i}  ${i===0?'[KING] (you) (host)':i===15?'(paused)':''}`)
  const lines=['net: room server text ping 100ms','host: test host',...rows]
  await page.evaluate(lines=>syn3h.shell.setStatus(lines),lines);await page.evaluate(()=>syn3h.shell.setPlayerCount(8))
  await page.keyboard.press('j');await page.locator('.join-view').waitFor({state:'visible'})
  assert.match(await page.locator('.join-count').textContent(),/8 players/)
  const url=await page.locator('.join-view .invite-link').textContent();assert.ok(!url.includes('attract='))
  await page.screenshot({path:`tests/ui/artifacts/${device}-join.png`})
  await page.locator('.join-view .invite-qr').screenshot({path:`tests/ui/artifacts/${device}-qr.png`})
  await page.locator('.join-copy').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url)
  await page.keyboard.press('j');assert.equal(await page.locator('.join-view').isVisible(),false)
  await panel('multiplayer');await page.screenshot({path:`tests/ui/artifacts/${device}-multiplayer-qr.png`})
  assert.equal(await page.locator('.shell-scoreboard .score-row').count(),16)
  await page.locator('.shell-scoreboard .score-row').last().scrollIntoViewIfNeeded();await page.screenshot({path:`tests/ui/artifacts/${device}-scores-16.png`})
  for(const id of ['index','vehicle','worlds','settings']) {await panel(id);await page.screenshot({path:`tests/ui/artifacts/${device}-${id}.png`})}
  if(!phone){await page.waitForFunction(()=>syn3h.shell.attracting,null,{timeout:25000});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>syn3h.shell.attracting),false)}
  // Isolate the presentation fixture from live network status replacement.
  await page.evaluate(()=>{syn3h.shell.onPlay=()=>{};syn3h.shell.play()})
  await page.evaluate(lines=>syn3h.shell.setStatus(lines),lines)
  await page.keyboard.press('p');assert.equal(await page.evaluate(()=>syn3h.shell.presentation),true)
  assert.equal(await page.locator('.hud-scoreboard .is-developer').first().isVisible(),false)
  const state={mode:'koth',holderName:'Pilot With A Very Long Name 0',holderIsYou:true,contested:false,scores:Array.from({length:16},(_,i)=>({name:`${i<8?'Pilot':'Bot'} With A Very Long Name ${i}`,score:100-i,you:i===0})),target:120,winner:null}
  await page.evaluate(s=>syn3h.shell.setMatchState(s),state)
  await page.screenshot({path:`tests/ui/artifacts/${device}-presentation.png`})
  const winner={...state,winner:state.holderName,winnerColor:'#ff8844',nextRoundIn:6}
  await page.evaluate(s=>syn3h.shell.setMatchState(s),winner);await page.screenshot({path:`tests/ui/artifacts/${device}-winner.png`})
  assert.equal(await page.locator('.round-end').evaluate(el=>el.style.getPropertyValue('--winner-color')),'#ff8844')
  await page.waitForTimeout(1100);await page.evaluate(s=>syn3h.shell.setMatchState(s),winner)
  assert.match(await page.locator('.round-end small').textContent(),/5/)
  await page.waitForTimeout(3000);await page.screenshot({path:`tests/ui/artifacts/${device}-countdown.png`})
  assert.match(await page.locator('.round-end small').textContent(),/2/)
  await page.evaluate(s=>syn3h.shell.setMatchState({...s,holderName:null}),state)
  assert.equal(await page.locator('.round-end').count(),0)
  await page.keyboard.press('j');assert.equal(await page.locator('.touch-controls').isVisible(),false);await page.keyboard.press('j');assert.equal(await page.evaluate(()=>syn3h.shell.menuOpen),false)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.deepEqual(errors,[]);report.push({device,url,attractShots:3,scores:16,countdown:true,errors});await context.close()
 }
 await writeFile('tests/ui/artifacts/projector-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
