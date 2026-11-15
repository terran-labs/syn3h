import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
await mkdir('tests/ui/artifacts', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const phone of [false, true]) {
    const device = phone ? 'phone' : 'desktop'
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5187', viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone, isMobile: phone })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if(m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript(() => {
      const request = navigator.gpu.requestAdapter.bind(navigator.gpu)
      const gate = new Promise(resolve => { window.releaseStartup = resolve })
      navigator.gpu.requestAdapter = async (...args) => { await gate; return request(...args) }
    })
    await page.goto(`http://127.0.0.1:5187/?room=fans-${device}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.syn3h-loading').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.loading-phase').textContent(), 'Checking your device')
    assert.equal(await page.locator('.loading-message').textContent(), 'Checking which way is down.')
    await page.waitForTimeout(5200)
    assert.equal(await page.locator('.loading-message').textContent(), 'Tightening the imaginary bolts.')
    await page.screenshot({ path: `tests/ui/artifacts/${device}-new-loading.png` })
    await page.evaluate(() => window.releaseStartup())
    await page.waitForFunction(() => window.syn3h?.game.tick > 25, null, { timeout: 60000 })
    const generated = await page.locator('#shell-name').inputValue()
    assert.match(generated, /^[A-Z][a-z]+$/)
    const seed = await page.evaluate(() => localStorage.getItem('syn3h.nameSeed'))
    assert.equal(generated, await page.evaluate(async seed => (await import('/src/ui/data/names.ts')).generateName(seed, 'player'), seed))
    const panel = async id => { await page.evaluate(id => syn3h.shell.showPanel(id), id); await page.waitForFunction(id => document.querySelector('.lobby-panels').dataset.activePanel === id && document.querySelector('.lobby-panels').dataset.busy === 'false', id) }
    await panel('explore'); await page.screenshot({ path: `tests/ui/artifacts/${device}-generated-name.png` })
    await page.evaluate(() => localStorage.setItem('syn3h.playerName', 'Saved Pilot'))
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof window.releaseStartup === 'function'); await page.evaluate(() => window.releaseStartup())
    await page.waitForFunction(() => window.syn3h?.game.tick > 25, null, { timeout: 60000 })
    assert.equal(await page.locator('#shell-name').inputValue(), 'Saved Pilot')
    await panel('about'); await page.screenshot({ path: `tests/ui/artifacts/${device}-about-fans.png` })
    await page.locator('.shell-credits summary').click()
    await page.locator('.shell-credits li').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `tests/ui/artifacts/${device}-credits.png` })
    for(const href of await page.locator('.shell-credits a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')))) assert.equal((await page.request.get(href)).status(), 200)
    await page.locator('.shell-credits p').last().scrollIntoViewIfNeeded(); await page.screenshot({ path: `tests/ui/artifacts/${device}-credits-audio.png` })
    assert.match(await page.title(), /Syn3h/)
    assert.equal(await page.locator('meta[property="og:image:width"]').getAttribute('content'), '1200')
    const manifest = await (await page.request.get('/brand/manifest.webmanifest')).json()
    assert.equal(manifest.name, 'Syn3h'); for(const icon of manifest.icons) assert.equal((await page.request.get(icon.src)).status(), 200)
    assert.deepEqual(await page.evaluate(async () => { const image = new Image(); image.src='/brand/share.png'; await image.decode(); return [image.naturalWidth,image.naturalHeight] }), [1200,630])
    await panel('multiplayer')
    // The game mode selector is always there now that the Multiplayer lane defines game.mode.
    await page.evaluate(async () => { const { defineParam } = await import('/shared/params.ts'); defineParam({id:'game.mode',label:'Mode',group:'Game',scope:'world',default:0,min:0,max:1,step:1}) })
    await page.locator('#game-mode').selectOption('1')
    assert.equal(await page.evaluate(() => syn3h.params.get('game.mode').value), 1)
    await page.screenshot({ path: `tests/ui/artifacts/${device}-mode-selector.png` })
    await page.evaluate(() => { window.syn3hNet = { canEditWorld:false, isHost:false, locked:true }; syn3h.shell.update() })
    assert.equal(await page.locator('#game-mode').isDisabled(), true)
    await page.evaluate(() => { delete window.syn3hNet; syn3h.shell.play() })
    await page.waitForFunction(() => window.syn3hNet?.connected)
    const state = { mode:'koth', holderName:null, holderIsYou:false, contested:false, scores:[{name:'Nolitek',score:40},{name:'Boladon',score:32},{name:'Zarivin',score:25},{name:'Saved Pilot',score:18,you:true}], target:60, winner:null }
    const set = value => page.evaluate(value => syn3h.shell.setMatchState(value), value)
    await set(state); assert.match(await page.locator('.hill-holder').textContent(), /unclaimed/)
    await page.screenshot({ path: `tests/ui/artifacts/${device}-hill-unclaimed.png` })
    const yours = {...state,holderName:'Saved Pilot',holderIsYou:true}; await set(yours)
    assert.equal(await page.locator('.match-announcement').textContent(), 'You hold the hill!')
    assert.equal(await page.locator('.match-hud > small').textContent(), '42s to win')
    assert.equal(await page.locator('.match-score.is-you').count(), 1)
    await page.screenshot({ path: `tests/ui/artifacts/${device}-hill-captured.png` })
    await page.waitForTimeout(3000); await set(yours); assert.equal(await page.locator('.match-announcement').isVisible(), false)
    await set({...yours,contested:true}); await page.screenshot({ path: `tests/ui/artifacts/${device}-hill-contested.png` })
    assert.equal(await page.locator('.match-announcement').textContent(), 'Hill contested!')
    await set({...yours,winner:'Saved Pilot',scores:yours.scores.map(row => row.you ? {...row,score:60} : row)}); await page.screenshot({ path: `tests/ui/artifacts/${device}-hill-won.png` })
    assert.equal(await page.locator('.match-announcement').textContent(), 'Saved Pilot wins!')
    if(phone) {
      const match=await page.locator('.match-hud').boundingBox(), map=await page.locator('.shell-minimap').boundingBox(), announcement=await page.locator('.match-announcement').boundingBox(), stick=await page.locator('.touch-stick').boundingBox()
      assert.ok(match.x+match.width < map.x); assert.ok(match.y+match.height < announcement.y); assert.ok(announcement.y+announcement.height < stick.y)
    }
    await set({...yours,holderName:'<img src=x>',winner:null,holderIsYou:false}); assert.equal(await page.locator('.match-hud img').count(),0)
    await set({...state,mode:'tag'}); assert.equal(await page.locator('.match-hud').isVisible(),false)
    assert.deepEqual(errors,[])
    report.push({device,generatedName:generated,loadingRotation:true,credits:true,modeLock:true,hillStates:4,errors})
    await context.close()
  }
  await writeFile('tests/ui/artifacts/fans-hill-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally { await browser.close() }
