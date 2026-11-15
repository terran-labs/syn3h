/**
 * Lobby screenshots at the reference screenshot's shape, for side-by-side comparison with
 * the owner's 2017 Syn3h lobby capture (kept out of git in tests/ui/artifacts/reference/).
 *
 *   node tests/ui/lobby-reference.mjs <label> [panel,panel...]
 *
 * Needs the lane dev server on 5187. Writes to tests/ui/artifacts/lobby-reference/.
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const label = process.argv[2] ?? 'run'
const panels = (process.argv[3] ?? 'index,explore,vehicle,worlds,settings,multiplayer,about').split(',')
const out = 'tests/ui/artifacts/lobby-reference'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
for (const view of [{ name: 'desktop', viewport: { width: 1920, height: 996 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
  const context = await browser.newContext(view), page = await context.newPage()
  page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
  await page.goto(`http://127.0.0.1:5187/?room=ref-${label}-${view.name}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 10, null, { timeout: 90000 })
  await page.waitForTimeout(3500) // logo entrance settles
  for (const id of panels) {
    await page.evaluate(id => window.syn3h.shell.showPanel(id), id)
    await page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${label}-${view.name}-${id}.png` })
  }
  await context.close()
}
await browser.close()
console.log(JSON.stringify({ label, errors }))
if (errors.length) process.exitCode = 1
