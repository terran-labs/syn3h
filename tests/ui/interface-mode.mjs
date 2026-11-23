// Invariant: the Hidden interface (hud.mode 2) never strands a player. Escape pauses, shows
// the pause screen and returns the interface to Full.
//
//   node tests/ui/interface-mode.mjs      (game on MIRA_URL)
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5198/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?room=interface-mode-${Date.now()}&autoplay=1`)
  await page.waitForFunction(() => window.mira?.shell?.playing && !window.mira.shell.dropping, null, { timeout: 120000 })
  await page.evaluate(() => document.activeElement?.blur?.())
  // I cycles Full, Driving, Hidden.
  await page.keyboard.press('KeyI'); await page.keyboard.press('KeyI')
  assert.equal(await page.evaluate(() => window.mira.params.get('hud.mode').value), 2)
  assert.equal(await page.evaluate(() => document.body.classList.contains('is-bare-interface')), true, 'Hidden hides the interface')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.mira.params.get('hud.mode').value === 0, null, { timeout: 5000 })
  await page.locator('.pause-veil').waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(await page.evaluate(() => document.body.classList.contains('is-bare-interface')), false)
  assert.deepEqual(errors, [])
  console.log('interface-mode: ok')
} finally { await browser.close() }
