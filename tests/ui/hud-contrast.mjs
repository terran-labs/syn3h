// Crops of the HUD text over the hardest backgrounds, for before and after comparisons: the
// world and heading line (top centre), the gear list (left), the speed and height readouts,
// and the lobby's version beside the gear. Scenes: Badlands at noon (pale sky), Ice moon at
// noon, Volcanic (lava) and Badlands at night; the interface in Full and Driving modes.
// Sizes: desktop 1440x900 and 3840x2160 (Chrome), phone portrait and landscape (WebKit).
//   SYN3H_URL=http://127.0.0.1:5173/ HUD_OUT=tests/ui/artifacts/hud-contrast/after node tests/ui/hud-contrast.mjs
// One browser at a time. HUD_VIEWS limits the sizes (comma separated).
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.HUD_OUT ?? 'tests/ui/artifacts/hud-contrast/after'
await mkdir(out, { recursive: true })
const VIEWS = {
  desktop: { engine: chromium, page: { viewport: { width: 1440, height: 900 } } },
  '4k': { engine: chromium, page: { viewport: { width: 3840, height: 2160 } } },
  phone: { engine: webkit, page: devices['iPhone 14'] },
  landscape: { engine: webkit, page: devices['iPhone 14 landscape'] },
}
const SCENES = [
  { name: 'pale', planet: 'badlands', hour: 12.5 },
  { name: 'ice', planet: 'ice', hour: 12.5 },
  { name: 'lava', planet: 'volcanic', hour: 20.5 },
  { name: 'night', planet: 'badlands', hour: 0.5 },
]
const SPOTS = { top: '.focus-hud .fh-top', gear: '.gear-selector', readout: '.focus-hud .fh-left' }
const pad = 24

async function crop(page, selector, path) {
  const box = await page.evaluate(sel => {
    const all = [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none')
    if (!all.length) return null
    const r = all.map(el => el.getBoundingClientRect()).reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }))
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
  }, selector)
  if (!box || box.width < 2 || box.height < 2) return false
  const view = page.viewportSize()
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad)
  await page.screenshot({ path, clip: { x, y, width: Math.min(view.width - x, box.width + pad * 2), height: Math.min(view.height - y, box.height + pad * 2) } })
  return true
}

for (const name of (process.env.HUD_VIEWS ?? 'desktop,4k,phone,landscape').split(',')) {
  const view = VIEWS[name]
  const browser = await (view.engine === chromium ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const page = await browser.newPage(view.page)
    // The lobby's version beside the gear.
    await page.goto(`${base}?room=hud-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 }); await page.waitForTimeout(1500)
    await crop(page, '.lobby-gear-dock', `${out}/${name}-lobby-version.png`)
    console.log(`${name}: lobby version "${await page.locator('[data-lobby-version]').innerText()}"`)
    for (const planet of [...new Set(SCENES.map(s => s.planet))]) {
      await page.goto(`${base}?planet=${planet}&seed=1&vehicle=jet&autoplay=1&name=Showcase&room=hud-${name}-${planet}-${Date.now()}`)
      await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
      for (const scene of SCENES.filter(s => s.planet === planet)) {
        await page.evaluate(hour => window.syn3h.params.set('sun.timeOfDay', hour), scene.hour)
        for (const [mode, value] of [['full', 0], ['driving', 1]]) {
          await page.evaluate(v => window.syn3h.params.set('hud.mode', v), value)
          await page.waitForTimeout(900)
          for (const [spot, selector] of Object.entries(SPOTS)) await crop(page, selector, `${out}/${name}-${scene.name}-${mode}-${spot}.png`)
        }
        await page.evaluate(() => window.syn3h.params.set('hud.mode', 0))
      }
    }
    console.log(`${name}: done`)
  } finally { await browser.close() }
}
