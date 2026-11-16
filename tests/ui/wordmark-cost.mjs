// What the wordmark's distance field costs: the one-off GPU bake at the sizes the lobby asks
// for, and a whole logo draw (glow, particles, mark) per frame, both timed to the GPU's finish.
//   tools/heavy.sh node tests/ui/wordmark-cost.mjs   (SYN3H_URL, default http://127.0.0.1:5241/)
import { chromium } from 'playwright-core'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${base}logo.html`)
  const result = await page.evaluate(async () => {
    const { LogoRenderer } = await import('/src/ui/brand/logoRenderer.ts')
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 600
    const gl = canvas.getContext('webgl2', { antialias: false }), pixel = new Uint8Array(4)
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const renderer = gl.getExtension('WEBGL_debug_renderer_info'), out = { gpu: renderer ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL) : '?', bake: {}, drawMs: {} }
    for (const height of [80, 140, 210, 320, 480]) {
      const r = new LogoRenderer(gl, { particles: 160 }); r.skipIntro(); sync()
      const t = performance.now(); r.draw(10, { x: 100, y: 100, width: height * 4.257, height }); sync()
      out.bake[height] = { firstDrawMs: +(performance.now() - t).toFixed(2), density: r.stats.fieldDensity }
      for (let i = 0; i < 10; i++) r.draw(10 + i, { x: 100, y: 100, width: height * 4.257, height }); sync()
      const t2 = performance.now(); for (let i = 0; i < 100; i++) { r.draw(11 + i / 30, { x: 100, y: 100, width: height * 4.257, height }); sync() }
      out.drawMs[height] = +((performance.now() - t2) / 100).toFixed(3)
      r.dispose()
    }
    return out
  })
  console.log(JSON.stringify(result, null, 1))
} finally { await browser.close() }
// The lobby frame with each wordmark placement: the galaxy's whole pass (the ray tracer with
// the wordmark in it, or with the flat logo drawn after), timed to the GPU's finish.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
  try {
    for (const view of [{ width: 1440, height: 900, deviceScaleFactor: 2 }, { width: 390, height: 844, deviceScaleFactor: 3 }]) {
      const page = await browser.newPage({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.deviceScaleFactor })
      await page.goto(`${base}?room=wm-cost-${Date.now()}`)
      await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
      const row = {}
      for (const mode of [0, 1, 2, 3]) {
        row[mode] = await page.evaluate(async mode => {
          syn3h.params.set('gfx.level', 2); syn3h.params.set('lobby.wordmark', mode)
          await new Promise(r => setTimeout(r, 2500))
          const g = syn3h.shell.galaxy, gl = g.gl, pixel = new Uint8Array(4), times = []
          for (let i = 0; i < 40; i++) {
            g.wake = 2; g.last = 0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
            const t = performance.now(); g.loop(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); times.push(performance.now() - t)
          }
          times.sort((a, b) => a - b)
          return +times[20].toFixed(2)
        }, mode)
      }
      console.log(`galaxy frame ms (median) ${view.width}x${view.height}@${view.deviceScaleFactor}, by lobby.wordmark:`, JSON.stringify(row))
      await page.close()
    }
  } finally { await browser.close() }
}
