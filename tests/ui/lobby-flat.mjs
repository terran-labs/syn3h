// The lobby's settings panel with Sound and Graphics open, for before and after comparisons:
// desktop 1440x900 (Chrome) and an iPhone 14 (WebKit).
//   SYN3H_URL=http://127.0.0.1:5173/ FOOT_OUT=tests/ui/artifacts/sidebar-footer/after node tests/ui/lobby-flat.mjs
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.FOOT_OUT ?? 'tests/ui/artifacts/sidebar-footer/after'
await mkdir(out, { recursive: true })
for (const [name, options] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 14'] })) {
  const browser = await (name === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const page = await browser.newPage(options)
    await page.goto(`${base}?room=lobby-flat-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 }); await page.waitForTimeout(1500)
    const gear = page.getByRole('button', { name: 'Settings', exact: true })
    await (name === 'desktop' ? gear.click() : gear.tap())
    const panel = page.locator('.world-inspector.lobby-settings'); await panel.waitFor({ state: 'visible' })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/${name}-lobby-settings.png` })
    console.log(`${name}: done`)
  } finally { await browser.close() }
}
