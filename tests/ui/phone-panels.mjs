// The panels on touch screens, in WebKit: an iPhone 14 portrait and landscape and an iPad mini
// (744 by 1133) both ways up. What must stay true.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/phone-panels.mjs
// Replaces phone-polish.mjs, which checked a toast against the old top-right Panels tab.
// - Show panels stands over the thumb grid, never under a toast, and clear of the grid.
// - Show panels opens the list; a header opens that card alone; its header goes back to the
//   list; Close panels (or, on a phone, the open panel's X) goes back to driving. A player can always get back to driving.
// - A toast never sits under the open panels.
// - Opening and closing never resizes the game canvas.
// - Every touch screen: no rotated edge tab; Close panels at the foot of the open stack, visible
//   and tappable, and it closes; one margin on the right, top and bottom; one corner radius for
//   the rows, the open panel, the search field, the buttons above and Close panels.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1
const browser = await webkit.launch()
try {
  const ipad = (width, height) => ({ viewport: { width, height }, screen: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  for (const [name, options, phone] of [['portrait', devices['iPhone 14'], true], ['landscape', devices['iPhone 14 landscape'], true], ['ipad-portrait', ipad(744, 1133), false], ['ipad-landscape', ipad(1133, 744), false]]) {
    const context = await browser.newContext({ ...options })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}?autoplay=1&room=phone-panels-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // ?autoplay enters play through the drop, which takes longer than the first ticks.
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    await page.waitForTimeout(800)
    if (await page.locator('.world-inspector').isVisible()) await page.locator('.panels-close').tap()
    await page.locator('.world-inspector').waitFor({ state: 'hidden' })
    // Any resize of the canvas from here on is counted.
    await page.evaluate(() => { const canvas = window.mira.game.canvas; window.__resizes = 0; const size = `${canvas.width}x${canvas.height}`; new ResizeObserver(() => { if (`${canvas.width}x${canvas.height}` !== size) window.__resizes++ }).observe(canvas); window.__size = size })

    const show = page.locator('.inspector-toggle'), grid = page.locator('.touch-actions')
    const showBox = await show.boundingBox(), gridBox = await grid.boundingBox()
    assert.ok(showBox && gridBox, `${name}: Show panels and the thumb grid are on screen`)
    assert.ok(showBox.y + showBox.height <= gridBox.y, `${name}: Show panels stands above the grid ${JSON.stringify([showBox, gridBox])}`)
    await page.evaluate(() => window.mira.shell.toast('Joined room phone-panels as Bartholomew'))
    await page.waitForTimeout(150)
    assert.ok(!overlaps(await page.locator('.shell-toast').boundingBox(), showBox), `${name}: a toast clears Show panels`)

    await show.tap()
    const panels = page.locator('.world-inspector')
    await panels.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.world-inspector .wi-card.is-open').count(), 0, `${name}: Show panels opens the list`)
    assert.equal(await show.evaluate(el => getComputedStyle(el).writingMode), 'horizontal-tb', `${name}: no rotated edge tab`)
    await page.waitForTimeout(300)
    const shape = await page.evaluate(() => {
      const stack = document.querySelector('.world-inspector'), box = stack.getBoundingClientRect()
      const radius = el => parseFloat(getComputedStyle(el).borderTopLeftRadius)
      const items = [...stack.querySelectorAll('.rail-command > :is(input, button), .wi-cards > .wi-card, .panels-close')].filter(el => el.getClientRects().length)
      return { top: Math.round(box.top), right: Math.round(innerWidth - box.right), bottom: Math.round(innerHeight - box.bottom), radii: [...new Set(items.map(radius))] }
    })
    // The bottom is no longer the shared margin: the list runs to the screen's bottom edge (the
    // owner, 26 November 2026); only the right and top margins still match.
    assert.ok(Math.abs(shape.right - shape.top) <= 1, `${name}: one margin right and top ${JSON.stringify(shape)}`)
    assert.equal(shape.radii.length, 1, `${name}: one corner radius across the stack ${JSON.stringify(shape.radii)}`)
    const close = page.locator('.panels-close'), closeBox = await close.boundingBox(), stackBox = await panels.boundingBox()
    assert.ok(closeBox && closeBox.height >= 44 && closeBox.y + closeBox.height <= stackBox.y + stackBox.height + 1, `${name}: Close panels at the foot of the stack, a finger high ${JSON.stringify([closeBox, stackBox])}`)
    await page.evaluate(() => window.mira.shell.toast('A toast while the panels are open'))
    await page.waitForTimeout(150)
    const toast = page.locator('.shell-toast')
    // The panels hide toasts by opacity (exploration.css), which Playwright still calls visible.
    const toastShows = await toast.evaluate(el => !el.hidden && Number(getComputedStyle(el).opacity) > 0.05)
    if (toastShows) assert.ok(!overlaps(await toast.boundingBox(), await panels.boundingBox()), `${name}: a toast never sits under the panels`)

    const head = page.locator('.world-inspector .wi-card .wi-head').first()
    await head.tap(); await page.waitForTimeout(400)
    const openRadius = await page.locator('.world-inspector .wi-card.is-open').first().evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))
    assert.equal(openRadius, shape.radii[0], `${name}: an open panel has the same corners as the rows`)
    if (phone) {
      assert.equal(await page.locator('.world-inspector.is-single').count(), 1, `${name}: a header opens one panel`)
      assert.equal(await page.locator('.world-inspector .wi-cards > .wi-card:visible').count(), 1, `${name}: the open panel is alone`)
    }
    if (phone) {
      // One panel on a phone: its own X is the way back to driving, and Close panels steps aside.
      assert.ok(!(await page.locator('.panels-close').isVisible()), `${name}: Close panels hides while one panel is open`)
      const x = page.locator('.world-inspector .wi-card.is-open > .wi-card-close'), xBox = await x.boundingBox(), cardBox = await page.locator('.world-inspector .wi-card.is-open').boundingBox()
      assert.ok(xBox.width >= 48 && xBox.height >= 48, `${name}: the panel's X is a 48 px target ${JSON.stringify(xBox)}`)
      assert.ok(xBox.x + xBox.width > cardBox.x + cardBox.width - 16 && xBox.y < cardBox.y + 16, `${name}: the X stands in the panel's upper right`)
      await x.tap()
      await panels.waitFor({ state: 'hidden' })
      assert.ok(await show.isVisible(), `${name}: the panel's X returns to driving with Show panels back`)
      await show.tap(); await panels.waitFor({ state: 'visible' }); await page.waitForTimeout(300)
      await head.tap(); await page.waitForTimeout(400)
    } else assert.ok(await page.locator('.panels-close').isVisible(), `${name}: Close panels shows with a panel open`)
    await head.tap(); await page.waitForTimeout(400)
    assert.equal(await page.locator('.world-inspector .wi-card.is-open').count(), 0, `${name}: the panel's header closes it again`)

    await page.locator('.panels-close').tap()
    await panels.waitFor({ state: 'hidden' })
    assert.ok(await show.isVisible(), `${name}: Close panels returns to driving with Show panels back`)
    assert.equal(await page.evaluate(() => window.__resizes), 0, `${name}: opening and closing the panels never resized the canvas`)
    assert.deepEqual(errors, [], `${name}: no page errors`)
    await context.close()
  }
  console.log('Touch panels: placement, states, margins, corners, Close panels, toasts and canvas size passed on iPhone and iPad, both ways up')
} finally { await browser.close() }
