/**
 * The focus display in play. Bugs caught: the panels staying up while the player drives with
 * the cursor captured, the aiming display missing in one of its three looks, the aiming
 * display staying over a menu while input is suspended, and the panels not coming back when
 * the cursor is let go.
 *
 *   SYN3H_URL=http://127.0.0.1:5173/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/inspector.mjs
 *
 * The cards, search and folds are checked by sidebar.mjs and inspector-edit.mjs, the vehicle
 * picker by discoverability.mjs, and a world's JSON (copy, paste, limits) by inspector.test.ts.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/inspector'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'}?room=inspector-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 40, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  // On arrival the browser may or may not have granted the cursor. Either way the panels
  // show exactly when it is free.
  assert.equal(await page.evaluate(() => document.querySelector('.world-inspector').hidden), await page.evaluate(() => !!document.pointerLockElement))
  if (await page.evaluate(() => !!document.pointerLockElement)) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden) }
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
    assert.equal(await page.locator(`.focus-hud [data-style="${style}"]`).first().evaluate(el => getComputedStyle(el).display !== 'none'), true, `${name} look shows`)
    await page.screenshot({ path: `${out}/focus-${name}.png` })
  }
  await page.keyboard.up('w')
  // Suspended input hides the aiming display even if the browser still holds the cursor.
  await page.evaluate(() => { window.syn3h.game.input.suspended = true })
  await page.waitForFunction(() => !document.querySelector('.syn3h-shell').classList.contains('is-focus'))
  await page.evaluate(() => { window.syn3h.game.input.suspended = false })
  await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-focus'))
  // Letting the cursor go brings the full interface back.
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.querySelector('.syn3h-shell').classList.contains('is-focus'))
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.world-inspector')).opacity === '1')
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
