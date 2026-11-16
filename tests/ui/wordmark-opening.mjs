// The continuous opening (?intro=): a strip of frames across it on desktop and phone, the veil
// while loading, the end state after a skip and with reduced motion, and the time from page
// start to loading's end and to the first lobby frame, with the opening off and on.
//   tools/heavy.sh node tests/ui/wordmark-opening.mjs <prefix> [intro, default 1] [wordmark, default 3]
// SYN3H_URL picks the dev server (default http://127.0.0.1:5241/).
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const [prefix = 'opening', intro = '1', wordmark = '3'] = process.argv.slice(2)
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const views = [{ name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]
// When loading ended and when the lobby's first frame after it was drawn, from page start.
const TIMING = () => {
  window.__timing = {}
  new MutationObserver(() => {
    if (document.documentElement?.dataset.boot !== 'done' || window.__timing.done) return
    window.__timing.done = performance.now()
    const start = window.syn3h?.shell?.galaxy?.frames ?? 0
    const watch = () => { const g = window.syn3h?.shell?.galaxy; if (g && g.frames > start) window.__timing.frame = performance.now(); else requestAnimationFrame(watch) }
    requestAnimationFrame(watch)
  // The document element does not exist yet when this runs: watch the document's subtree.
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-boot'] })
}
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done' && window.__timing?.frame, null, { timeout: 120000 })
try {
  for (const view of views) {
    const context = await browser.newContext(view), page = await context.newPage()
    await page.addInitScript(TIMING)
    await page.goto(`${base}?room=op-${Date.now()}&intro=${intro}&wordmark=${wordmark}`, { waitUntil: 'commit' })
    await page.waitForSelector('.boot-point', { state: 'attached' }); await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/${prefix}-${view.name}-0-veil.png` })
    await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(4000)
    // Replay the opening, held at each moment in turn.
    const times = [0, 0.2, 0.45, 0.8, 1.2, 1.6, 2.1, 2.6]
    for (const [i, t] of times.entries()) {
      await page.evaluate(t => { const g = syn3h.shell.galaxy; g.replayOpening(syn3h.params.get('lobby.intro').value); g.openingAt = t; g.wake = 2 }, t)
      await page.waitForTimeout(350)
      await page.screenshot({ path: `${out}/${prefix}-${view.name}-${i + 1}-t${t.toFixed(2)}.png` })
    }
    await page.evaluate(() => { const g = syn3h.shell.galaxy; g.openingAt = null })
    // Skipped: a tap a little way in goes straight to the settled lobby.
    await page.evaluate(() => syn3h.shell.galaxy.replayOpening(syn3h.params.get('lobby.intro').value))
    await page.waitForTimeout(300); await page.keyboard.press('Shift'); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${prefix}-${view.name}-skipped.png` })
    await context.close()
  }
  // Reduced motion: today's veil, a plain fade, the settled lobby.
  {
    const context = await browser.newContext({ ...views[0], reducedMotion: 'reduce' }), page = await context.newPage()
    await page.addInitScript(TIMING)
    await page.goto(`${base}?room=op-${Date.now()}&intro=${intro}&wordmark=${wordmark}`); await ready(page); await page.waitForTimeout(2500)
    console.log('reduced motion: intro on html', await page.evaluate(() => document.documentElement.dataset.intro ?? 'none'))
    await page.screenshot({ path: `${out}/${prefix}-reduced.png` }); await context.close()
  }
  // Time to the lobby, opening off and on: the median of three loads each, desktop.
  for (const flag of ['0', intro]) {
    const runs = []
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext(views[0]), page = await context.newPage()
      await page.addInitScript(TIMING)
      await page.goto(`${base}?room=op-${Date.now()}&intro=${flag}&wordmark=${wordmark}`); await ready(page)
      runs.push(await page.evaluate(() => window.__timing)); await context.close()
    }
    const median = key => runs.map(r => r[key]).sort((a, b) => a - b)[1].toFixed(0)
    console.log(`intro=${flag}: loading ended ${median('done')} ms, first lobby frame after it ${median('frame')} ms (medians of 3)`)
  }
} finally { await browser.close() }
console.log('done')
