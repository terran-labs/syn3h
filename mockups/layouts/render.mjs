// Render the HUD layout mockups to /tmp/syn3h-mockups/layouts-2/.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node mockups/layouts/render.mjs [layout ...] [overview]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = '/tmp/syn3h-mockups/layouts-2'
const LAYOUTS = ['orbit', 'horizon', 'halo']
const only = process.argv.slice(2)
const layouts = only.length ? LAYOUTS.filter(l => only.includes(l)) : LAYOUTS

const FRAMES = [
  { suffix: 'locked-day', state: 'locked', device: 'desktop', scene: 'day' },
  { suffix: 'locked-night', state: 'locked', device: 'desktop', scene: 'night' },
  { suffix: 'free-day', state: 'free', device: 'desktop', scene: 'day' },
  { suffix: 'free-night', state: 'free', device: 'desktop', scene: 'night' },
  { suffix: 'paused', state: 'paused', device: 'desktop', scene: 'day' },
  { suffix: 'phone-portrait', state: 'drive', device: 'portrait', scene: 'day' },
  { suffix: 'phone-portrait-menu', state: 'menu', device: 'portrait', scene: 'day' },
  { suffix: 'phone-landscape', state: 'drive', device: 'landscape', scene: 'day' },
]
const SIZE = { desktop: [1440, 1000, 1], portrait: [390, 844, 2], landscape: [844, 390, 2] }

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] })
try {
  for (const layout of layouts) {
    for (const f of FRAMES) {
      const [w, h, dsf] = SIZE[f.device]
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: f.device !== 'desktop' })
      const page = await ctx.newPage()
      page.on('pageerror', e => console.error(layout, f.suffix, e.message))
      page.on('console', m => m.type() === 'error' && console.error(layout, f.suffix, m.text()))
      await page.goto(pathToFileURL(join(here, `${layout}.html`)).href + `?state=${f.state}&device=${f.device}&scene=${f.scene}`)
      await page.waitForFunction(() => document.body.dataset.ready === '1')
      await page.screenshot({ path: `${OUT}/${layout}-${f.suffix}.png` })
      await ctx.close()
      console.log('wrote', `${layout}-${f.suffix}.png`)
    }
  }
  if (!only.length || only.includes('overview')) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(pathToFileURL(join(here, 'overview.html')).href)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0))
    await page.screenshot({ path: `${OUT}/overview.png`, fullPage: true })
    await ctx.close()
    console.log('wrote overview.png')
  }
} finally { await browser.close() }
