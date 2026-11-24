// Field switches in Performance, Diagnostics (core/fieldSwitches.ts). What must stay true:
// - A box and its link switch are one state: opened with ?shadows=0 its box is ticked, and a box
//   ticked in play puts its switch in the address.
// - A live switch changes the parameter it names at once (shadows, lowrest), and lets go of it.
// - Nothing is written to saved preferences (localStorage, sessionStorage) by any switch.
// - The copied Diagnostics report names every switch that is on, however it was set.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/field-switches.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)))
  await page.goto(`${base}?autoplay=1&shadows=0&room=field-switches-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
  const card = page.locator('.wi-card[data-section=performance]')
  if (!(await card.evaluate(el => el.classList.contains('is-open')))) await card.locator('.wi-head').click()
  await card.locator('details.performance-diagnostics > summary').click()
  const fold = card.locator('details.performance-field-switches')
  await fold.locator('summary').click()
  const row = link => fold.locator(`.field-switch[data-switch="${link}"]`)
  const ticked = link => row(link).locator('input').isChecked()
  const param = id => page.evaluate(id => mira.params.get(id)?.value, id)
  // Saved preferences: all of localStorage, and sessionStorage but for the session's own resume
  // point (position and room, rewritten every few seconds by play itself).
  const storage = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage).filter(([k]) => !k.startsWith('mira.resume')).sort()]))

  // From the link to the box. Sun shadows are off, so how they are drawn is not offered.
  assert.equal(await fold.locator('.field-switch-block[data-group="Sun shadows"]').isVisible(), false, 'with sun shadows off, their switches are hidden')
  assert.equal(await ticked('shadows=0'), true, 'opened with ?shadows=0, its box is ticked')
  assert.equal(await param('gfx.shadowQuality'), 0, '?shadows=0 holds sun shadows off')
  const saved = await storage()

  // From the box to the link and the game, live, and back.
  await row('shadows=0').click()
  assert.equal(await ticked('shadows=0'), false)
  assert.ok(!(await page.evaluate(() => location.search)).includes('shadows=0'), 'unticked, the switch leaves the address')
  assert.notEqual(await param('gfx.shadowQuality'), 0, 'unticked, sun shadows return to the level')
  // How shadows are drawn shows only while they are drawn; the map size is one choice.
  const shadowBlock = fold.locator('.field-switch-block[data-group="Sun shadows"]')
  assert.ok(await shadowBlock.isVisible(), 'with sun shadows on, their switches show')
  await shadowBlock.locator('.field-switch-choice[data-switch=shadowMap] button', { hasText: '1024' }).click()
  assert.ok((await page.evaluate(() => location.search)).includes('shadowMap=1024'), 'the shadow map choice is in the address')
  assert.ok(await fold.locator('[data-performance=reload-switches]').isVisible(), 'a shadow switch offers the reload')
  await shadowBlock.locator('.field-switch-choice[data-switch=shadowMap] button', { hasText: 'Level' }).click()
  assert.ok(!(await page.evaluate(() => location.search)).includes('shadowMap'), 'Level clears the shadow map choice')
  await row('lowrest=1').click()
  assert.equal(await param('water.rippleSize'), 64, 'ticked, ?lowrest=1 holds the water ripples at Low')
  assert.ok((await page.evaluate(() => location.search)).includes('lowrest=1'), 'ticked, the switch is in the address')

  // ?post=off drops the post chain at once, and unticking brings it back.
  await row('post=off').click()
  assert.equal(await page.evaluate(() => mira.game.postChain === null), true, 'ticked, ?post=off draws without the post chain')
  await page.waitForTimeout(500)
  await row('post=off').click()
  assert.equal(await page.evaluate(() => mira.game.postChain !== null), true, 'unticked, the post chain is back')

  // Every switch on and off again: nothing saved, and the report names what is on.
  for (const link of ['shading=0', 'post=base', 'freeze=1', 'ui=flat', 'blank=1', 'samples=1', 'webgl=1', 'gpuTrace=1']) await row(link).click()
  assert.ok(await fold.locator('[data-performance=reload-switches]').isVisible(), 'a reload-only switch offers the reload')
  await card.locator('[data-performance=copy-report]').click()
  await page.waitForFunction(() => /copied|Select and copy/.test(document.querySelector('[data-performance=copy-status]')?.textContent ?? ''))
  const report = await page.evaluate(async () => { const field = document.querySelector('[data-performance=copy-text]'); return field.hidden ? navigator.clipboard.readText() : field.value })
  const line = report.split('\n').find(l => l.startsWith('Flash switches:')) ?? ''
  for (const name of ['lowrest=1', 'shading=0', 'post=base', 'freeze=1', 'ui=flat', 'blank=1', 'samples=1']) assert.ok(line.includes(name), `the report names ${name}: ${line}`)
  await fold.locator('[data-performance=copy-switch-link]').click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  for (const name of ['lowrest=1', 'shading=0', 'post=base', 'freeze=1', 'ui=flat', 'blank=1', 'samples=1', 'webgl=1', 'gpuTrace=1']) assert.ok(link.includes(name), `the copied link carries ${name}: ${link}`)
  for (const link of ['lowrest=1', 'shading=0', 'post=base', 'freeze=1', 'ui=flat', 'blank=1', 'samples=1', 'webgl=1', 'gpuTrace=1']) await row(link).click()
  const now = await storage()
  if (now !== saved) { const [a, b] = [JSON.parse(saved), JSON.parse(now)]; const diff = [0, 1].flatMap(i => { const x = new Map(a[i]), y = new Map(b[i]); return [...new Set([...x.keys(), ...y.keys()])].filter(k => x.get(k) !== y.get(k)).map(k => `${i ? 'session' : 'local'} ${k}: ${x.get(k)} -> ${y.get(k)}`) }); assert.fail(`a switch wrote to saved preferences: ${diff.join('; ')}`) }
  assert.deepEqual(errors, [])

  // A touch device under WebGPU: the sun shadow gate holds shadows off, its row says so, and
  // forcing it on is ?shadows=1, live.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const tap = await phone.newPage()
  await tap.goto(`${base}?autoplay=1&room=field-switches-phone-${Date.now()}`)
  await tap.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await tap.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  if (await tap.evaluate(() => mira.game.backend === 'webgpu')) {
    if (!(await tap.locator('.world-inspector').isVisible())) await tap.locator('.inspector-toggle').tap()
    const pcard = tap.locator('.wi-card[data-section=performance]')
    await pcard.locator('.wi-head').tap()
    await pcard.locator('details.performance-diagnostics > summary').tap()
    await pcard.locator('details.performance-field-switches > summary').tap()
    const gate = pcard.locator('.field-switch[data-gate=sun-shadows]')
    assert.ok(await gate.isVisible(), 'phone: the sun shadow gate has its row')
    assert.equal(await tap.evaluate(() => mira.params.get('gfx.shadowQuality').value), 0, 'phone: the gate holds sun shadows off')
    await gate.tap()
    assert.notEqual(await tap.evaluate(() => mira.params.get('gfx.shadowQuality').value), 0, 'phone: forced on, sun shadows return at once')
    assert.ok((await tap.evaluate(() => location.search)).includes('shadows=1'), 'phone: forced on is ?shadows=1')
  } else console.log('phone: WebGL 2 here, no sun shadow gate to check')
  await phone.close()
  console.log('field switches ok')
} finally { await browser.close() }
