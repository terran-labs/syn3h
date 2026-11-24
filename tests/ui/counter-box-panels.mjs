// The diagnostic counter box (ui/flashCounter.ts) never takes a tap meant for the panels. Bug
// caught: on a phone the box, above the panels and taking taps, covered the World, Performance and
// Chat headers (v26.11.2307 and 2308), so the owner could not reach Field switches or Copy
// diagnostics by touch. With the tallest box (?frameProbe=1&frameCanary=1&blank=1) at 390 by 844
// on a touch screen, real taps: open the panels (the box goes), the Performance header,
// Diagnostics, Field switches and Copy diagnostics; close the panels (the box returns, clear of
// the thumb controls and Show panels) and Test black, which the probe must count.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/counter-box-panels.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1
// On a phone an open panel's own X goes back to driving; with the list showing, Close panels does.
async function closePanels(page) {
  const x = page.locator('.world-inspector .wi-card.is-open > .wi-card-close')
  if (await x.count() && await x.first().isVisible()) await x.first().tap()
  else await page.locator('.panels-close').tap()
  await page.locator('.world-inspector').waitFor({ state: 'hidden' })
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&gfx=2&frameProbe=1&frameCanary=1&blank=1&room=counter-box-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game?.tick > 30, null, { timeout: 180000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  await page.waitForTimeout(800)
  if (await page.locator('.world-inspector').isVisible()) await closePanels(page)
  const box = page.locator('.flash-counter')
  await box.waitFor({ state: 'visible' })
  const webgpu = await page.evaluate(() => window.mira.game.backend === 'webgpu')
  // In play: the box clear of the thumb controls and Show panels.
  const boxBox = await box.boundingBox()
  for (const other of ['.touch-actions', '.inspector-toggle']) assert.ok(!overlaps(boxBox, await page.locator(other).boundingBox()), `the box is clear of ${other}`)

  // Open the panels: the box goes at once.
  await page.locator('.inspector-toggle').tap()
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
  assert.equal(await box.isVisible(), false, 'the box hides while the panels are open')
  const card = page.locator('.wi-card[data-section=performance]')
  await card.locator('.wi-head').tap()
  await card.locator('details.performance-diagnostics > summary').tap()
  await card.locator('details.performance-field-switches > summary').tap()
  assert.ok(await card.locator('details.performance-field-switches').evaluate(d => d.open), 'Field switches opened by touch')
  await card.locator('[data-performance=copy-report]').tap()
  await page.waitForFunction(() => document.querySelector('[data-performance=copy-status]')?.textContent || !document.querySelector('[data-performance=copy-text]')?.hidden, null, { timeout: 10000 })
  assert.equal(await box.isVisible(), false)

  // Close the panels: the box returns, and its Test black takes a real tap.
  await closePanels(page)
  await box.waitFor({ state: 'visible', timeout: 2000 })
  if (webgpu) {
    await box.locator('button', { hasText: 'Test black' }).tap()
    await page.waitForFunction(() => window.mira.game.frameProbe.testBad === 1, null, { timeout: 20000 })
  }
  assert.deepEqual(errors, [])
  console.log(`ok${webgpu ? '' : ' (Test black not tried: WebGL 2)'}`)
} finally { await browser.close() }
