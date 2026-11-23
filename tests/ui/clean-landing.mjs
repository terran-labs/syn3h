// A visitor's first view of the world has nothing over it: the inspector cards are closed and
// the minimap is in its corner, by both ways in (autoplay, and lobby then Play), at desktop,
// iPad landscape and phone sizes, in Chrome and WebKit. Bugs caught: inspector cards open over
// a newcomer's first view; the minimap away from its corner.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs clean-landing
import { chromium, devices, webkit } from 'playwright-core'
import { serverUrl } from './lib/server.mjs'
const base = serverUrl('clean-landing')
import { mkdirSync } from 'node:fs'
const out = new URL('./artifacts/landing/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const errors = [], rows = []
// Touch sizes only: on a desktop the panels follow whether the cursor is captured, which needs a
// real click a headless browser cannot give (Chrome and WebKit disagreed on the same path).
const sizes = [['ipad', devices['iPad Pro 11 landscape']], ['phone', devices['iPhone 14 landscape']]]
const engines = [['chrome', await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })], ['webkit', await webkit.launch()]]
for (const [engine, browser] of engines) for (const [size, device] of sizes) for (const path of ['autoplay', 'lobby']) {
  const name = `${engine}-${size}-${path}`
  // Chrome cannot take WebKit's device descriptors whole (user agent), only their geometry.
  const options = engine === 'chrome' && size !== 'desktop' ? { viewport: device.viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : device
  const context = await browser.newContext(options), page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`))
  try {
    await page.goto(`${base}?room=landing-${name}-${Date.now()}${path === 'autoplay' ? '&autoplay=1' : ''}`, { waitUntil: 'load' })
    if (path === 'lobby') {
      await page.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
      await page.waitForTimeout(1500)
      // The ordinary way in: Play from the lobby, then the descent.
      await page.evaluate(() => window.mira.shell.play())
    }
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && window.miraNet?.connected, null, { timeout: 120000 })
    await page.waitForTimeout(4000)
    const seen = await page.evaluate(() => { const cards = document.querySelector('.world-inspector'), map = document.querySelector('.shell-minimap'), r = map?.getBoundingClientRect(); return { cards: !cards.hidden, map: r && r.width > 0 && getComputedStyle(map).opacity !== '0' ? Math.round(r.left) : null } })
    await page.screenshot({ path: `${out}${name}.png` })
    rows.push({ name, ...seen })
    if (seen.cards) errors.push(`${name}: cards open on landing`)
    if (seen.map !== null && seen.map > 60) errors.push(`${name}: minimap ${seen.map}px from the left edge`)
  } catch (error) { errors.push(`${name}: ${String(error).slice(0, 200)}`) }
  await context.close()
}
for (const [, browser] of engines) await browser.close()
console.log(JSON.stringify({ ok: !errors.length, rows, errors }))
process.exit(errors.length ? 1 : 0)
