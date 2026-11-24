// The Performance card's Diagnostics fold stays as the player sets it. Bug caught: a fold opened
// by a click shut itself again when a performance snapshot was published before the fold's
// toggle event (the snapshot still said "not visible"), more often under load; it is in the game
// since 15 November 2026 and made blank-frames.mjs fail intermittently. Also: F3 still opens
// and closes it.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/diagnostics-fold.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)))
  await page.goto(`${base}?autoplay=1&room=diagnostics-fold-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
  const card = page.locator('.wi-card[data-section=performance]')
  if (!(await card.evaluate(el => el.classList.contains('is-open')))) await card.locator('.wi-head').click()
  const fold = card.locator('details.performance-diagnostics')
  await card.locator('details.performance-diagnostics > summary').waitFor({ state: 'visible' })
  assert.equal(await fold.evaluate(el => el.open), false, 'Diagnostics starts closed')

  // The player clicks Diagnostics, and a snapshot is published before the fold's toggle event.
  // (A mutation observer runs right after the fold opens and before its toggle event task.)
  await page.evaluate(() => {
    const fold = document.querySelector('details.performance-diagnostics')
    const watch = new MutationObserver(() => { watch.disconnect(); mira.game.quality.publishPerformance() })
    watch.observe(fold, { attributes: true, attributeFilter: ['open'] })
  })
  await card.locator('details.performance-diagnostics > summary').click()
  await page.waitForTimeout(1500)
  assert.equal(await fold.evaluate(el => el.open), true, 'Diagnostics stays open after the player opens it')
  assert.ok(await card.locator('[data-performance=copy-report]').isVisible(), 'its actions are there to use')

  // F3, the other way in, still closes and opens it.
  await page.keyboard.press('F3'); await page.waitForTimeout(300)
  assert.equal(await fold.evaluate(el => el.open), false, 'F3 closes Diagnostics')
  await page.keyboard.press('F3'); await page.waitForTimeout(300)
  assert.equal(await fold.evaluate(el => el.open), true, 'F3 opens Diagnostics')
  assert.deepEqual(errors, [])
  console.log('diagnostics fold ok')
} finally { await browser.close() }
