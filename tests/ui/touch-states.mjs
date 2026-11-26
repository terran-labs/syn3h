// The thumb buttons' states on a phone (the owner, 26 November 2026), in Flat (the default style)
// and Liquid, upright and sideways. Bugs it catches:
// - a switched-on Zorb or Wings that looks like off (Flat painted both the same tint);
// - an on look that fades after a while or when another button is pressed;
// - in Flat, a button with no held look, or one that loses it before the finger lifts (the owner,
//   26 November 2026: "All flat buttons need an active state"); rest, held, on and held while on
//   must all differ;
// - the sunk buggy's Zorb cue not reaching the button.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/touch-states.mjs [frames dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
/** What a button looks like: its painted body and ring, and the glass's own on-state numbers. */
const lookOf = (page, selector) => page.evaluate((sel) => {
  const b = document.querySelector(sel), s = getComputedStyle(b)
  // A colour as the bytes it paints (the same colour can be written as rgb, oklab or color()).
  const c = (window.__px ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true }))
  const bytes = (colour) => { c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = colour; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].join(',') }
  return [bytes(s.backgroundColor), s.backgroundImage, s.boxShadow.replace(/(rgba?|oklab|color)\([^)]*\)/g, bytes), s.getPropertyValue('--glass-rim').trim(), s.getPropertyValue('--glass-sheen').trim()].join(' | ')
}, selector)
const look = (page, action) => lookOf(page, `.touch-actions [data-action=${action}]`)
/** A real touch held on a button (CDP, so :active applies as on a phone): its look at 300 ms and 600 ms. */
async function held(page, cdp, selector) {
  const r = await page.locator(selector).boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  // Sampled once the press's own short colour change has finished, and again later in the press.
  await page.waitForTimeout(300); const early = await lookOf(page, selector)
  await page.waitForTimeout(300); const late = await lookOf(page, selector)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(250)
  return { early, late }
}
// A tap, then the button's own colour and size transitions run out before anything is read.
const tap = async (page, action) => {
  await page.locator(`.touch-actions [data-action=${action}]`).tap(); await page.waitForTimeout(100)
  await page.waitForFunction((a) => document.querySelector(`.touch-actions [data-action=${a}]`).getAnimations().every((x) => x.playState !== 'running'), action, { timeout: 5000 })
}

try {
  for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    for (const [style, value] of [['flat', 2], ['liquid', 0]]) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      const page = await context.newPage()
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${base}?autoplay=1&vehicle=buggy&room=touch-states-${label}-${style}-${Date.now()}`)
      await page.waitForFunction(() => window.mira?.shell?.playing && !window.mira.shell.transitioning, null, { timeout: 180000 })
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
      await page.evaluate((v) => window.mira.params.set('hud.glass', v), value)
      await page.waitForFunction((s) => document.documentElement.dataset.glassMaterial === s, style, { timeout: 10000 })
      await page.locator('.touch-actions [data-action=zorb]').waitFor({ state: 'visible' })
      await page.waitForTimeout(600)
      const at = `${label} ${style}`
      const cdp = await context.newCDPSession(page)
      if (style === 'flat') {
        // Held, for as long as the finger is down: Brake (momentary), Wings off, Wings held while
        // on (it differs from on), then the Panels control and, with the panels open, Close.
        const check = async (selector, against, what) => {
          const base = against ?? await lookOf(page, selector), h = await held(page, cdp, selector)
          // Different from rest early in the press and still late in it (the tint itself may still be
          // easing in after the style switch, so the two samples need not be identical).
          assert.ok(h.early !== base && h.late !== base, `${at}: ${what} held looks different, for the whole press ${JSON.stringify({ base, ...h })}`)
        }
        await check('.touch-actions [data-action=brakes]', null, 'Brake')
        await check('.touch-actions [data-action=special]', null, 'Wings')
        await page.waitForFunction(() => document.querySelector('.touch-actions [data-action=special]').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 })
        await check('.touch-actions [data-action=special]', await look(page, 'special'), 'Wings, while on,')
        await page.waitForFunction(() => document.querySelector('.touch-actions [data-action=special]').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 })
        await check('.hud-navigation .inspector-toggle', null, 'Panels')
        await page.locator('.world-inspector .panels-close').waitFor({ state: 'visible', timeout: 10000 })
        await page.waitForTimeout(500)
        await check('.world-inspector .panels-close', null, 'Close panels')
        await page.locator('.world-inspector').waitFor({ state: 'hidden', timeout: 10000 })
        await page.waitForTimeout(500)
      }
      for (const action of ['zorb', 'special']) {
        const off = await look(page, action)
        await tap(page, action)
        await page.waitForFunction((a) => document.querySelector(`.touch-actions [data-action=${a}]`).getAttribute('aria-pressed') === 'true', action, { timeout: 5000 })
        await page.waitForFunction((a) => document.querySelector(`.touch-actions [data-action=${a}]`).getAnimations().every((x) => x.playState !== 'running'), action, { timeout: 5000 })
        const on = await look(page, action)
        assert.notEqual(on, off, `${at}: ${action} on looks different from off`)
        if (out && action === 'zorb') await page.screenshot({ path: `${out}/${label}-${style}-zorb-on.png` })
        await page.waitForTimeout(2000)
        assert.equal(await look(page, action), on, `${at}: ${action} still looks on after 2 s`)
        await tap(page, 'brakes')
        assert.equal(await look(page, action), on, `${at}: ${action} still looks on after another button is pressed`)
        await tap(page, action)
        await page.waitForFunction((a) => document.querySelector(`.touch-actions [data-action=${a}]`).getAttribute('aria-pressed') === 'false', action, { timeout: 5000 })
      }
      // The sunk buggy's Zorb cue reaches the button (its look is judged from frames).
      // (The game asks every frame whether to cue, and this buggy is not sunk: hold its answer off.)
      await page.evaluate(() => { const sh = window.mira.shell; sh.cueZorb(true); sh.__cue = sh.cueZorb; sh.cueZorb = () => {} })
      await page.waitForTimeout(200)
      assert.ok(await page.locator('.touch-actions [data-action=zorb].is-cued').count(), `${at}: the Zorb cue is on the button`)
      await page.evaluate(() => { const sh = window.mira.shell; sh.cueZorb = sh.__cue; sh.cueZorb(false) })
      console.log(`${at}: ok`)
      await context.close()
    }
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.log('touch-states: ok')
} finally { await browser.close() }
