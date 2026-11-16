// Screenshots of the lobby wordmark for review: edge close-ups at pixel ratio 1 and 2, the
// lobby on desktop and phone, and (with placements) the in-scene variants and one mid-drag.
//   tools/heavy.sh node tests/ui/wordmark-shots.mjs <prefix> [placements, e.g. 0,1,2,3]
// SYN3H_URL picks the dev server (default http://127.0.0.1:5241/).
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const prefix = process.argv[2] ?? 'shot', placements = (process.argv[3] ?? '0').split(',').map(Number)
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const errors = []
const views = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, dpr: [1, 2] },
  { name: 'large', viewport: { width: 2560, height: 1440 }, dpr: [1] },
  { name: 'phone', viewport: { width: 390, height: 844 }, dpr: [3], isMobile: true, hasTouch: true },
  { name: 'phone-land', viewport: { width: 844, height: 390 }, dpr: [3], isMobile: true, hasTouch: true },
]
try {
  for (const view of views) for (const dpr of view.dpr) for (const placement of placements) {
    if (placement !== 0 && view.name === 'large') continue
    const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: dpr, isMobile: view.isMobile, hasTouch: view.hasTouch })
    const page = await context.newPage(), tag = `${prefix}-${view.name}-dpr${dpr}${placements.length > 1 || placement ? `-p${placement}` : ''}`
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' || /logo|wordmark/i.test(m.text())) errors.push(`${tag}: ${m.text()}`) })
    await page.goto(`${base}?room=wm-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(p => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400); if (window.syn3h.params.get('lobby.wordmark')) window.syn3h.params.set('lobby.wordmark', p) }, placement)
    if (prefix.includes('intro') ) { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${tag}-intro.png` }) }
    await page.waitForTimeout(6000)
    await page.screenshot({ path: `${out}/${tag}.png` })
    const box = await page.evaluate(() => { const r = document.querySelector('.shell-logo').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    if (placement === 0 && box.width > 0) {
      // The right third of the mark: the 3/H glyph and its thin inner ring.
      const w = box.width * 0.4, h = box.height * 1.3
      await page.screenshot({ path: `${out}/${tag}-edge.png`, clip: { x: box.x + box.width * 0.6 - 4, y: box.y - box.height * 0.15, width: w, height: h } })
    }
    if (placement !== 0 && view.name === 'desktop') {
      const y = view.viewport.height * 0.18, x = view.viewport.width * 0.5
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 220, y + 40, { steps: 10 })
      await page.screenshot({ path: `${out}/${tag}-drag.png` }); await page.mouse.up()
    }
    const stats = await page.evaluate(() => window.syn3h.shell.galaxy?.wordmarkStats?.() ?? null)
    if (stats) console.log(tag, JSON.stringify(stats))
    await context.close()
  }
} finally { await browser.close() }
if (errors.length) console.log('messages:\n' + errors.join('\n'))
console.log('done')
