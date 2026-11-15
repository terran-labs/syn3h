import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base=process.env.SYN3H_URL??'http://127.0.0.1:5198/'
await mkdir('tests/ui/artifacts/discoverability',{recursive:true})
for(const mode of ['desktop','phone']){
 const browser=await(mode==='desktop'?chromium.launch({channel:'chrome',headless:true}):webkit.launch())
 try{
  const page=await browser.newPage(mode==='desktop'?{viewport:{width:1440,height:1000}}:devices['iPhone 14'])
  const errors=[],sockets=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('websocket',ws=>sockets.push(ws.url()))
  const room=`ux-discover-${mode}-${Date.now()}`
  await page.goto(`${base}?room=${room}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  // The lobby offers planets, not vehicles: no vehicle control, panel or preview anywhere in it.
  assert.equal(await page.locator('[data-goto=vehicle], [data-panel=vehicle], [name=vehicle], .shell-vehicle, .shell-vehicle-preview, canvas[aria-label="Selected vehicle preview"]').count(),0,'the lobby shows no vehicle control')
  await page.locator('.galaxy-label.is-current').focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>syn3h.shell.playing&&syn3hNet.connected&&!syn3h.shell.dropping,null,{timeout:120000})
  assert.ok(sockets.includes(`ws://127.0.0.1:${process.env.UX_ROOM_PORT??'5298'}/ws?room=${room}`),'connected to the room server started for this run')
  if(await page.evaluate(()=>!!document.pointerLockElement))await page.keyboard.press('Escape');if(await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'})
  const vehicle=page.getByRole('combobox',{name:'Vehicle (reloads and respawns)'}),gear=page.getByRole('combobox',{name:'Gear',exact:true}),gi=page.getByRole('button',{name:'GI lighting'})
  for(const control of [vehicle,gear,gi]){
   assert.ok(await control.isVisible())
   assert.ok(await control.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el}),'top controls actually exposed')
  }
  assert.deepEqual(await vehicle.locator('option').allInnerTexts(),['Buggy','Jet','Hovercraft','Tank'],'the in-play selector offers the four vehicles')
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-selectors.png`})
  await gear.selectOption('bungee');await page.waitForFunction(()=>syn3hNet.gear.current==='bungee')
  await gear.selectOption('yoink');await page.waitForFunction(()=>syn3hNet.gear.current==='yoink')
  await gi.click()
  const strength=page.getByRole('slider',{name:'Global illumination (GI)',exact:true}),status=page.locator('.wi-gi-status')
  assert.ok(await strength.isVisible())
  if(mode==='phone'){assert.ok(await strength.isDisabled());assert.match(await status.innerText(),/requires Desktop/)}
  // Choose render quality using the real existing inspector controls, not URL switches.
  const graphics=page.locator('.wi-card[data-section=you] .wi-group').filter({has:page.locator('summary span',{hasText:/^Graphics$/})})
  await graphics.locator('summary').click()
  await page.locator('.wi-row[data-id="gfx.auto"] input').uncheck()
  await page.locator('.wi-row[data-id="gfx.level"] button[data-value="2"]').click()
  await gi.click();await strength.waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.querySelector('.wi-row[data-id="post.gi"] input').disabled,null,{timeout:30000})
  await strength.focus();await page.keyboard.press('Home')
  await page.waitForFunction(()=>syn3h.params.get('post.gi').value===0&&!syn3h.game.postChain.built?.giNode,null,{timeout:30000})
  assert.match(await status.innerText(),/GI is off/)
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(()=>syn3h.params.get('post.gi').value>0&&!!syn3h.game.postChain.built?.giNode,null,{timeout:60000})
  assert.match(await status.innerText(),/GI active/)
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-gi.png`})
  // Exercise the same shed budget read by renderer and UI; do not invent a second policy.
  await page.evaluate(()=>{syn3h.game.quality.budget=0;const q=syn3h.game.quality;q.governor.rung=q.governor.ladder.length-1})
  await page.waitForFunction(()=>document.querySelector('.wi-gi-status').textContent.includes('automatic quality'),null,{timeout:10000})
  assert.ok(await strength.isDisabled())
  // Switching still reloads and respawns for now. Each of the other three vehicles in turn on
  // the desktop, one on the phone, always landing in the same room near a spawn pad.
  const openPanels=async()=>{if(await page.evaluate(()=>!!document.pointerLockElement))await page.keyboard.press('Escape');if(await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'})}
  for(const kind of mode==='desktop'?['hovercraft','tank','jet']:['hovercraft']){
   const timeOrigin=await page.evaluate(()=>performance.timeOrigin)
   await page.getByRole('combobox',{name:'Vehicle (reloads and respawns)'}).selectOption(kind)
   await page.waitForFunction(([origin,kind])=>performance.timeOrigin!==origin&&window.syn3h?.player.kind===kind&&window.syn3hNet?.connected,[timeOrigin,kind],{timeout:120000})
   assert.equal(new URL(page.url()).searchParams.get('room'),room)
   assert.equal(new URL(page.url()).searchParams.get('vehicle'),null,'no sticky vehicle override left in the URL')
   assert.ok(await page.evaluate(()=>{const p=syn3h.player.body.translation(),s=syn3h.terrain.spawnPoint(0).position;return Math.hypot(p.x-s.x,p.z-s.z)<50}),`${kind} respawns near spawn pad`)
   await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
   await openPanels()
   assert.equal(await page.getByRole('combobox',{name:'Vehicle (reloads and respawns)'}).inputValue(),kind)
  }
  // A returning player lands in the vehicle last chosen in play; a new one lands in the Buggy.
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('syn3h.vehicle')).vehicleKind),mode==='desktop'?'jet':'hovercraft')
  assert.deepEqual(errors,[])
  console.log(`${mode}: planets-only lobby, four vehicles in the selector, gear and GI controls, vehicle switching passed`)
 }finally{await browser.close()}
}
