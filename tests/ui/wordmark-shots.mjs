// Screenshots of the lobby wordmark for review. Opens the lobby with ?wordmark=<placement>.
//   tools/heavy.sh node tests/ui/wordmark-shots.mjs edges <prefix>   edge close-ups (flat mark) at pixel ratio 1, 2, 3, and 8x zooms
//   tools/heavy.sh node tests/ui/wordmark-shots.mjs scene <prefix> 1,2,3   each placement on desktop and phone at its brightest and dimmest moment, and mid-drag
// SYN3H_URL picks the dev server (default http://127.0.0.1:5241/).
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const [kind = 'edges', prefix = 'shot', list = '1,2,3'] = process.argv.slice(2)
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const messages = []
const desktop = { name: 'desktop', viewport: { width: 1440, height: 900 } }, phone = { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
async function open(view, dpr, placement) {
  const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: dpr, isMobile: view.isMobile, hasTouch: view.hasTouch })
  const page = await context.newPage()
  page.on('pageerror', e => messages.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') messages.push(`${view.name}: ${m.text()}`) })
  await page.goto(`${base}?room=wm-${Date.now()}&wordmark=${placement}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
  await page.waitForTimeout(6000)
  return { context, page }
}
/** An 8x nearest-neighbour enlargement of part of the page, in CSS pixels. */
async function zoom(page, clip, path, k = 8) {
  clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) }
  const png = await page.screenshot({ clip })
  const z = await browser.newPage({ viewport: { width: 100, height: 100 } })
  const data = `data:image/png;base64,${png.toString('base64')}`
  const size = await z.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); return [i.width, i.height] }, data)
  await z.setViewportSize({ width: size[0] * k, height: size[1] * k })
  await z.setContent(`<body style="margin:0;overflow:hidden"><img src="${data}" style="display:block;width:${size[0] * k}px;height:${size[1] * k}px;image-rendering:pixelated"></body>`)
  await z.screenshot({ path, clip: { x: 0, y: 0, width: size[0] * k, height: size[1] * k } }); await z.close()
}
const logoBox = page => page.evaluate(() => { const r = document.querySelector('.shell-logo').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
try {
  if (kind === 'edges') {
    for (const [view, dpr] of [[desktop, 1], [desktop, 2], [desktop, 3], [phone, 3], [{ name: 'large', viewport: { width: 2560, height: 1440 } }, 1], [{ ...phone, name: 'phone-land', viewport: { width: 844, height: 390 } }, 3]]) {
      const { context, page } = await open(view, dpr, 0), tag = `${prefix}-${view.name}-dpr${dpr}`
      await page.screenshot({ path: `${out}/${tag}.png` })
      const box = await logoBox(page)
      // The 3/H glyph, its thin ring and the corner of the bar: a little under a fifth of the mark.
      const clip = { x: box.x + box.width * 0.69, y: box.y + box.height * 0.1, width: box.width * 0.17, height: box.height * 0.8 }
      await zoom(page, clip, `${out}/${tag}-zoom8x.png`)
      await context.close()
      // The same crop of a screenshot taken before the change, when there is one (prefix "before").
      const before = `${out}/before-${view.name}-dpr${dpr}.png`
      if (existsSync(before)) {
        const still = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: dpr }), p = await still.newPage()
        await p.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${readFileSync(before).toString('base64')}" style="display:block;width:${view.viewport.width}px"></body>`)
        await p.waitForTimeout(200); await zoom(p, clip, `${out}/before-${view.name}-dpr${dpr}-zoom8x.png`); await still.close()
      }
    }
  } else {
    for (const placement of list.split(',').map(Number)) for (const [view, dpr] of [[desktop, 1], [phone, 3]]) {
      const { context, page } = await open(view, dpr, placement), tag = `${prefix}-${view.name}-p${placement}`
      // The shafts drift with the galaxy's clock: find the moments the name is lit most and least.
      const scan = await page.evaluate(() => {
        const g = syn3h.shell.galaxy, gl = g.gl, r = document.querySelector('.shell-logo').getBoundingClientRect(), host = g.host.getBoundingClientRect()
        const sx = g.canvas.width / g.host.clientWidth, sy = g.canvas.height / g.host.clientHeight
        const x = Math.round((r.x - host.x) * sx), w = Math.round(r.width * sx), h = Math.round(r.height * sy), y = Math.round(g.canvas.height - (r.y - host.y) * sy - h)
        const pixels = new Uint8Array(w * h * 4), rows = []
        for (let t = 0; t < 240; t += 4) {
          g.clock = t; g.wake = 2; g.last = 0; g.loop(performance.now())
          gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11
          rows.push([t, sum / (w * h)])
        }
        rows.sort((a, b) => a[1] - b[1]); return { dim: rows[0], bright: rows[rows.length - 1] }
      })
      for (const [moment, [t, level]] of Object.entries(scan)) {
        await page.evaluate(t => { const g = syn3h.shell.galaxy; g.clock = t; g.wake = 2 }, t); await page.waitForTimeout(250)
        await page.screenshot({ path: `${out}/${tag}-${moment}.png` })
        console.log(tag, moment, `clock ${t}s, mean light over the logo box ${level.toFixed(1)}`)
      }
      if (view.name === 'desktop') {
        const y = view.viewport.height * 0.3, x = view.viewport.width * 0.5
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 220, y + 40, { steps: 10 })
        await page.screenshot({ path: `${out}/${tag}-drag.png` }); await page.mouse.up()
      }
      console.log(tag, JSON.stringify(await page.evaluate(() => { const s = syn3h.shell.galaxy.wordmarkStats(); return { mode: s.mode, density: s.fieldDensity, bakeMs: +s.fieldBakeMs.toFixed(1), address: location.search, chip: !!document.querySelector('.wordmark-switch') } })))
      await context.close()
    }
  }
} finally { await browser.close() }
if (messages.length) console.log('messages:\n' + [...new Set(messages)].join('\n'))
console.log('done')
