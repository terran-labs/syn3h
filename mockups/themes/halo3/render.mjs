// Renders the round 3 Halo refinements to /tmp/syn3h-mockups/themes-3/. Run through the limiter:
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node mockups/themes/halo3/render.mjs [variation ...]
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = '/tmp/syn3h-mockups/themes-3'
const src = '/tmp/syn3h-mockups'
// Prefer the clean captures; fall back to the older ones until they exist.
const bg = (time, kind) => {
  const clean = join(src, `clean-${time}-${kind}.png`)
  if (existsSync(clean)) return pathToFileURL(clean).href
  return pathToFileURL(join(src, kind === 'phone' && time === 'day' ? 'backdrop-phone.png' : 'backdrop-desktop.png')).href
}
const variations = [
  { name: 'hairline', title: 'Hairline', note: 'Halo made slimmer and quieter: rounded panels, arcs only in the HUD and gear selector.' },
  { name: 'crescent', title: 'Crescent', note: 'The arcs move into the chrome: a bowed rail edge, arc dividers, an arc gauge for quality.' },
  { name: 'orbit', title: 'Orbit', note: 'No panel at all: the settings follow one sweeping curve that answers the altitude arc.' },
]
const shots = [
  { file: 'desktop-day', mode: 'desktop', time: 'day', kind: 'desktop', vp: { width: 1440, height: 1000 }, dsf: 1 },
  { file: 'desktop-night', mode: 'desktop', time: 'night', kind: 'desktop', vp: { width: 1440, height: 1000 }, dsf: 1 },
  { file: 'phone-play', mode: 'phone-play', time: 'day', kind: 'phone', vp: { width: 390, height: 844 }, dsf: 2 },
  { file: 'phone-sheet', mode: 'phone-sheet', time: 'day', kind: 'phone', vp: { width: 390, height: 844 }, dsf: 2 },
]
const only = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const s of shots) {
    const page = await browser.newPage({ viewport: s.vp, deviceScaleFactor: s.dsf })
    for (const v of variations.filter(v => !only.length || only.includes(v.name))) {
      const url = pathToFileURL(join(here, `${v.name}.html`)).href + `?mode=${s.mode}&time=${s.time}&bg=${encodeURIComponent(bg(s.time, s.kind))}`
      await page.goto(url)
      await page.waitForFunction(() => document.body.dataset.ready === '1')
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(out, `${v.name}-${s.file}.png`) })
    }
    await page.close()
  }
  const img = n => 'data:image/png;base64,' + readFileSync(join(out, `${n}-desktop-day.png`)).toString('base64')
  const font = readFileSync('/Users/vtn/dev/Syn3h-wt/ux-follow-on/public/fonts/barlow-500-latin.woff2').toString('base64')
  const sheet = await browser.newPage({ viewport: { width: 2220, height: 640 } })
  await sheet.setContent(`<style>@font-face{font-family:B;src:url(data:font/woff2;base64,${font})}
    body{margin:0;background:#05080d;color:#e8f0f3;font:500 15px B,sans-serif;display:flex;gap:30px;padding:30px}
    figure{margin:0;width:700px} img{width:700px;display:block;border-radius:6px}
    h2{margin:16px 0 4px;font-size:22px;letter-spacing:.04em} p{margin:0;color:#9fb0b8}</style>
    ${variations.map(v => `<figure><img src="${img(v.name)}"><h2>${v.title}</h2><p>${v.note}</p></figure>`).join('')}`)
  await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())))
  await sheet.screenshot({ path: join(out, 'overview.png'), fullPage: true })
} finally {
  await browser.close()
}
console.log('wrote', out)
