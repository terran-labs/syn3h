/**
 * Frame cost of the vehicle arrival effect: the same parked scene with an arrival kept
 * running continuously (re-triggered as cosmetic holds) against none, alternating, per
 * graphics level. Reports the median CPU time in renderer.render and the GPU time from
 * timestamp queries when the adapter has them.
 *   node tools/arrival-cost.mjs <base URL> [desktop|phone]
 * phone: 390 x 844 at device pixel ratio 3 with 4x CPU throttling.
 */
import { chromium } from 'playwright-core'

const [base = 'http://127.0.0.1:5419', device = 'desktop'] = process.argv.slice(2)
const phone = device === 'phone'
const levels = process.env.LEVELS ? process.env.LEVELS.split(',').map(Number) : phone ? [0, 1, 2] : [2, 1, 0]
// HIDE=volume,ground,beam,ghost,cloud hides parts of the look, to see what each costs.
const hide = (process.env.HIDE ?? '').split(',').filter(Boolean)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
try {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone })
  await context.routeWebSocket(/\/ws/, (s) => s.close())
  const page = await context.newPage()
  await page.goto(`${base}/?autoplay=1&vehicle=buggy&seed=3`)
  await page.waitForFunction(() => window.mira?.game.tick > 200 && window.mira.materialize, null, { timeout: 120000 })
  if (phone) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate((HIDE) => {
    const s = window.mira, g = s.game, r = g.renderer
    s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 12)
    s.bots.daydream?.setBlocker?.(() => true); s.shell.closeMenu?.()
    g.quality.frame = () => {}
    r.backend.trackTimestamp = r.hasFeature?.('timestamp-query') ?? false
    const render = r.render.bind(r)
    window.__cost = { cpu: [], gpu: [], on: false }
    let pending = false
    r.render = (...args) => {
      const t = performance.now(), out = render(...args)
      window.__cost.cpu.push(performance.now() - t)
      if (r.backend.trackTimestamp && !pending) { pending = true; r.resolveTimestampsAsync().then((v) => { if (v) window.__cost.gpu.push(v) }).finally(() => { pending = false }) }
      return out
    }
    const hide = window.__hide = HIDE
    if (hide.length) { const tick = () => { const m = s.materialize; for (const l of m.looks) { if (hide.includes('volume')) l.volume.visible = false; if (hide.includes('ground')) l.ground.visible = false; if (hide.includes('beam')) l.beam.visible = false; if (hide.includes('ghost')) for (const g of l.ghosts) g.visible = false } if (hide.includes('cloud')) m.cloud.mesh.visible = false; requestAnimationFrame(tick) }; tick() }
    // Keep one cosmetic arrival running while measuring "on".
    setInterval(() => { if (window.__cost.on && !s.materialize.isMaterializing(s.player)) s.materialize.begin(s.player, { hold: false, holdSeconds: 1.2 }) }, 50)
  }, hide)
  const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN }
  const sample = async (on) => {
    await page.evaluate((on) => { window.__cost.on = on; if (!on) window.mira.materialize.cancel(window.mira.player) }, on)
    await page.waitForTimeout(1500)
    await page.evaluate(() => { window.__cost.cpu = []; window.__cost.gpu = [] })
    await page.waitForTimeout(4000)
    return page.evaluate(() => ({ cpu: window.__cost.cpu, gpu: window.__cost.gpu }))
  }
  for (const level of levels) {
    await page.evaluate((level) => window.mira.params.set('gfx.level', level), level)
    await page.waitForTimeout(3000)
    const off = { cpu: [], gpu: [] }, on = { cpu: [], gpu: [] }
    // Alternate off and on three times to cancel drift.
    for (let i = 0; i < 3; i++) for (const [state, bucket] of [[false, off], [true, on]]) { const s = await sample(state); bucket.cpu.push(...s.cpu); bucket.gpu.push(...s.gpu) }
    const f = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a')
    console.log(`${device} level ${level}${hide.length ? ' without ' + hide.join('+') : ''}: render CPU off ${f(median(off.cpu))} ms, on ${f(median(on.cpu))} ms (+${f(median(on.cpu) - median(off.cpu))}); GPU off ${f(median(off.gpu))} ms, on ${f(median(on.gpu))} ms (+${f(median(on.gpu) - median(off.gpu))}); frames ${off.cpu.length}/${on.cpu.length}`)
  }
} finally {
  await browser.close()
}
