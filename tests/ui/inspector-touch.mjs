// World inspector on touch devices in WebKit: closed until Create is tapped, then usable
// and inside the screen. Needs the dev servers from tests/ui/README.md (5187 and 8797).
import { devices, webkit } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const out = new URL('./artifacts/inspector/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const browser = await webkit.launch()
const errors = [], results = []
for (const [name, device] of [['ipad', devices['iPad Pro 11 landscape']], ['iphone', devices['iPhone 14']], ['iphone-landscape', devices['iPhone 14 landscape']]]) {
  const context = await browser.newContext({ ...device })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`))
  await page.goto(`http://127.0.0.1:5187/?room=inspector-touch-${name}-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('.syn3h-shell')?.classList.contains('is-playing') && window.syn3hNet?.connected, null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  const closed = await page.evaluate(() => document.querySelector('.world-inspector')?.hasAttribute('hidden'))
  await page.locator('.inspector-toggle').tap()
  await page.waitForSelector('.world-inspector:not([hidden])')
  await page.locator('.wi-card[data-section="sky"] .wi-head').tap()
  await page.waitForTimeout(400)
  const box = await page.evaluate(() => { const r = document.querySelector('.world-inspector').getBoundingClientRect(); const rows = document.querySelectorAll('.wi-card[data-section="sky"] .wi-row').length; return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, rows } })
  const inside = box.left >= 0 && box.right <= box.vw + 1 && box.top >= 0 && box.bottom <= box.vh + 1
  await page.screenshot({ path: `${out}touch-${name}.png` })
  await page.locator('.inspector-toggle').tap()
  const reclosed = await page.evaluate(() => document.querySelector('.world-inspector')?.hasAttribute('hidden'))
  results.push({ name, closed, inside, rows: box.rows, reclosed })
  if (!closed || !inside || !box.rows || !reclosed) errors.push(`${name}: ${JSON.stringify({ closed, inside, reclosed, box })}`)
  await context.close()
}
await browser.close()
console.log(JSON.stringify({ ok: !errors.length, results, errors }))
process.exit(errors.length ? 1 : 0)
