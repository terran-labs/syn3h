// Screenshots of the sidebar's foot and the World card's actions, with the World card open and
// closed: desktop 1440x900 (Chrome), iPhone 14 portrait and landscape (WebKit).
//   MIRA_URL=http://127.0.0.1:5173/ FOOT_OUT=tests/ui/artifacts/sidebar-footer/after node tests/ui/sidebar-footer.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.FOOT_OUT ?? 'tests/ui/artifacts/sidebar-footer/after'
await mkdir(out, { recursive: true })
const VIEWS = { desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 14'], landscape: devices['iPhone 14 landscape'] }
for (const [name, options] of Object.entries(VIEWS)) {
  const touch = name !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(options)
    await page.goto(`${base}?autoplay=1&planet=badlands&seed=1&room=footer-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector'); await rail.waitFor({ state: 'visible' })
    const settle = () => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations({ subtree: true }).some(a => a.playState === 'running')).then(() => page.waitForTimeout(300))
    await page.evaluate(() => { for (const card of document.querySelectorAll('.world-inspector .wi-card.is-open')) card.querySelector('.wi-head').click() })
    await settle()
    await page.screenshot({ path: `${out}/${name}-world-closed.png` })
    const head = rail.locator('.wi-card[data-section=world] > .wi-head')
    await (touch ? head.tap() : head.click()); await settle()
    await rail.locator('.wi-card[data-section=world]').evaluate(card => card.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${name}-world-open.png` })
    // The Game card's Mode row while it is the row being described (its tooltip showing).
    await page.evaluate(() => { for (const card of document.querySelectorAll('.world-inspector .wi-card.is-open')) card.querySelector('.wi-head').click() })
    await settle()
    const game = rail.locator('.wi-card[data-section=game] > .wi-head')
    await (touch ? game.tap() : game.click()); await settle()
    const mode = rail.locator('.wi-row[data-id="game.mode"]')
    await mode.scrollIntoViewIfNeeded()
    if (touch) await mode.locator('.wi-label').tap(); else await mode.locator('.wi-label').hover()
    await page.waitForTimeout(400)
    const box = await mode.boundingBox(), view = page.viewportSize()
    const clip = { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.min(view.width - Math.max(0, box.x - 16), box.width + 32), height: box.height + 32 }
    await page.screenshot({ path: `${out}/${name}-mode-row.png`, clip })
    await page.screenshot({ path: `${out}/${name}-mode-row-full.png` })
    console.log(`${name}: done`)
  } finally { await browser.close() }
}
