// Browser check for the quality cascade, plus a rough cost reading per rung.
// Usage: node tests/core/quality-cascade-browser.mjs [url]   (default http://127.0.0.1:5207/)
// The cost reading renders the live scene with the animation loop stopped and waits for the
// GPU queue after each frame, so it measures submit plus GPU time, not vsync intervals.
// Headless Chrome on a shared machine is noisy: the script repeats each sweep and prints the
// spread, and a rung whose difference is inside that spread has not been measured.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://127.0.0.1:5207/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const out = {}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const page = await context.newPage(), errors = []
  await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => { window.qualityEvents = []; window.addEventListener('mira:quality', e => window.qualityEvents.push(e.detail)) })
  await page.goto(`${url}?autoplay=1`)
  await page.waitForFunction(() => window.mira?.game.performance.firstFrameMs > 0, null, { timeout: 90000 })
  await page.waitForTimeout(3000)
  await page.keyboard.press('F3'); await page.waitForTimeout(400)
  out.hud = await page.locator('#frame-time-hud').textContent()
  if (!out.hud.includes('Rung') || !out.hud.includes('Pixel ratio')) throw new Error('HUD lacks the rung fields')
  out.backend = await page.evaluate(() => window.mira.game.backend)
  out.start = await page.evaluate(() => window.qualityEvents.at(-1))
  if (out.start.rung === undefined || out.start.pixelRatio === undefined || out.start.vehicleShading === undefined) throw new Error('mira:quality detail lacks rung values')
  // Automation off returns to the fixed budget.
  out.autoOff = await page.evaluate(() => { window.mira.params.set('gfx.auto', false); const e = window.qualityEvents.at(-1); return { reason: e.reason, rung: e.rung, pixelRatio: window.mira.game.renderer.getPixelRatio() } })
  if (out.autoOff.reason !== 'auto-off' || out.autoOff.rung !== 0 || out.autoOff.pixelRatio !== 1.5) throw new Error('gfx.auto off did not restore the fixed budget')
  // A hand-set level is pinned and remembered for the session.
  out.manual = await page.evaluate(() => { window.mira.params.set('gfx.level', 1); const e = window.qualityEvents.at(-1); return { reason: e.reason, level: e.level, pinned: sessionStorage.getItem('mira.graphics.manual') } })
  if (out.manual.reason !== 'manual' || out.manual.pinned !== '1') throw new Error('Manual level was not pinned')
  await page.evaluate(() => { window.mira.params.set('gfx.level', 2) })
  await page.waitForTimeout(1500)
  out.cost = await page.evaluate(async () => {
    const { game, params } = window.mira, r = game.renderer, device = r.backend.device
    const wait = () => device ? device.queue.onSubmittedWorkDone() : Promise.resolve(r.backend.gl?.finish())
    r.setAnimationLoop(null)
    const frame = async () => { const t = performance.now(); r.render(game.scene, game.camera); await wait(); return performance.now() - t }
    const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
    async function measure(setup) {
      await setup(); for (let i = 0; i < 15; i++) await frame()
      const samples = []; for (let i = 0; i < 40; i++) samples.push(await frame())
      return median(samples)
    }
    const cases = {
      'pr 1.5': () => r.setPixelRatio(1.5), 'pr 1.25': () => r.setPixelRatio(1.25), 'pr 1': () => r.setPixelRatio(1),
      'pr 0.85': () => r.setPixelRatio(0.85), 'pr 0.7': () => r.setPixelRatio(0.7),
      'pr 1 shadows 1': () => { r.setPixelRatio(1); params.set('gfx.shadowQuality', 1) },
      'pr 1 shadows 0': () => { r.setPixelRatio(1); params.set('gfx.shadowQuality', 0) },
    }
    const runs = {}
    for (let pass = 0; pass < 3; pass++) for (const [name, setup] of Object.entries(cases)) (runs[name] ??= []).push(+(await measure(setup)).toFixed(2))
    params.set('gfx.shadowQuality', 1); r.setPixelRatio(1.5)
    game.start()
    return runs
  })
  out.errors = errors
  if (errors.length) throw new Error(errors.join('\n'))
  await context.close()
} finally { await browser.close() }
console.log(JSON.stringify(out, null, 2))
