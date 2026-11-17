/**
 * Pictures of the lobby's worlds, for looking at, not a gate: the whole system at the resting
 * tilt and from above, then each world close up, on desktop and phone. Also reports the
 * galaxy's frame cost and how long the maps take to paint.
 *
 *   SYN3H_URL=http://127.0.0.1:5191/ tools/heavy.sh node tests/ui/lobby-planets-shots.mjs [label]
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const label = process.argv[2] ?? 'after'
const out = `tests/ui/artifacts/lobby-planets/${label}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = {}
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]) {
    const context = await browser.newContext(view), page = await context.newPage()
    page.on('pageerror', e => console.log(`${view.name} pageerror: ${e.message}`))
    const t0 = Date.now()
    await page.goto(`${base}?room=shots-${view.name}-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForFunction(() => window.syn3h.shell.galaxy.painted >= 9, null, { timeout: 120000 })
    const painted = Date.now() - t0
    await page.waitForTimeout(1500)
    // Frame cost: draw every frame for two seconds and time them on the GPU-bound path.
    const cost = await page.evaluate(async () => {
      const g = window.syn3h.shell.galaxy, gl = g.canvas.getContext('webgl2'), times = []
      for (let i = 0; i < 40; i++) { g.wake = 2; await new Promise(r => requestAnimationFrame(r)); const t = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); times.push(performance.now() - t) }
      times.sort((a, b) => a - b); return { median: times[20], p90: times[36] }
    })
    report[view.name] = { paintedMs: painted, frame: cost }
    await page.screenshot({ path: `${out}/${view.name}-system.png` })
    await page.evaluate(() => { const g = window.syn3h.shell.galaxy; g.swingPitch = { aim: 1.25, aimSpeed: 0, view: 1.25, viewSpeed: 0 }; g.handled = performance.now(); g.wake = 4 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${out}/${view.name}-above.png` })
    if (view.name === 'desktop' || process.env.CLOSE) {
      const ids = await page.evaluate(() => window.syn3h.shell.galaxy.options.worlds.map(w => w.id))
      for (const id of ids) {
        // Fly in, and photograph just before arrival would open the next panel.
        await page.evaluate(id => { const g = window.syn3h.shell.galaxy; g.options.__arrive ??= g.options.onArrive; g.options.onArrive = () => {}; g.choose(id) }, id)
        await page.waitForTimeout(2600)
        await page.screenshot({ path: `${out}/${view.name}-${id}.png` })
        await page.evaluate(() => window.syn3h.shell.galaxy.home())
      }
      await page.evaluate(() => { const g = window.syn3h.shell.galaxy; g.options.onArrive = g.options.__arrive })
    }
    await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(report))
