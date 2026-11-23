/**
 * The lobby must not cost the game its quality, or draw a world nobody can see.
 *
 *   tools/heavy.sh node tools/lobby-frame-check.mjs http://127.0.0.1:5186/
 *
 * Loads the start screen (no autoplay), counts how often the 3D world is actually rendered
 * while the lobby is up, checks the graphics level and rung do not move, then presses play
 * and checks the world renders every frame again. Prints the shell's state classes, the
 * view state the game derived, and the render rates.
 */
import { chromium } from 'playwright-core'
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5186/')
url.searchParams.set('room', `lobby-${Date.now()}`); url.searchParams.set('daydream', '0')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url.href)
  await page.waitForFunction(() => window.mira?.game?.tick > 10, null, { timeout: 90000 })
  await page.waitForTimeout(3000)
  const measure = () => page.evaluate(async () => {
    const s = window.mira, g = s.game.quality.governor, r = s.game.renderer
    // Count real render calls of the world by wrapping the renderer for the measurement.
    if (!r.__counted) { const render = r.render.bind(r); r.__counted = { n: 0 }; r.render = (...a) => { r.__counted.n++; return render(...a) } }
    const info = { get frame() { return r.__counted.n } }
    const shell = document.querySelector('.mira-shell')
    const before = { frame: info.frame, tick: s.game.tick, level: g.level, rung: g.rung }
    let rafs = 0; const start = performance.now()
    await new Promise(done => { const tick = () => { rafs++; performance.now() - start < 4000 ? requestAnimationFrame(tick) : done() }; requestAnimationFrame(tick) })
    const seconds = (performance.now() - start) / 1000
    return { classes: shell?.className, worldRendersPerSecond: +((info.frame - before.frame) / seconds).toFixed(1), animationFramesPerSecond: +(rafs / seconds).toFixed(1), physicsStepsPerSecond: +((s.game.tick - before.tick) / seconds).toFixed(0), level: [before.level, g.level], rung: [before.rung, g.rung] }
  })
  const lobby = await measure()
  await page.evaluate(() => window.mira.shell.play())
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing'), null, { timeout: 30000 })
  await page.waitForTimeout(1500)
  const playing = await measure()
  console.log(JSON.stringify({ lobby, playing, errors }, null, 1))
} finally { await browser.close() }
