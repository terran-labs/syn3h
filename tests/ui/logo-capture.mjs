// Captures of the animated logo (logo.html) for review: the intro at several moments, the
// settled loop at two times, the still frame, a phone-sized view, the hosted-free SVG
// export. Also measures frame time.
//   tools/heavy.sh node tests/ui/logo-capture.mjs http://127.0.0.1:5208
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://127.0.0.1:5208', out = process.argv[3] ?? '/tmp/syn3h-vehicles2/logo'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const errors = [], requests = []
const report = {}
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()) })
  page.on('request', r => { if (!/\.(ts|js|mjs|css|html)(\?|$)|@vite|@fs|node_modules|\/src\/|\/shared\//.test(r.url())) requests.push(r.url()) })
  await page.goto(`${base}/logo.html`)
  await page.waitForFunction(() => window.logoLab?.mark?.frames > 2, null, { timeout: 30000 })
  report.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const i = gl.getExtension('WEBGL_debug_renderer_info'); return i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  const frame = async (t, intro, name) => { await page.evaluate(([t, intro]) => window.logoLab.mark.drawFrame(t, intro), [t, intro]); await page.locator('#stage').screenshot({ path: `${out}/${name}.png` }) }
  for (const t of [0.4, 1.0, 1.6, 2.2, 3.0, 4.2]) await frame(t, true, `intro-${t.toFixed(1)}s`)
  await frame(12.0, false, 'loop-12s'); await frame(31.5, false, 'loop-31s')
  report.stats = await page.evaluate(() => window.logoLab.mark.stats)
  report.frameMs = await page.evaluate(() => { const m = window.logoLab.mark; m.measure(10); return [m.measure(120), m.measure(120)] })
  report.canvas = await page.evaluate(() => [window.logoLab.mark.canvas.width, window.logoLab.mark.canvas.height])
  for (const level of [1, 0]) {
    await page.goto(`${base}/logo.html?level=${level}`); await page.waitForFunction(() => window.logoLab?.mark?.frames > 0, null, { timeout: 30000 }); await page.waitForTimeout(300)
    report[`level${level}`] = await page.evaluate(() => { const m = window.logoLab.mark; return { stats: m.stats, still: m.options.still, canvas: [m.canvas.width, m.canvas.height], frameMs: (m.measure(10), m.measure(120)) } })
    if (level === 0) await page.locator('#stage').screenshot({ path: `${out}/still.png` })
  }
  // Exports, in the page, from no bitmap.
  const exports = await page.evaluate(async () => {
    const { renderLogoCanvas, LOGO_STILLS, logoSvg } = await import('/src/ui/brand/LogoMark.ts')
    const files = {}
    for (const s of LOGO_STILLS) files[s.name] = renderLogoCanvas(s.width, s.height, { layout: s.layout })?.toDataURL('image/png').split(',')[1] ?? null
    return { files, svg: logoSvg({ space: true, layout: 'card' }) }
  })
  await mkdir(`${out}/export`, { recursive: true })
  for (const [name, data] of Object.entries(exports.files)) if (data) await writeFile(`${out}/export/${name}`, Buffer.from(data, 'base64'))
  await writeFile(`${out}/export/share.svg`, exports.svg)
  report.exports = Object.fromEntries(Object.entries(exports.files).map(([k, v]) => [k, v ? Math.round(v.length * 0.75) : null]))
  await page.close()

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  phone.on('pageerror', e => errors.push(e.message)); phone.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()) })
  await phone.goto(`${base}/logo.html?level=1`); await phone.waitForFunction(() => window.logoLab?.mark?.frames > 2, null, { timeout: 30000 })
  await phone.evaluate(() => window.logoLab.mark.drawFrame(9, false)); await phone.screenshot({ path: `${out}/phone.png` })
  await phone.close()

} finally { await browser.close() }
report.errors = [...new Set(errors)]; report.otherRequests = requests
console.log(JSON.stringify(report, null, 1))
