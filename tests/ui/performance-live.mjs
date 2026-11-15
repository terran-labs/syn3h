// Real controller history and diagnostics, without a fixture or injected frame samples.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.SYN3H_URL
const out = 'tests/ui/artifacts/performance-live'
await mkdir(out, { recursive: true })
const report = {}
for (const mode of ['desktop', 'phone']) {
  const touch = mode === 'phone'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=fps-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // Keep this functional check light on the shared renderer; samples still come from real frames.
    await page.evaluate(() => { syn3h.game.quality.setLevel(1); syn3h.game.quality.setAuto(false) })
    await page.waitForFunction(() => syn3h.game.quality.getPerformanceSnapshot().history.length >= 3, null, { timeout: 60000 })
    if (touch) {
      if (await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
      const head = page.locator('.wi-card[data-section=performance] > .wi-head')
      if (!await head.evaluate(el => el.parentElement.classList.contains('is-open'))) await head.tap()
      await page.locator('.performance-diagnostics > summary').tap()
    } else {
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('F3')
    }
    await page.waitForFunction(() => syn3h.game.quality.getPerformanceSnapshot().visible)
    const body = page.locator('.performance-body')
    await body.waitFor({ state: 'visible' })
    await body.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('.performance-chart polyline').getAttribute('points').trim().split(/\s+/).length >= 3)
    const actual = await page.evaluate(() => {
      const s = syn3h.game.quality.getPerformanceSnapshot()
      const points = document.querySelector('.performance-chart polyline').getAttribute('points').trim().split(/\s+/)
      const row = [...document.querySelectorAll('.performance-body dt')].find(e => e.textContent === 'FPS / median frame')
      return { backend: s.environment.backend, samples: s.history.length, points: points.length, fps: row.nextElementSibling.textContent,
        finite: s.history.every(p => Number.isFinite(p.frameMs) && p.frameMs > 0), legacyVisible: !!document.querySelector('#frame-time-hud:not([hidden])') }
    })
    assert.ok(actual.samples >= 3 && actual.samples <= 120)
    assert.equal(actual.points, actual.samples)
    assert.ok(actual.finite); assert.match(actual.fps, /^\d+ \/ [\d.]+ ms$/)
    assert.equal(actual.legacyVisible, false)
    await page.screenshot({ path: `${out}/${mode}-history.png` })
    await page.locator('.performance-diagnostics > summary').click()
    await page.waitForFunction(() => !syn3h.game.quality.getPerformanceSnapshot().visible)
    assert.equal(await body.isVisible(), false)
    assert.deepEqual(errors, [])
    report[mode] = actual
    console.log(`${mode}: live FPS/history passed ${JSON.stringify(actual)}`)
  } finally { await browser.close() }
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
