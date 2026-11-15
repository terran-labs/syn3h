/**
 * The world inspector in play: every property in sectioned cards with an accordion, a
 * detail pane with description and limits, search, copy and paste of a world as JSON with
 * values checked, and the focus display with its three looks when the cursor is captured.
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/inspector.mjs
 *
 * Needs the lane dev server on 5187.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/inspector'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://127.0.0.1:5187/?room=inspector-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 40, null, { timeout: 120000 })
  await page.waitForTimeout(6500)
  const value = id => page.evaluate(id => window.syn3h.params.get(id).value, id)
  // First view: nothing over the world. The cards are closed and the minimap is in its corner.
  assert.equal(await page.evaluate(() => document.querySelector('.world-inspector').hidden), true)
  const corner = () => page.evaluate(() => innerWidth - document.querySelector('.shell-minimap').getBoundingClientRect().right)
  assert.ok(await corner() < 60, 'minimap is not in its corner on landing')
  await page.screenshot({ path: `${out}/0-landing.png` })
  // Capturing and then releasing the cursor, with Create untouched, surfaces the cards.
  await page.mouse.click(500, 420); await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-focus'), null, { timeout: 5000 })
  await page.evaluate(() => document.exitPointerLock()); await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden, null, { timeout: 5000 })
  assert.ok(await corner() > 300, 'minimap did not step aside for the open cards')
  // Create closes them and the minimap goes back; Create opens them again.
  await page.locator('.inspector-toggle').click(); assert.ok(await corner() < 60, 'minimap did not return')
  await page.locator('.inspector-toggle').click(); await page.waitForTimeout(300)
  // Five cards, each with a summary, holding every registered property between them.
  assert.deepEqual(await page.locator('.wi-card').evaluateAll(cards => cards.map(c => c.dataset.section)), ['world', 'sky', 'game', 'vehicles', 'you'])
  assert.equal(await page.locator('.wi-row').count(), await page.evaluate(() => window.syn3h.params.all().length))
  assert.match(await page.locator('.wi-card[data-section=world] .wi-sum').textContent(), /Volcanic · /)
  await page.screenshot({ path: `${out}/1-closed.png` })
  // Open Sky & weather: an accordion of groups; pointing at a property explains it.
  await page.locator('.wi-card[data-section=sky] .wi-head').click()
  assert.deepEqual(await page.locator('.wi-card[data-section=sky] .wi-group summary span').allTextContents(), ['Sun', 'Sky', 'Weather'])
  await page.locator('.wi-row[data-id="sun.timeOfDay"]').hover()
  assert.match(await page.locator('.wi-detail').textContent(), /The hour on this world/)
  assert.match(await page.locator('.wi-detail small').textContent(), /0 to 24 · default 16\.5 · shared with everyone in the room/)
  // Moving a slider changes the world.
  await page.locator('.wi-row[data-id="sun.timeOfDay"] input').fill('9')
  assert.equal(await value('sun.timeOfDay'), 9)
  await page.waitForTimeout(600); await page.screenshot({ path: `${out}/2-open-detail.png` })
  // Search reaches anything.
  await page.locator('.wi-search').fill('bots'); await page.waitForTimeout(200)
  assert.ok(await page.locator('.wi-row:visible').count() >= 1); assert.ok(await page.locator('.wi-row[data-id="bots.count"]').isVisible())
  await page.locator('.wi-row[data-id="bots.count"] input').fill('3'); assert.equal(await value('bots.count'), 3)
  await page.screenshot({ path: `${out}/3-search.png` })
  await page.locator('.wi-search').fill('')
  // Copy the world: valid JSON holding shared properties only.
  await page.locator('[data-wi=copy-world]').click()
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  assert.equal(copied.syn3h, 'world'); assert.equal(copied.values['sun.timeOfDay'], 9); assert.equal(copied.values['bots.count'], 3)
  assert.ok(!Object.keys(copied.values).some(id => id.startsWith('camera.') || id.startsWith('audio.') || id.startsWith('hud.')), 'no personal settings in a world')
  // Paste a world: values out of range are pulled inside, unknown and personal ones left out.
  await page.evaluate(() => navigator.clipboard.writeText(JSON.stringify({ syn3h: 'world', version: 1, values: { 'sun.timeOfDay': 99, 'bots.count': 1, 'made.up': 5, 'camera.sensitivity': 3.9 } })))
  const sensitivity = await value('camera.sensitivity')
  await page.locator('[data-wi=paste-world]').click(); await page.locator('.wi-sheet:not([hidden])').waitFor()
  await page.screenshot({ path: `${out}/4-paste.png` })
  await page.locator('[data-wi=apply]').click()
  assert.equal(await value('sun.timeOfDay'), 24); assert.equal(await value('bots.count'), 1); assert.equal(await value('camera.sensitivity'), sensitivity)
  assert.match(await page.locator('.wi-status').textContent(), /2 properties pasted, 1 pulled inside limits, 2 left out\./)
  await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 16.5))
  // Named choices are buttons, and the Glass setting changes the cards.
  await page.locator('.wi-card[data-section=you] .wi-head').click()
  await page.locator('.wi-row[data-id="hud.glass"] button', { hasText: 'Deep' }).click(); assert.equal(await value('hud.glass'), 2)
  await page.waitForFunction(() => document.querySelector('.syn3h-shell').dataset.glass === '2')
  await page.screenshot({ path: `${out}/5-glass-deep.png` })
  await page.locator('.wi-row[data-id="hud.glass"] button', { hasText: 'Frosted' }).click()
  // The Vehicles card offers the vehicles and marks the one in use.
  await page.locator('.wi-card[data-section=vehicles] .wi-head').click()
  assert.ok(await page.locator('[data-vehicle]').count() >= 4); assert.equal(await page.locator('[data-vehicle].is-on').count(), 1)
  // Capture the cursor: the cards fade away and the focus display fades in, in three looks.
  await page.mouse.click(500, 420)
  await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-focus'), null, { timeout: 5000 })
  await page.waitForTimeout(900)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.world-inspector')).opacity), '0')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.focus-hud')).opacity), '1')
  await page.keyboard.down('w')
  for (const [style, name, reticle] of [[0, 'arc', 1], [1, 'horizon', 0], [2, 'telemetry', 2]]) {
    await page.evaluate(([style, reticle]) => { window.syn3h.params.set('hud.focusStyle', style); window.syn3h.params.set('hud.reticle', reticle) }, [style, reticle])
    await page.waitForTimeout(1200)
    assert.equal(await page.locator(`.focus-hud [data-style="${style}"]`).first().evaluate(el => getComputedStyle(el).display !== 'none'), true)
    await page.screenshot({ path: `${out}/6-focus-${name}.png` })
  }
  await page.keyboard.up('w')
  // Letting the cursor go brings the full interface back.
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.querySelector('.syn3h-shell').classList.contains('is-focus'))
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.world-inspector')).opacity), '1')
  console.log(JSON.stringify({ ok: true, properties: await page.locator('.wi-row').count(), errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
