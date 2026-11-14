import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = []
try {
  for (const backend of ['webgpu', 'webgl']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`http://localhost:5186/fx.html?stress${backend === 'webgl' ? '&webgl' : ''}`)
    await page.waitForFunction(() => window.fxDemo?.metrics.frames > 200, null, { timeout: 60000 })
    const metrics = await page.evaluate(() => {
      const m = window.fxDemo.metrics
      const mean = a => a.reduce((a, b) => a + b, 0) / a.length
      return { backend: m.backend, frames: m.frames, particles: m.particles, vents: m.vents, calls: m.calls, meanCpuSubmissionMs: mean(m.cpuMs), meanFrameIntervalMs: mean(m.frameMs) }
    })
    await page.screenshot({ path: `/tmp/syn3h-fx-${backend}-day.png` })
    await page.evaluate(() => window.fxDemo.setNight(true))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `/tmp/syn3h-fx-${backend}-night.png` })
    results.push({ ...metrics, errors })
    await page.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(results, null, 2))
if (results.some(r => r.errors.length || r.particles !== 2400)) process.exitCode = 1
