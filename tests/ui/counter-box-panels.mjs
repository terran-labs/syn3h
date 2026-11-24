// The diagnostic counter box (ui/flashCounter.ts) never takes a tap meant for the panels. Bug
// caught: on a phone the box, above the panels and taking taps, covered the World, Performance and
// Chat headers (v26.11.2307 and 2308), so the owner could not reach Field switches or Copy
// diagnostics by touch. With the tallest box (?frameProbe=1&frameCanary=1&blank=1) at 390 by 844
// on a touch screen, real taps: open the panels (the box goes), the Performance header,
// Diagnostics, Field switches and Copy diagnostics; close the panels (the box returns, clear of
// the thumb controls and Show panels) and Test black, which the probe must count.
// And the box fits: the owner reads its numbers off his phone, and a line ran past the box's right
// edge (v26.11.2402). At 390 by 844 and 320 by 568, with all three counters on and the longest
// realistic numbers (five-digit frame counts, three-digit counts, a last bad frame each), no text
// overflows its line or the box, the box is on screen, and it clears the speed and altitude, the
// thumb controls, the minimap, Show panels and whatever the bottom stack holds.
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
    await box.locator('button[aria-label="Test black"]').tap()
    await page.waitForFunction(() => window.mira.game.frameProbe.testBad === 1, null, { timeout: 20000 })
  }
  assert.deepEqual(errors, [])
  await context.close()

  // The box fits, at both phone sizes, with the longest realistic numbers in every counter.
  for (const [width, height] of [[390, 844], [320, 568]]) {
    const phone = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const p = await phone.newPage()
    await p.goto(`${base}?autoplay=1&gfx=2&frameProbe=1&frameCanary=1&blank=1&room=counter-fit-${Date.now()}`)
    await p.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    await p.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    await p.waitForTimeout(800)
    if (await p.locator('.world-inspector').isVisible()) await closePanels(p)
    await p.locator('.flash-counter').waitFor({ state: 'visible' })
    if (!await p.evaluate(() => !!(window.mira.game.frameProbe && window.mira.game.frameCanary))) { console.log(`${width}x${height}: skipped, WebGL 2`); await phone.close(); continue }
    await p.evaluate(() => {
      const g = window.mira.game, probe = g.frameProbe, canary = g.frameCanary, recorder = g.blankFrames, now = performance.now() / 1000
      Object.assign(probe.counts, { 'output black': 123, 'output clear': 123, 'scene black': 123, 'scene NaN': 123 })
      probe.probed = 98765; probe.nonFiniteFrames = 123; probe.testsAsked = 123; probe.testBad = 123
      probe.lastBad.push({ frame: 98765, at: now, what: 'output clear, scene NaN (test)', recent: ['-12.3 s quality level 2 rung 0'] })
      for (let i = 0; i < 123; i++) probe.badTimes.push(now)
      canary.dropped = 123; canary.checked = 98765; canary.withheld = 123
      canary.lastDropped.push({ seq: 1, frame: 98765, at: now, recent: [] }, { seq: 2, frame: 98766, at: now, recent: [] })
      Object.assign(recorder, { blank: 123, partly: 123, testsAsked: 123, testsSeen: 123 })
    })
    await p.waitForTimeout(600)
    const fit = await p.evaluate(() => {
      const box = document.querySelector('.flash-counter'), b = box.getBoundingClientRect()
      const over = [...box.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > b.right + 0.5 || e.getBoundingClientRect().left < b.left - 0.5)
        .map(e => `${e.tagName} ${e.textContent.slice(0, 40)}`)
      const clash = (sel) => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
      }).map(e => sel)
      return {
        box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], over, text: box.textContent,
        onScreen: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
        clashes: ['.fh-read', '.touch-actions', '.touch-stick', '.shell-minimap', '.inspector-toggle', '.bottom-stack > *'].flatMap(clash),
      }
    })
    console.log(`${width}x${height}: box ${JSON.stringify(fit.box)}; ${JSON.stringify(fit.text)}`)
    assert.deepEqual(fit.over, [], `${width}x${height}: no text overflows the box`)
    assert.ok(fit.onScreen, `${width}x${height}: the box is on screen`)
    assert.deepEqual(fit.clashes, [], `${width}x${height}: the box clears the readouts, the thumb controls, the minimap and the bottom stack`)
    assert.match(fit.text, /98765/, 'the numbers are in the box')
    // A notice in the bottom stack (the slow-frames offer sits above the thumbs on a phone) must
    // not meet the box either: put one there and measure again.
    const withNotice = await p.evaluate(async () => {
      const notice = document.createElement('div')
      notice.className = 'performance-recommendation'
      notice.style.cssText = 'display:block;min-height:44px;width:260px;background:#333'
      notice.textContent = 'Running slow at Medium. Try fewer bots?'
      document.querySelector('.bottom-stack').append(notice)
      await new Promise(r => setTimeout(r, 400))
      const a = document.querySelector('.flash-counter').getBoundingClientRect(), n = notice.getBoundingClientRect()
      notice.remove()
      return { box: [Math.round(a.top), Math.round(a.bottom)], notice: [Math.round(n.top), Math.round(n.bottom)], clear: a.bottom <= n.top || a.top >= n.bottom || a.right <= n.left || a.left >= n.right }
    })
    assert.ok(withNotice.clear, `${width}x${height}: the box clears a bottom-stack notice ${JSON.stringify(withNotice)}`)
    await phone.close()
  }
  console.log(`ok${webgpu ? '' : ' (Test black not tried: WebGL 2)'}`)
} finally { await browser.close() }
