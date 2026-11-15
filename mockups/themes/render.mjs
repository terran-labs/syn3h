// Renders the three theme mockups to /tmp/syn3h-mockups/themes/. Run through the limiter:
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node mockups/themes/render.mjs [theme ...]
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = '/tmp/syn3h-mockups/themes'
const themes = [
  { name: 'filament', title: 'Filament', note: 'Projected light: hairlines, a luminous spine and god rays, no panels.' },
  { name: 'membrane', title: 'Membrane', note: 'Living cells grown from the screen edge, lit from within.' },
  { name: 'vernier', title: 'Vernier', note: 'A cockpit instrument: cut glass, tick scales and one signal colour.' },
]
const only = process.argv.slice(2)
const modes = [
  { mode: 'desktop', file: 'desktop', viewport: { width: 1440, height: 1000 }, scale: 1 },
  { mode: 'dark', file: 'desktop-dark', viewport: { width: 1440, height: 1000 }, scale: 1 },
  { mode: 'phone', file: 'phone', viewport: { width: 390, height: 844 }, scale: 2 },
  { mode: 'phone-play', file: 'phone-play', viewport: { width: 390, height: 844 }, scale: 2 },
]
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] })
try {
  for (const m of modes) {
    const page = await browser.newPage({ viewport: m.viewport, deviceScaleFactor: m.scale })
    for (const t of themes.filter(t => !only.length || only.includes(t.name))) {
      await page.goto(pathToFileURL(join(here, `${t.name}.html`)).href + `?mode=${m.mode}`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(out, `${t.name}-${m.file}.png`) })
    }
    await page.close()
  }
  // Contact sheet: the three bright desktop renders side by side with their names.
  const img = n => 'data:image/png;base64,' + readFileSync(join(out, `${n}-desktop.png`)).toString('base64')
  const sheet = await browser.newPage({ viewport: { width: 2220, height: 620 }, deviceScaleFactor: 1 })
  await sheet.setContent(`<style>
    @font-face{font-family:B;src:url(data:font/woff2;base64,${readFileSync('/Users/vtn/dev/Syn3h-wt/ux-follow-on/public/fonts/barlow-500-latin.woff2').toString('base64')})}
    body{margin:0;background:#05080d;color:#e8f0f3;font:500 15px B,sans-serif;display:flex;gap:30px;padding:30px}
    figure{margin:0;width:700px} img{width:700px;display:block;border-radius:4px}
    h2{margin:14px 0 4px;font-size:22px;letter-spacing:.06em} p{margin:0;color:#9fb0b8}</style>
    ${themes.map(t => `<figure><img src="${img(t.name)}"><h2>${t.title}</h2><p>${t.note}</p></figure>`).join('')}`)
  await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())))
  await sheet.screenshot({ path: join(out, 'overview.png'), fullPage: true })
} finally {
  await browser.close()
}
console.log('wrote', out)
