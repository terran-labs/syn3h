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
  // The lobby's opening (about nine seconds) hides its controls; a key skips to the settled lobby.
  await page.keyboard.press('Shift');await page.waitForTimeout(700)
  // The lobby offers planets, not vehicles: no vehicle control, panel or preview anywhere in it.
  assert.equal(await page.locator('[data-goto=vehicle], [data-panel=vehicle], [name=vehicle], .shell-vehicle, .shell-vehicle-preview, canvas[aria-label="Selected vehicle preview"]').count(),0,'the lobby shows no vehicle control')
  // Two buttons at the bottom and no more; Settings is the gear in the corner (LobbySettings).
  assert.deepEqual(await page.locator('.galaxy-links button').allInnerTexts().then(all=>all.map(text=>text.trim().toLowerCase())),['about'],'the lobby has exactly two buttons')
  assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).count(),1,'the settings gear is there')
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-lobby.png`})
  // The lobby lists the planet recipes and nothing else: "Shape your own" is hidden for now.
  const lobbyWorlds=await page.evaluate(()=>({labels:[...document.querySelectorAll('.galaxy-label')].map(chip=>chip.dataset.world),forming:syn3h.shell.galaxy.options.worlds.filter(world=>world.forming).length,text:document.querySelector('.galaxy-labels').textContent}))
  assert.ok(lobbyWorlds.labels.length>0&&!lobbyWorlds.labels.includes('custom')&&lobbyWorlds.forming===0,'the lobby lists only the planet recipes')
  assert.doesNotMatch(lobbyWorlds.text,/shape your own/i)
  await page.locator('.galaxy-label.is-current').focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>syn3h.shell.playing&&syn3hNet.connected&&!syn3h.shell.dropping,null,{timeout:120000})
  assert.ok(sockets.includes(`ws://127.0.0.1:${process.env.UX_ROOM_PORT??'5298'}/ws?room=${room}`),'connected to the room server started for this run')
  if(await page.evaluate(()=>!!document.pointerLockElement)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement)}if(await page.locator('.inspector-toggle').isVisible()&&await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'})
  assert.equal(await page.locator('.wi-quick, .gear-select, [data-wi=show-gi]').count(),0,'the redundant quick row and its controls are gone')
  const card=page.locator('.wi-card[data-section=you]')
  await card.locator('.wi-head').click()
  const vehicle=card.getByRole('combobox',{name:'Vehicle',exact:true})
  await vehicle.scrollIntoViewIfNeeded()
  assert.equal(await card.locator('.wi-body > :first-child').evaluate(el=>el.classList.contains('wi-vehicle')),true,'vehicle controls lead their panel')
  assert.ok((await vehicle.boundingBox()).height>=44,'vehicle choice is a full touch target')
  assert.equal(await page.getByRole('combobox',{name:'Gear',exact:true}).count(),0)
  assert.deepEqual(await vehicle.locator('option').allInnerTexts(),['Buggy','Jet','Hovercraft','Tank'],'the in-play selector offers the four vehicles')
  // Vehicle colours are chosen in play, beside the selector: the vehicle repaints at once with
  // no reload, and the choice is saved and announced to the room once the picker settles.
  if(mode==='desktop'||await page.locator('.wi-swatch input[data-tint=body]').isVisible()){
   const loadedAt=await page.evaluate(()=>performance.timeOrigin)
   await page.evaluate(()=>{window.__profiles=[];const net=window.syn3hNet,announce=net.setProfile.bind(net);net.setProfile=profile=>{window.__profiles.push(profile);return announce(profile)}})
   assert.equal(await page.locator('.wi-swatch input[data-tint=body]').inputValue(),await page.evaluate(()=>syn3h.player.colors.body),'the swatch shows the vehicle\'s colour')
   await page.locator('.wi-swatch input[data-tint=body]').fill('#ff00aa')
   await page.waitForFunction(()=>syn3h.player.colors.body==='#ff00aa',null,{timeout:5000})
   await page.locator('.wi-swatch input[data-tint=accent]').fill('#00ffcc')
   await page.waitForFunction(()=>syn3h.player.colors.accent==='#00ffcc',null,{timeout:5000})
   await page.waitForFunction(()=>window.__profiles.some(p=>p.colors?.body==='#ff00aa'&&p.colors?.accent==='#00ffcc')&&JSON.parse(localStorage.getItem('syn3h.vehicle')??'{}').accentColor==='#00ffcc',null,{timeout:5000})
   assert.ok(await page.evaluate(()=>window.__profiles.length)<=2,'the room is told once the picker settles, not on every step')
   assert.equal(await page.evaluate(()=>performance.timeOrigin),loadedAt,'changing colour does not reload the page')
   await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-tint.png`})
  }
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-selectors.png`})
  // The same callback must swap in place, preserving page and room.
  const loadedAt=await page.evaluate(()=>performance.timeOrigin)
  for(const kind of ['jet','hovercraft','tank','buggy-syn3h']){
   await vehicle.selectOption(kind)
   await page.waitForFunction(kind=>syn3h.player.kind===kind||(kind==='buggy-syn3h'&&syn3h.player.kind==='buggy'),kind,{timeout:30000})
   assert.equal(await page.evaluate(()=>performance.timeOrigin),loadedAt,'vehicle switch does not reload')
   assert.equal(new URL(page.url()).searchParams.get('room'),room)
  }
  assert.deepEqual(await card.locator('.wi-vehicle select, .wi-vehicle input').evaluateAll(es=>es.map(el=>el.dataset.tint??'vehicle')),['vehicle','body','accent'],'vehicle and colours retain DOM focus order')
  if(mode==='desktop'){
   await vehicle.focus();await page.keyboard.press('Tab')
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-tint')),'body','keyboard order reaches body colour next')
   await page.keyboard.press('Tab')
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-tint')),'accent','then accent colour')
  }else{
   // Mobile WebKit does not Tab through native colour pickers. Verify their actual touch
   // hit areas; fill() above already proves both native inputs repaint, persist and announce.
   for(const tint of ['body','accent']){
    const input=card.locator(`input[data-tint=${tint}]`)
    await input.scrollIntoViewIfNeeded()
    const label=input.locator('..')
    const hit=await label.evaluate(el=>{const r=el.getBoundingClientRect(), target=document.elementFromPoint(r.x+3,r.y+r.height/2);return {w:r.width,h:r.height,target:target?.tagName,hit:target===el||el.contains(target)}})
    console.log(`${mode} ${tint} picker label: ${JSON.stringify(hit)}`)
    assert.ok(hit.w>=44&&hit.h>=44&&hit.hit,`${tint} is a reachable 44px native picker: ${JSON.stringify(hit)}`)
    // Tap the padding, not the small colour dot. Cancel only the picker dialog itself so
    // automation can verify the label forwards a trusted activation to the native input.
    await input.evaluate(el=>{window.__pickerActivated=false;el.addEventListener('click',event=>{window.__pickerActivated=event.isTrusted;event.preventDefault()},{once:true})})
    await label.tap({position:{x:3,y:22}})
    assert.ok(await page.evaluate(()=>window.__pickerActivated),`${tint} label activates its native picker`)

   }
  }
  // Rebuilding the inspector moves the existing widget and keeps its listeners and colours.
  await page.evaluate(()=>syn3h.shell.inspector.rebuild())
  assert.equal(await page.locator('.wi-vehicle-select').count(),1)
  assert.equal(await page.locator('.wi-swatch input').count(),2)
  await card.locator('.wi-head .wi-sum').evaluate(el=>el.scrollIntoView({block:'nearest'}))
  await page.waitForFunction(()=>document.querySelector('.wi-card[data-section=you] .wi-sum').textContent.endsWith(' · Buggy'))
  const gi=page.locator('.wi-card[data-section=performance] .wi-row[data-id="post.gi"]')
  assert.equal(await gi.count(),1,'GI already belongs to Performance')
  await vehicle.scrollIntoViewIfNeeded()
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-vehicles.png`})
  assert.deepEqual(errors,[])
  console.log(`${mode}: vehicle panel, in-place swaps, colours and focus order passed`)
 }finally{await browser.close()}
}
