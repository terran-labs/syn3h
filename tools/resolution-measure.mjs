// What Render resolution buys: frame time at 100%, 75% and 50% of native in a world at the
// High level, with Auto quality off so the governor holds still. A 1280 by 720 window at a
// device pixel ratio of 2 is 2560 by 1440 native. Two cases: as the game runs, and with 25 ms
// of synthetic main-thread work per frame (a stall resolution cannot help).
// Chrome's frame cap is lifted so the interval shows the real cost, not the display's.
//   SYN3H_URL=http://127.0.0.1:5173/ node tools/resolution-measure.mjs
import { chromium } from 'playwright-core'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  await page.goto(`${base}?autoplay=1&room=resolution-measure-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.evaluate(() => { const q = window.syn3h.game.quality; q.setLevel(3); q.setAuto(false) })
  const env = await page.evaluate(() => window.syn3h.game.quality.getPerformanceSnapshot().environment)
  console.log(`backend ${env.backend} · adapter ${env.adapter ?? 'unknown'}`)
  // The game's own frame loop is wrapped: it records each frame interval, and optionally burns
  // main-thread time before the frame, standing in for script or physics work.
  await page.evaluate(() => {
    const game = window.syn3h.game, frame = game.frame.bind(game)
    window.__stall = 0; window.__gaps = []; let last = performance.now()
    game.frame = () => { const now = performance.now(); window.__gaps.push(now - last); last = now; const until = now + window.__stall; while (performance.now() < until) { /* work */ } return frame() }
  })
  const sample = async ms => { await page.evaluate(() => { window.__gaps = [] }); await page.waitForTimeout(ms); return page.evaluate(() => window.__gaps.slice(1)) }
  const stat = gaps => { const s = [...gaps].sort((a, b) => a - b); return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], frames: s.length } }
  const results = new Map()
  // Two passes in opposite orders, so drift in machine load does not favour one setting.
  for (const pass of [0, 1]) for (const stall of [0, 25]) {
    await page.evaluate(stall => { window.__stall = stall }, stall)
    for (const resolution of pass ? [0.5, 0.75, 1] : [1, 0.75, 0.5]) {
      await page.evaluate(r => window.syn3h.game.quality.setResolution(r), resolution)
      await page.waitForTimeout(2500)
      const key = `${stall}|${resolution}`
      results.set(key, [...(results.get(key) ?? []), ...await sample(6000)])
    }
  }
  const rows = []
  for (const [key, gaps] of results) {
    const [stall, resolution] = key.split('|').map(Number), s = stat(gaps)
    rows.push({ case: stall ? `main thread +${stall} ms` : 'as the game runs', resolution: `${resolution * 100}%`, buffer: `${Math.floor(2560 * resolution)}×${Math.floor(1440 * resolution)}`, 'median ms': s.median.toFixed(1), 'p90 ms': s.p90.toFixed(1), frames: s.frames })
  }
  await page.evaluate(() => { window.__stall = 0; const q = window.syn3h.game.quality; q.setResolution(null); q.setAuto(true) })
  console.table(rows)
} finally { await browser.close() }
