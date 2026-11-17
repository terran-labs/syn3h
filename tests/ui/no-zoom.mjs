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
import { devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await webkit.launch()
const errors = []
try {
  for (const name of ['iPad Pro 11 landscape', 'iPhone 14']) {
    const context = await browser.newContext({ ...devices[name] }), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
    await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5198/'}?room=no-zoom-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
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
    const testedPanels = []
    for (const panel of ['explore', 'worlds', 'advanced', 'about']) {
      assert.equal(await page.locator(`[data-panel="${panel}"]`).count(),1)
      testedPanels.push(panel)
      await page.evaluate(id => window.syn3h.shell.showPanel(id), panel)
      await page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, panel)
      const small = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(el => el.offsetParent !== null && !['range', 'checkbox', 'radio', 'color'].includes(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => `${el.className || el.id || el.tagName} ${getComputedStyle(el).fontSize}`))
      assert.deepEqual(small, [], `${name}: fields under 16px in ${panel}`)
    }
    assert.equal(testedPanels.length,4)
    console.log(JSON.stringify({name,testedPanels,count:testedPanels.length}))
    // Settings: the Daydream slider is there, fits the screen, and using it does not scale the page.
    await page.evaluate(() => window.syn3h.shell.showPanel('settings'))
    await page.waitForFunction(() => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === 'settings' && p.dataset.busy === 'false' })
    const daydream = await page.evaluate(() => { const el = document.querySelector('.daydream-control'); if (!el) return null; const r = el.getBoundingClientRect(), input = el.querySelector('input'); return { left: r.left, right: r.right, width: r.width, text: el.textContent.trim(), type: input?.type, view: innerWidth } })
    assert.ok(daydream, `${name}: Settings has the Daydream control`)
    assert.ok(daydream.width > 120 && daydream.left >= 0 && daydream.right <= daydream.view, `${name}: the Daydream control fits (${Math.round(daydream.left)} to ${Math.round(daydream.right)} of ${daydream.view})`)
    assert.equal(daydream.type, 'range'); assert.match(daydream.text, /Daydream/)
    await page.locator('.daydream-control input').scrollIntoViewIfNeeded(); await page.locator('.daydream-control input').tap()
    assert.ok(await page.evaluate(() => (window.visualViewport?.scale ?? 1) <= 1.01), `${name}: using the Daydream slider does not scale the page`)
    await page.screenshot({ path: `tests/ui/artifacts/settings-${name.replace(/\W+/g, '-')}.png` })
    // Typing a name does not leave the page scaled.
    await page.evaluate(() => window.syn3h.shell.showPanel('explore'))
    await page.locator('#shell-room').tap(); await page.keyboard.type('Zoomless')
    assert.ok(await page.evaluate(() => (window.visualViewport?.scale ?? 1) <= 1.01), `${name}: the page is not scaled after typing`)
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
