/** Run against a production preview, not Vite's unbundled dev graph. Fresh contexts disable cache. */
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
const url = process.argv[2] ?? 'http://localhost:5186/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = []
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } })
    const page = await context.newPage()
    await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    await page.addInitScript(() => {
      window.loadProbe = { firstFrameMs: null }
      // Observe the public renderer after main exposes its debug handle. The first
      // frame can be submitted before this rAF; record renderer's own timestamp if present.
      const watch = () => {
        const game = window.syn3h?.game
        if (game?.renderer?.info?.render?.calls > 0) {
          window.loadProbe.firstFrameMs = performance.now()
        } else requestAnimationFrame(watch)
      }
      requestAnimationFrame(watch)
    })
    await page.goto(url + '?autoplay=1&room=load-benchmark-' + Date.now())
    await page.waitForFunction(() => window.loadProbe.firstFrameMs !== null, null, { timeout: 90000 })
    results.push(await page.evaluate(() => ({ firstFrameMs: window.loadProbe.firstFrameMs, backend: window.syn3h.game.backend, terrainGenerationMs: window.syn3h.terrain.lastGenerateMs, resources: performance.getEntriesByType('resource').filter(r => /\.js/.test(r.name)).map(r => ({ name: r.name.split('/').pop(), transferSize: r.transferSize, decodedBodySize: r.decodedBodySize, duration: r.duration })) })))
    await context.close()
  }
} finally { await browser.close() }
const output = { runs: results, medianFirstFrameMs: results.map(r => r.firstFrameMs).sort((a, b) => a - b)[1] }
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(output, null, 2))
console.log(JSON.stringify(output, null, 2))
