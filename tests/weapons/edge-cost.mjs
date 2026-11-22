/**
 * What the shared ring-edge batch (pulse.ts RingEdges) costs on a phone-class setting (evidence,
 * not a test): a 390 x 844 touch view at Minimal and at Low, noon. For each level:
 *   idle: whether the batch is drawn at all with no ring alive, and the draw count;
 *   busy: frame time with six impact rings re-emitted every 0.3 s (typical heavy use), the edge
 *   batch drawn and hidden in alternating 2 s windows, eight of each, median and p95 of each.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/weapons/edge-cost.mjs
 */
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const out = []
try {
  for (const level of [0, 1]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await ctx.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await ctx.newPage()
    await page.goto(`${base}?gfx=${level}&planet=alpine&seed=7&autoplay=1&room=edgecost-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.lasers && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    const r = await page.evaluate(async () => {
      const s = window.syn3h, q = s.params, L = window.syn3hNet.lasers
      q.set('bots.count', 0); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', 12); q.set('daydream.seconds', 0)
      document.exitPointerLock?.()
      const edges = L.pulses.edges.look, frame = () => new Promise(r => requestAnimationFrame(() => r(performance.now())))
      for (let i = 0; i < 90; i++) await frame()
      const info = s.game.renderer.info.render
      const idle = { visible: edges.mesh.visible, draws: info.drawCalls }
      // Busy: six rings around a point 15 m ahead, every 0.3 s.
      const c = s.game.camera, f = c.getWorldDirection(c.position.clone()); f.y = 0; f.normalize()
      const centre = c.position.clone().addScaledVector(f, 15); centre.y = s.terrain.heightAt(centre.x, centre.z)
      let hide = false
      const commit = edges.commit.bind(edges)
      edges.commit = () => { commit(); if (hide) edges.mesh.visible = false }
      const timer = setInterval(() => { for (let k = 0; k < 6; k++) { const at = centre.clone(); at.x += (k - 2.5) * 2; L.showImpact(at, at.clone().set(0, 1, 0), k % 2 === 1, false) } }, 300)
      const windows = { on: [], off: [] }
      for (let w = 0; w < 16; w++) {
        hide = w % 2 === 1
        const end = performance.now() + 2000; let last = await frame()
        while (performance.now() < end) { const t = await frame(); (hide ? windows.off : windows.on).push(t - last); last = t }
      }
      clearInterval(timer)
      const busyDraws = { on: 0, off: 0 }
      hide = false; await frame(); await frame(); busyDraws.on = info.drawCalls
      const stat = a => { const v = a.slice().sort((x, y) => x - y); return { n: v.length, p50: +v[Math.floor(v.length * 0.5)].toFixed(2), p95: +v[Math.floor(v.length * 0.95)].toFixed(2) } }
      return { idle, edgesVisibleWhenBusy: edges.mesh.visible, on: stat(windows.on), off: stat(windows.off), level: s.game.quality.getPerformanceSnapshot().quality.level }
    })
    out.push(`level ${level} (reported ${r.level}): idle edge batch visible ${r.idle.visible}, ${r.idle.draws} draws; busy, edges drawn: ${JSON.stringify(r.on)}; edges hidden: ${JSON.stringify(r.off)}`)
    await ctx.close()
  }
} finally { await browser.close() }
console.log(out.join('\n'))
