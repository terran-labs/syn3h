/**
 * The jet says how to lift off. Its controls card leads with it, and a player who pushes W
 * (or the thumb stick) on the parked jet for two seconds is told which control lifts it:
 * R on a keyboard, the THR + button on touch, which pulses. Using that control lifts the jet.
 *
 *   tools/heavy.sh node tests/ui/jet-hint.mjs
 *
 * Needs the lane dev server on 5187.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/jet-hint'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
const altitude = page => page.evaluate(() => { const s = window.syn3h, p = s.player.body.translation(); return p.y - s.terrain.heightAt(p.x, p.z) })
const card = page => page.evaluate(() => { const c = document.querySelector('.spawn-help'); return c.hidden ? null : { text: c.querySelector('div').textContent, hint: c.classList.contains('is-hint') } })
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1280, height: 720 } }, { name: 'phone', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext(view), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
    await page.goto(`http://127.0.0.1:5187/?room=jet-hint-${view.name}-${Date.now()}&vehicle=jet&autoplay=1`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 40, null, { timeout: 120000 })
    await page.waitForTimeout(800)
    const first = await card(page)
    assert.match(first.text, view.hasTouch ? /^Hold THR \+ to lift off/ : /^Hold R to lift off/, `${view.name}: the card after Play leads with lift-off`)
    await page.screenshot({ path: `${out}/${view.name}-card.png` })
    await page.waitForTimeout(6500) // the card leaves; the jet sits on its gear
    assert.ok(await altitude(page) < 2.5, `${view.name}: the jet is parked`)
    // The visitor's first move: push forward. Nothing happens, so the hint comes.
    let cdp
    if (view.hasTouch) {
      cdp = await context.newCDPSession(page)
      const stick = await page.locator('.touch-stick').boundingBox()
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + 10, id: 1 }] })
    } else await page.keyboard.down('w')
    await page.waitForFunction(() => document.querySelector('.spawn-help.is-hint:not([hidden])'), null, { timeout: 8000 })
    const hint = await card(page)
    assert.equal(hint.text, view.hasTouch ? 'Hold THR + to lift off' : 'Hold R to lift off')
    if (view.hasTouch) assert.equal(await page.locator('.touch-actions [data-action=throttleUp]').evaluate(b => b.classList.contains('is-hinted')), true, 'the THR + button pulses')
    await page.screenshot({ path: `${out}/${view.name}-hint.png` })
    if (view.hasTouch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('w')
    // Doing what it says lifts the jet.
    if (view.hasTouch) {
      const up = await page.locator('.touch-actions [data-action=throttleUp]').boundingBox()
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: up.x + up.width / 2, y: up.y + up.height / 2, id: 2 }] })
    } else await page.keyboard.down('r')
    await page.waitForFunction(() => { const s = window.syn3h, p = s.player.body.translation(); return p.y - s.terrain.heightAt(p.x, p.z) > 6 }, null, { timeout: 15000 })
    if (view.hasTouch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('r')
    await page.screenshot({ path: `${out}/${view.name}-airborne.png` })
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
