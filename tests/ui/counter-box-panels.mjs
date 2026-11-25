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
// And the bottom stack's notices win (v26.11.2403: the real two-line running-slow offer met the box
// at 320 by 568 and the box covered its text). With the game's own offer showing, at 390 by 844 and
// 320 by 568: the box meets no shown stack item, the offer's text is fully visible and both its
// buttons take a tap, the box's top never moves, at 390 the box does not change at all, and after
// a real tap dismisses the offer the box is back whole where it was.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/counter-box-panels.mjs [shot dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const out = process.argv[2]
if (out) (await import('node:fs')).mkdirSync(out, { recursive: true })
/** Wait until `ready` holds and the counter box and the bottom stack have not moved for 6 animation frames. */
const steady = (page, ready, what) => page.waitForFunction(([ready]) => {
  const w = window, look = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return [r.left, r.top, r.width, r.height].map(Math.round).join() + s.opacity + s.visibility + s.display + el.hidden }
  const now = [...document.querySelectorAll('.flash-counter, .flash-counter > *, .bottom-stack > *')].map(look).join('|')
  if (!new Function(`return (${ready})()`)()) { w.__steady = 0; w.__look = null; return false }
  w.__steady = now === w.__look ? (w.__steady ?? 0) + 1 : 0; w.__look = now
  return w.__steady >= 6
}, [ready.toString()], { polling: 'raf', timeout: 60000 }).catch(error => { throw new Error(`${what}: never steady (${error.message.split('\n')[0]})`) })
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
    // The game's own running-slow offer in the bottom stack (two lines on a 320 px phone): the
    // stack's notices win. Shown the way the game shows it, a recommendation in the performance
    // history, held there after each sample until the player dismisses it (as the history does).
    const before = await p.evaluate(() => { const box = document.querySelector('.flash-counter'), b = box.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round).concat(getComputedStyle(box.lastElementChild).display) })
    await p.evaluate(() => {
      const quality = window.mira.game.quality, history = quality.history, level = quality.governor.level
      const offer = Object.freeze({ level, targetLevel: Math.max(0, level - 1), observedFps: 24, bots: 4, fewerBots: false })
      const sample = history.sample.bind(history)
      history.sample = (...args) => { const changed = sample(...args); if (!history.ignored) history.recommendation = offer; return changed }
      history.recommendation = offer
      quality.publishPerformance()
    })
    await steady(p, () => { const o = document.querySelector('.bottom-stack > .performance-recommendation'); return !!o && !o.hidden && Number(getComputedStyle(o).opacity) === 1 }, `${width}x${height} with the offer`)
    const offered = await p.evaluate(() => {
      const box = document.querySelector('.flash-counter'), shownBox = !box.hidden && box.getClientRects().length > 0
      const b = box.getBoundingClientRect(), rect = r => [r.left, r.top, r.right, r.bottom].map(Math.round)
      const items = [...document.querySelectorAll('.bottom-stack > *')].filter(e => !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0)
      const met = shownBox ? items.filter(e => { const r = e.getBoundingClientRect(); return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top }).map(e => e.className.split(' ')[0]) : []
      const offer = document.querySelector('.bottom-stack > .performance-recommendation'), line = offer.querySelector('p'), l = line.getBoundingClientRect()
      // The offer's words: on screen, inside the offer, and under no part of the box. (On touch the
      // words let drags through, pointer-events none, so a hit test cannot see them; geometry can.)
      const o = offer.getBoundingClientRect(), hidden = []
      if (l.left < 0 || l.top < 0 || l.right > innerWidth || l.bottom > innerHeight) hidden.push('off screen')
      if (l.left < o.left - 0.5 || l.right > o.right + 0.5 || l.top < o.top - 0.5 || l.bottom > o.bottom + 0.5) hidden.push('outside the offer')
      if (shownBox && b.left < l.right && b.right > l.left && b.top < l.bottom && b.bottom > l.top) hidden.push('under the box')
      const buttons = [...offer.querySelectorAll('button')].filter(btn => !btn.hidden && btn.getClientRects().length)
      const untappable = buttons.filter(btn => { const r = btn.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== btn }).map(btn => btn.textContent)
      return { shownBox, box: shownBox ? rect(b) : null, tests: getComputedStyle(box.lastElementChild).display, offer: rect(offer.getBoundingClientRect()), text: line.textContent, met, hidden, overflow: line.scrollWidth > line.clientWidth + 1, buttons: buttons.map(btn => btn.textContent), untappable }
    })
    console.log(`${width}x${height} with the offer: ${JSON.stringify(offered)}`)
    if (out) await p.screenshot({ path: `${out}/${width}x${height}-offer.png` })
    assert.deepEqual(offered.met, [], `${width}x${height}: the box meets no shown bottom-stack item`)
    assert.deepEqual(offered.hidden, [], `${width}x${height}: the offer's text is fully visible`)
    assert.ok(!offered.overflow, `${width}x${height}: the offer's text fits its line`)
    assert.equal(offered.buttons.length, 2, `${width}x${height}: the offer shows two buttons`)
    assert.deepEqual(offered.untappable, [], `${width}x${height}: both offer buttons take a tap`)
    // Giving way never moves the box: where it still shows, its top is where it was.
    if (offered.shownBox) assert.equal(offered.box[1], before[1], `${width}x${height}: the box's top does not move`)
    // On the owner's 390 px iPhone the box was already clear: nothing about it changes.
    if (width === 390) assert.ok(offered.shownBox && JSON.stringify(offered.box.concat(offered.tests)) === JSON.stringify(before), `${width}x${height}: the box is unchanged with the offer (${JSON.stringify([before, offered.box, offered.tests])})`)
    // Dismissed by a real tap on the offer's first button (Keep): the box comes back whole.
    await p.locator('.bottom-stack > .performance-recommendation button:not([hidden])').first().tap()
    await steady(p, () => { const o = document.querySelector('.bottom-stack > .performance-recommendation'); const box = document.querySelector('.flash-counter'); return o.hidden && !box.hidden && getComputedStyle(box.lastElementChild).display !== 'none' }, `${width}x${height} after dismissal`)
    const back = await p.evaluate(() => { const box = document.querySelector('.flash-counter'), b = box.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round).concat(getComputedStyle(box.lastElementChild).display) })
    if (out) await p.screenshot({ path: `${out}/${width}x${height}-dismissed.png` })
    assert.deepEqual(back, before, `${width}x${height}: the box is back whole where it was`)
    await phone.close()
  }
  console.log(`ok${webgpu ? '' : ' (Test black not tried: WebGL 2)'}`)
} finally { await browser.close() }
