import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base=process.env.SYN3H_URL??'http://127.0.0.1:5198/'
await mkdir('tests/ui/artifacts/discoverability',{recursive:true})
for(const mode of ['desktop','phone']){
 const browser=await(mode==='desktop'?chromium.launch({channel:'chrome',headless:true}):webkit.launch())
 try{
  const page=await browser.newPage(mode==='desktop'?{viewport:{width:1440,height:1000}}:devices['iPhone 14'])
  // Images: none in ordinary play (AGENTS.md); the Welcome pictures only once About is opened.
  const images=[];page.on('request',r=>{if(r.resourceType()==='image')images.push(new URL(r.url()).pathname)})
  const errors=[],sockets=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('websocket',ws=>sockets.push(ws.url()))
  const room=`ux-discover-${mode}-${Date.now()}`
  await page.goto(`${base}?room=${room}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  // The lobby's opening (about nine seconds) hides its controls; a key skips to the settled lobby.
  await page.keyboard.press('Shift');await page.waitForTimeout(700)
  // The lobby offers planets, not vehicles: no vehicle control, panel or preview anywhere in it.
  assert.equal(await page.locator('[data-goto=vehicle], [data-panel=vehicle], [name=vehicle], .shell-vehicle, .shell-vehicle-preview, canvas[aria-label="Selected vehicle preview"]').count(),0,'the lobby shows no vehicle control')
  // No bottom buttons (Multiplayer was removed); Settings, About and Updates are icons in the corner (LobbySettings).
  assert.equal(await page.locator('.galaxy-links button').count(),0,'the lobby has no bottom buttons')
  for(const name of ['Settings','About Syn3h',/^Updates/]) assert.equal(await page.getByRole('button',{name,exact:typeof name==='string'}).count(),1,`the ${name} icon is there`)
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-lobby.png`})
  // About is the Welcome guide: its sections are there, and its pictures load only now.
  assert.deepEqual(images,[],'no image request in the lobby before About is opened')
  await page.getByRole('button',{name:'About Syn3h',exact:true}).click()
  const welcome=page.locator('dialog.lobby-sheet .welcome-body')
  await welcome.waitFor({state:'visible'})
  for(const heading of ['Start in three moves','Controls','Settings worth knowing'])assert.equal(await welcome.getByRole('heading',{name:heading}).count(),1,`Welcome has ${heading}`)
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog.lobby-sheet .welcome-shot')].some(f=>f.classList.contains('is-loaded')),null,{timeout:30000})
  assert.ok(images.length>0&&images.every(url=>/^\/welcome\/[\w-]+-(640|1280)\.webp$/.test(url)),`only Welcome pictures load after opening ${JSON.stringify(images)}`)
  await page.screenshot({path:`tests/ui/artifacts/discoverability/${mode}-welcome.png`})
  await page.keyboard.press('Escape');await welcome.waitFor({state:'hidden'})
  // The lobby lists the planet recipes and nothing else: "Shape your own" is hidden for now.
  const lobbyWorlds=await page.evaluate(()=>({labels:[...document.querySelectorAll('.galaxy-label')].map(chip=>chip.dataset.world),forming:syn3h.shell.galaxy.options.worlds.filter(world=>world.forming).length,text:document.querySelector('.galaxy-labels').textContent}))
  assert.ok(lobbyWorlds.labels.length>0&&!lobbyWorlds.labels.includes('custom')&&lobbyWorlds.forming===0,'the lobby lists only the planet recipes')
  assert.doesNotMatch(lobbyWorlds.text,/shape your own/i)
  await page.locator('.galaxy-label.is-current').focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>syn3h.shell.playing&&syn3hNet.connected&&!syn3h.shell.dropping,null,{timeout:120000})
  // The socket's host depends on the dev setup (VITE_SERVER_URL); what matters is that this page joined its own room.
  assert.ok(sockets.some(url=>url.endsWith(`/ws?room=${room}`)),'connected to its own room')
  if(await page.evaluate(()=>!!document.pointerLockElement)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement)}if(await page.locator('.inspector-toggle').isVisible()&&await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'})
  assert.equal(await page.locator('.wi-quick, .gear-select, [data-wi=show-gi]').count(),0,'the redundant quick row and its controls are gone')
  const card=page.locator('.wi-card[data-section=you]')
  await card.locator('.wi-head').click()
  // The vehicle choice is a segmented picker (a radio group); the checked segment is its tab stop.
  const vehicle=card.getByRole('radiogroup',{name:'Vehicle',exact:true})
  await vehicle.scrollIntoViewIfNeeded()
  assert.equal(await card.locator('.wi-body > :first-child').evaluate(el=>el.classList.contains('wi-vehicle')),true,'vehicle controls lead their panel')
  for(const box of await vehicle.getByRole('radio').evaluateAll(es=>es.map(el=>el.getBoundingClientRect().height)))assert.ok(box>=44,'each vehicle choice is a full touch target')
  assert.equal(await page.getByRole('combobox',{name:'Gear',exact:true}).count(),0)
  // Every vehicle the game offers (a hidden one, such as the tank, is not offered).
  const offered=await page.evaluate(async()=>(await import('/src/ui/VehicleChoice.ts')).PLAY_VEHICLES.map(v=>({id:v.id,label:v.label})))
  assert.ok(offered.length>=2)
  assert.deepEqual((await vehicle.getByRole('radio').allInnerTexts()).map(t=>t.trim()),offered.map(v=>v.label),'the in-play picker offers every available vehicle')
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
  for(const kind of [...offered.map(v=>v.id).filter(id=>id!=='buggy-syn3h'),'buggy-syn3h']){
   await vehicle.locator(`[data-seg-vehicle="${kind}"]`).click()
   await page.waitForFunction(kind=>syn3h.player.kind===kind||(kind==='buggy-syn3h'&&syn3h.player.kind==='buggy'),kind,{timeout:30000})
   assert.equal(await page.evaluate(()=>performance.timeOrigin),loadedAt,'vehicle switch does not reload')
   assert.equal(new URL(page.url()).searchParams.get('room'),room)
  }
  assert.deepEqual(await card.locator('.wi-vehicle-option[tabindex="0"], .wi-vehicle input').evaluateAll(es=>es.map(el=>el.dataset.tint??'vehicle')),['vehicle','body','accent'],'vehicle and colours retain DOM focus order')
  if(mode==='desktop'){
   await vehicle.locator('[aria-checked=true]').focus();await page.keyboard.press('Tab')
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
  assert.equal(await page.locator('.wi-vehicle-picker').count(),1)
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
