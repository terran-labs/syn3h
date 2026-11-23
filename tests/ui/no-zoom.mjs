/**
 * The page never zooms. On a touch device a zoomed page puts the controls out of reach, so
 * every way Safari zooms is closed: the viewport forbids it, pinch and double-tap are
 * stopped, and no field is small enough to make Safari zoom in when it is focused.
 *
 *   tools/heavy.sh node tests/ui/no-zoom.mjs
 *
 * WebKit at iPad and iPhone sizes. Needs the lane dev server on 5187. What it cannot do is
 * pinch a real screen: that needs a device.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await webkit.launch()
const errors = []
try {
  for (const name of ['iPad Pro 11 landscape', 'iPhone 14']) {
    const context = await browser.newContext({ ...devices[name] }), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
    await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5198/'}?room=no-zoom-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.mira?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
    const viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content)
    for (const part of ['maximum-scale=1', 'minimum-scale=1', 'user-scalable=no']) assert.ok(viewport.includes(part), `${name}: viewport has ${part}`)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), 'manipulation')
    // Pinch (Safari's gesture events), a two-finger move and a double tap are all refused.
    const refused = await page.evaluate(() => {
      const fire = (type, init = {}) => { const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), init); document.body.dispatchEvent(event); return event.defaultPrevented }
      return { gesturestart: fire('gesturestart'), gesturechange: fire('gesturechange'), twoFingerMove: fire('touchmove', { touches: [{}, {}] }), oneFingerMove: fire('touchmove', { touches: [{}] }), doubleTap: fire('dblclick') }
    })
    assert.deepEqual(refused, { gesturestart: true, gesturechange: true, twoFingerMove: true, oneFingerMove: false, doubleTap: true }, name)
    // No field anywhere is under 16px, the size below which Safari zooms in on focus.
    // Every lobby panel there is, so a panel added or removed needs no edit here.
    const panels = await page.locator('.lobby-panels > [data-panel]').evaluateAll(es => es.map(e => e.dataset.panel).filter(id => id !== 'index'))
    assert.ok(panels.length > 0, 'the lobby has panels to check')
    for (const panel of panels) {
      await page.evaluate(id => window.mira.shell.showPanel(id), panel)
      await page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, panel)
      const small = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(el => el.offsetParent !== null && !['range', 'checkbox', 'radio', 'color'].includes(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => `${el.className || el.id || el.tagName} ${getComputedStyle(el).fontSize}`))
      assert.deepEqual(small, [], `${name}: fields under 16px in ${panel}`)
    }
    console.log(JSON.stringify({name,panels}))
    // Typing a name does not leave the page scaled.
    await page.evaluate(() => window.mira.shell.showPanel('explore'))
    await page.locator('#shell-room').tap(); await page.keyboard.type('Zoomless')
    assert.ok(await page.evaluate(() => (window.visualViewport?.scale ?? 1) <= 1.01), `${name}: the page is not scaled after typing`)
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
