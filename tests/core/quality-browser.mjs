import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = []
try {
  for (const profile of ['desktop', 'mobile', 'fallback']) {
    const mobile = profile === 'mobile'
    const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile', deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 540 } })
    const page = await context.newPage(), errors = []
    await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(({ mobile, fallback }) => {
      if (fallback) Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
      if (mobile) Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
      window.qualityEvents = []
      window.addEventListener('mira:loading', e => window.qualityEvents.push(e.detail))
    }, { mobile, fallback: profile === 'fallback' })
    await page.goto('http://localhost:5186/?autoplay=1')
    await page.waitForFunction(() => window.mira?.game.performance.firstFrameMs > 0, null, { timeout: 60000 })
    const initial = await page.evaluate(() => { const s = window.mira; return { level: s.params.get('gfx.level').value, pixelRatio: s.game.renderer.getPixelRatio(), shadows: s.params.get('gfx.shadowQuality').value, pending: sessionStorage.getItem('mira.loading.level'), events: window.qualityEvents, backend: s.game.backend, metrics: s.game.performance } })
    if (initial.pending !== null || !initial.events.some(e => e.phase === 'ready')) throw new Error('Loading did not complete')
    if (profile === 'fallback' && (initial.metrics.drawCalls < 1 || initial.backend !== 'webgl' || initial.level !== 1)) throw new Error('Fallback did not render')
    if (mobile && (initial.level !== 0 || initial.pixelRatio !== 1 || initial.shadows !== 0)) throw new Error('Low-memory phone budget failed')
    await page.evaluate(() => window.mira.params.set('bots.count', 8))
    await page.waitForTimeout(250)
    const count = await page.evaluate(() => window.mira.bots.vehicles.length)
    if (mobile && count !== 2) throw new Error('Bot cap failed')
    await page.keyboard.press('F3'); await page.waitForTimeout(300)
    const hud = await page.locator('#frame-time-hud').textContent()
    if (!hud.includes('Physics') || !hud.includes('triangles')) throw new Error('Frame HUD missing fields')
    await page.screenshot({ path: `/tmp/syn3h-quality-${profile}.png` })
    if (profile === 'desktop') {
      await page.evaluate(() => { sessionStorage.setItem('mira.loading.level', '2'); sessionStorage.removeItem('mira.graphics.level') })
      await page.reload(); await page.waitForFunction(() => window.mira?.game.performance.firstFrameMs > 0)
      const recoveryLevel = await page.evaluate(() => window.mira.params.get('gfx.level').value)
      if (recoveryLevel !== 1) throw new Error('Interrupted load did not reduce quality')
      results.push({ recoveryLevel })
    }
    results.push({ profile, mobile, initial, botCount: count, hud, errors })
    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(results, null, 2))
