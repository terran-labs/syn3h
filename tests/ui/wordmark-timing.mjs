// Time from page start to loading's end and to the lobby's first frame after it, the median
// of five loads, for each dev server given (to compare a branch with its base).
//   tools/heavy.sh node tests/ui/wordmark-timing.mjs http://127.0.0.1:5241/ http://127.0.0.1:5243/
// browser-checks: skip (a measurement across two builds, not a check)
import { chromium } from 'playwright-core'
const urls = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const TIMING = () => {
  window.__timing = {}
  new MutationObserver(() => {
    if (document.documentElement?.dataset.boot !== 'done' || window.__timing.done) return
    window.__timing.done = performance.now()
    const start = window.mira?.shell?.galaxy?.frames ?? 0
    const watch = () => { const g = window.mira?.shell?.galaxy; if (g && g.frames > start) window.__timing.frame = performance.now(); else requestAnimationFrame(watch) }
    requestAnimationFrame(watch)
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-boot'] })
}
try {
  // Warm each server's module graph once, so the first measured load is not the cold compile.
  for (const url of urls) { const p = await browser.newPage(); await p.goto(`${url}?room=warm-${Date.now()}`); await p.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 }); await p.close() }
  for (let round = 0; round < 5; round++) for (const url of urls) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage()
    await page.addInitScript(TIMING)
    await page.goto(`${url}?room=time-${Date.now()}`)
    await page.waitForFunction(() => window.__timing?.frame, null, { timeout: 120000 })
    ;(globalThis.runs ??= {})[url] ??= []; globalThis.runs[url].push(await page.evaluate(() => window.__timing))
    await context.close()
  }
  for (const url of urls) {
    const r = globalThis.runs[url], median = k => r.map(x => x[k]).sort((a, b) => a - b)[2].toFixed(0)
    console.log(`${url}: loading ended ${median('done')} ms, first lobby frame ${median('frame')} ms (median of 5)`)
  }
} finally { await browser.close() }
