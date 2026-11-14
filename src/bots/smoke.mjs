import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('http://localhost:5186/bots.html')
  await page.waitForFunction(() => window.syn3h?.game.tick > 10)
  await page.evaluate(() => window.syn3h.params.set('bots.count', 5))
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 5)
  await page.screenshot({ path: '/tmp/syn3h-bots-start.png' })
  await page.waitForFunction(() => window.syn3h.metrics.contact, null, { timeout: 30000 })
  await page.screenshot({ path: '/tmp/syn3h-bots-contact.png' })
  const result = await page.evaluate(() => ({ ...window.syn3h.metrics, tick: window.syn3h.game.tick, bots: window.syn3h.bots.vehicles.length, backend: window.syn3h.game.backend }))
  await page.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 0)
  console.log(JSON.stringify({ ...result, removedAll: true, errors }, null, 2))
  if (errors.length || !result.contact || result.minimumDistance >= result.initialDistance) process.exitCode = 1
} finally { await browser.close() }
