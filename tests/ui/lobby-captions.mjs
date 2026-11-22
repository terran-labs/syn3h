// Planet captions never touch the lobby's own controls. Bug caught (staging, an iPad mini, 21
// November 2026): a planet caption drew over the Settings button with the Settings card open,
// and another sat between the card's foot and the button. While the galaxy turns, at iPad mini
// and phone sizes, with Settings closed and open, no caption that can be seen may come within a
// few pixels of the buttons in the lower right, the settings card or the version text.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-captions.mjs
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const sizes = [
  ['ipad-portrait', { viewport: { width: 744, height: 1133 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['ipad-landscape', { viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['phone', devices['iPhone 14']],
]
const browser = await webkit.launch()
try {
  for (const [name, options] of sizes) {
    const page = await browser.newPage(options)
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?room=lobby-captions-${name}-${Date.now()}`)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && !window.syn3h?.shell?.galaxy?.opening && !document.documentElement.dataset.opening, null, { timeout: 180000 })
    await page.waitForTimeout(1500)
    // Captions that can be seen, and any that touch a control (2 px of slack for rounding).
    const touching = () => page.evaluate(() => {
      const controls = ['.lobby-gear-dock', '.lobby-version-dock .lobby-version', '#lobby-settings'].map(s => document.querySelector(s)).filter(Boolean)
        .map(el => ({ what: el.className, r: el.getBoundingClientRect() })).filter(c => c.r.width && c.r.height)
      const hit = (a, b) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2
      return [...document.querySelectorAll('.galaxy-label')].filter(l => !l.hidden && Number(getComputedStyle(l).opacity) > 0.05)
        .flatMap(l => controls.filter(c => hit(l.getBoundingClientRect(), c.r)).map(c => `${l.textContent.trim()} over ${c.what}`))
    })
    for (const open of [false, true]) {
      if (open) { await page.locator('.lobby-gear-dock .lobby-gear').tap(); await page.locator('#lobby-settings').waitFor({ state: 'visible' }); await page.waitForTimeout(800) }
      // The galaxy keeps turning slowly: sample for a few seconds.
      for (let i = 0; i < 12; i++) {
        assert.deepEqual(await touching(), [], `${name}, Settings ${open ? 'open' : 'closed'}: a caption touches a control`)
        await page.waitForTimeout(400)
      }
    }
    assert.deepEqual(errors, [], `${name}: no page errors`)
    console.log(`${name}: ok`)
    await page.close()
  }
} finally { await browser.close() }
