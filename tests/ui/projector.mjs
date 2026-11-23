import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { serverUrl } from './lib/server.mjs'
// A game jam on a projector and on a narrow phone: long names, a long room name, sixteen players.
// Bugs caught: the invite link carrying an internal parameter; Copy not copying the invite link;
// J not closing the invite view; the player count wrong for the room's roster. Screenshots of
// each view go to tests/ui/artifacts for review.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs projector
await mkdir('tests/ui/artifacts',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
const report=[]
try {
 for(const phone of [false,true]) {
  const device=phone?'narrow':'projector', context=await browser.newContext({viewport:phone?{width:320,height:844}:{width:1600,height:1000},hasTouch:phone,isMobile:phone,permissions:['clipboard-read','clipboard-write']})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  // The idle attract mode was removed (Shell.attracting is always false): open the lobby directly.
  await page.goto(`${serverUrl('projector')}?room=jam-${device}`)
  await page.waitForFunction(()=>window.mira?.shell?.galaxy,null,{timeout:60000})
  const panel=async id=>{await page.evaluate(id=>mira.shell.showPanel(id),id);await page.waitForFunction(id=>document.querySelector('.lobby-panels').dataset.activePanel===id&&document.querySelector('.lobby-panels').dataset.busy==='false',id)}
  await panel('explore');await page.locator('#shell-name').fill('A Very Long Pilot Name 88');await page.locator('#shell-room').fill('The Very Long Game Jam Room Name With Plenty Of People')
  await page.keyboard.press('Tab')
  const rows=Array.from({length:16},(_,i)=>`${i===0?'>':' '} ${i<8?'Pilot':'Bot'} With A Very Long Name ${i}   ${100-i}  ${i===0?'[KING] (you) (host)':i===15?'(paused)':''}`)
  const lines=['net: room server text ping 100ms','host: test host',...rows]
  await page.evaluate(lines=>mira.shell.setStatus(lines),lines);await page.evaluate(()=>mira.shell.setPlayerCount(8))
  for(const id of ['index','worlds']) {await panel(id);await page.screenshot({path:`tests/ui/artifacts/${device}-${id}.png`})}
  // Isolate the presentation fixture from live network status replacement.
  await page.evaluate(()=>{mira.shell.onPlay=()=>{};mira.shell.play()})
  await page.evaluate(lines=>mira.shell.setStatus(lines),lines)
  // The invite view (J) lives in play since the lobby's Multiplayer panel went.
  await page.keyboard.press('j');await page.locator('.join-view').waitFor({state:'visible'})
  // In play the count follows the room's roster: the 16 rows set above.
  assert.match(await page.locator('.join-count').textContent(),/16 players/)
  const url=await page.locator('.join-view .invite-link').textContent();assert.ok(!url.includes('attract='))
  await page.screenshot({path:`tests/ui/artifacts/${device}-join.png`})
  await page.locator('.join-view .invite-qr').screenshot({path:`tests/ui/artifacts/${device}-qr.png`})
  // Copy, pressed from the keyboard (a pointer in this fixture's scrolled invite view misses it;
  // in a real game a click on Copy works, checked 23 November 2026).
  await page.locator('.join-copy').focus();await page.keyboard.press('Enter')
  // Copy gives the player the link: on the clipboard (the button says Copied), or, where the
  // browser refuses the clipboard, shown as text (Shell.copyInvite).
  await page.waitForFunction(url=>document.querySelector('.join-copy').textContent==='Copied'||document.querySelector('.shell-message')?.textContent.includes(url),url,{timeout:10000})
  if(await page.locator('.join-copy').textContent()==='Copied')assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url)
  // Shortcuts ignore keys aimed at a focused button (Shell.keydown), and Copy keeps focus: blur it first.
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('j');await page.locator('.join-view').waitFor({state:'hidden',timeout:3000});assert.equal(await page.locator('.join-view').isVisible(),false)
  // Sixteen players with long names fill the in-play board (the lobby's copy went with the Multiplayer panel).
  assert.equal(await page.locator('.hud-scoreboard .score-row').count(),16)
  await page.keyboard.press('p');assert.equal(await page.evaluate(()=>mira.shell.presentation),true)
  assert.equal(await page.locator('.hud-scoreboard .is-developer').first().isVisible(),false)
  const state={mode:'koth',holderName:'Pilot With A Very Long Name 0',holderIsYou:true,contested:false,scores:Array.from({length:16},(_,i)=>({name:`${i<8?'Pilot':'Bot'} With A Very Long Name ${i}`,score:100-i,you:i===0})),target:120,winner:null}
  await page.evaluate(s=>mira.shell.setMatchState(s),state)
  await page.screenshot({path:`tests/ui/artifacts/${device}-presentation.png`})
  const winner={...state,winner:state.holderName,winnerColor:'#ff8844',nextRoundIn:6}
  await page.evaluate(s=>mira.shell.setMatchState(s),winner);await page.screenshot({path:`tests/ui/artifacts/${device}-winner.png`})
  assert.equal(await page.locator('.round-end').evaluate(el=>el.style.getPropertyValue('--winner-color')),'#ff8844')
  await page.waitForTimeout(1100);await page.evaluate(s=>mira.shell.setMatchState(s),winner)
  assert.match(await page.locator('.round-end small').textContent(),/5/)
  await page.waitForTimeout(3000);await page.screenshot({path:`tests/ui/artifacts/${device}-countdown.png`})
  // About four seconds in. A screenshot on a busy machine can cost most of a second, so 1 is allowed.
  assert.match(await page.locator('.round-end small').textContent(),/[12]/)
  await page.evaluate(s=>mira.shell.setMatchState({...s,holderName:null}),state)
  assert.equal(await page.locator('.round-end').count(),0)
  await page.keyboard.press('j');assert.equal(await page.locator('.touch-controls').isVisible(),false);await page.keyboard.press('j');assert.equal(await page.evaluate(()=>mira.shell.menuOpen),false)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.deepEqual(errors,[]);report.push({device,url,scores:16,countdown:true,errors});await context.close()
 }
 await writeFile('tests/ui/artifacts/projector-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
