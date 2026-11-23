/**
 * The Jet's THRUST line in the focus display: shown while flying the Jet, absent in the buggy.
 *
 *   tools/heavy.sh node tests/ui/jet-thrust.mjs [port]
 *
 * Needs a dev server (default port 5187). Screenshots go to tests/ui/artifacts/jet-thrust.
 */
import { chromium, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const port = process.argv[2] ?? '5187'
const out = 'tests/ui/artifacts/jet-thrust'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const thrustLines = page => page.evaluate(() => [...document.querySelectorAll('.focus-hud [data-thrust]')].filter(n => !n.hidden && n.offsetParent).map(n => n.textContent))
try {
  const views = [
    { name: 'desktop', vehicle: 'jet', context: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone14', vehicle: 'jet', context: devices['iPhone 14'] },
    { name: 'desktop-buggy', vehicle: 'buggy', context: { viewport: { width: 1440, height: 900 } } },
  ]
  for (const view of views) {
    const context = await browser.newContext(view.context), page = await context.newPage()
    page.on('pageerror', e => console.error(`${view.name}: ${e.message}`))
    await page.goto(`http://127.0.0.1:${port}/?room=jet-thrust-${view.name}-${Date.now()}&vehicle=${view.vehicle}&autoplay=1`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.mira?.game?.tick > 40, null, { timeout: 120000 })
    await page.waitForTimeout(7000) // let the controls card leave
    if (view.vehicle === 'jet') {
      // Lift off with E, then switch to flight with Space and let go: in flight the Jet rests at
      // its neutral throttle (half by default), which the line reports.
      await page.keyboard.down('e')
      await page.waitForFunction(() => { const s = window.mira, p = s.player.body.translation(); return p.y - s.terrain.heightAt(p.x, p.z) > 8 }, null, { timeout: 20000 })
      await page.keyboard.up('e')
      await page.keyboard.press('Space')
      await page.waitForTimeout(1500)
      const lines = await thrustLines(page)
      assert.equal(lines.length, 1, `${view.name}: one THRUST line in the active style`)
      assert.match(lines[0], /^THRUST -?\d+%$/)
      console.log(view.name, lines[0])
    } else {
      assert.equal(await page.evaluate(() => mira.player.kind), 'buggy')
      assert.deepEqual(await thrustLines(page), [], 'no THRUST line in the buggy')
    }
    await page.screenshot({ path: `${out}/${view.name}.png` })
    await context.close()
  }
} finally { await browser.close() }
