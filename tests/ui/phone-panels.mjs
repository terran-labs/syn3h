// Phone panels on an iPhone 14, portrait and landscape, in WebKit: what must stay true.
//   SYN3H_URL=http://127.0.0.1:5213/ node tests/ui/phone-panels.mjs
// Replaces phone-polish.mjs, which checked a toast against the old top-right Panels tab.
// - Show panels stands over the thumb grid, never under a toast, and clear of the grid.
// - Show panels opens the list; a header opens that card alone; its header goes back to the
//   list; Close panels goes back to driving. A player can always get back to driving.
// - A toast never sits under the open panels.
// - Opening and closing never resizes the game canvas.
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5213/'
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1
const browser = await webkit.launch()
try {
  for (const [name, device] of [['portrait', 'iPhone 14'], ['landscape', 'iPhone 14 landscape']]) {
    const context = await browser.newContext({ ...devices[device] })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}?autoplay=1&room=phone-panels-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.locator('.world-inspector').isVisible()) await page.locator('.panels-close').tap()
    await page.locator('.world-inspector').waitFor({ state: 'hidden' })
    // Any resize of the canvas from here on is counted.
    await page.evaluate(() => { const canvas = window.syn3h.game.canvas; window.__resizes = 0; const size = `${canvas.width}x${canvas.height}`; new ResizeObserver(() => { if (`${canvas.width}x${canvas.height}` !== size) window.__resizes++ }).observe(canvas); window.__size = size })

    const show = page.locator('.inspector-toggle'), grid = page.locator('.touch-actions')
    const showBox = await show.boundingBox(), gridBox = await grid.boundingBox()
    assert.ok(showBox && gridBox, `${name}: Show panels and the thumb grid are on screen`)
    assert.ok(showBox.y + showBox.height <= gridBox.y, `${name}: Show panels stands above the grid ${JSON.stringify([showBox, gridBox])}`)
    await page.evaluate(() => window.syn3h.shell.toast('Joined room phone-panels as Bartholomew'))
    await page.waitForTimeout(150)
    assert.ok(!overlaps(await page.locator('.shell-toast').boundingBox(), showBox), `${name}: a toast clears Show panels`)

    await show.tap()
    const panels = page.locator('.world-inspector')
    await panels.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.world-inspector .wi-card.is-open').count(), 0, `${name}: Show panels opens the list`)
    await page.evaluate(() => window.syn3h.shell.toast('A toast while the panels are open'))
    await page.waitForTimeout(150)
    const toast = page.locator('.shell-toast')
    if (await toast.isVisible()) assert.ok(!overlaps(await toast.boundingBox(), await panels.boundingBox()), `${name}: a toast never sits under the panels`)

    const head = page.locator('.world-inspector .wi-card .wi-head').first()
    await head.tap(); await page.waitForTimeout(400)
    assert.equal(await page.locator('.world-inspector.is-single').count(), 1, `${name}: a header opens one panel`)
    assert.equal(await page.locator('.world-inspector .wi-cards > .wi-card:visible').count(), 1, `${name}: the open panel is alone`)
    await head.tap(); await page.waitForTimeout(400)
    assert.equal(await page.locator('.world-inspector.is-single').count(), 0, `${name}: the panel's header goes back to the list`)

    await page.locator('.panels-close').tap()
    await panels.waitFor({ state: 'hidden' })
    assert.ok(await show.isVisible(), `${name}: Close panels returns to driving with Show panels back`)
    assert.equal(await page.evaluate(() => window.__resizes), 0, `${name}: opening and closing the panels never resized the canvas`)
    assert.deepEqual(errors, [], `${name}: no page errors`)
    await context.close()
  }
  console.log('Phone panels: placement, states, toasts and canvas size passed in portrait and landscape')
} finally { await browser.close() }
