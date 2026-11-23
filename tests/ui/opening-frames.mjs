// What the lobby's opening costs per frame, at Low and High quality: the galaxy's own frame
// (waited for to the GPU's finish) at 60 points through the opening, and requestAnimationFrame
// intervals through one real-time playthrough. Reported, not asserted: frame times depend on the
// machine and its load, so compare a before and an after run made on the same machine.
//   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/opening-frames.mjs [out.json]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const out = process.argv[2]
const levels = { Low: 1, High: 3 }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const report = { load: +loadavg()[0].toFixed(1) }
try {
  for (const [name, level] of Object.entries(levels)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${base}?room=opening-frames-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(level => mira.game.quality.setLevel(level), level)
    await page.waitForTimeout(4000)
    report[name] = await page.evaluate(async () => {
      const g = mira.shell.galaxy, gl = g.gl, px = new Uint8Array(4), mode = mira.params.get('lobby.intro').value
      // The opening's length, read from the running code: play it held at growing times until it reports done.
      g.replayOpening(mode); let length = 0
      for (let t = 0; t < 20; t += 0.1) { g.openingAt = t; g.loop(performance.now()); if (!g.opening) { length = t; break } g.opening ??= { start: 0, mode } }
      g.opening = null; g.openingAt = null
      const frame = () => { g.wake = 2; g.last = 0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); g.loop(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t }
      const costs = []
      for (let i = 0; i < 60; i++) { g.replayOpening(mode); g.openingAt = length * i / 60; costs.push(frame()) }
      g.opening = null; g.openingAt = null
      const settled = []; for (let i = 0; i < 30; i++) settled.push(frame())
      const stats = list => { const s = [...list].sort((a, b) => a - b); return { median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), worst: +s[s.length - 1].toFixed(2) } }
      // One playthrough in real time: the gaps between frames while it plays.
      const gaps = await new Promise(done => {
        const list = []; let last = performance.now()
        g.replayOpening(mode)
        const f = now => { list.push(now - last); last = now; if (g.opening) requestAnimationFrame(f); else done(list) }
        requestAnimationFrame(f)
      })
      return { level: mira.game.quality.governor?.level ?? null, openingSeconds: +length.toFixed(1), galaxyFrameMs: stats(costs), settledFrameMs: stats(settled), realTimeGapsMs: stats(gaps.slice(1)) }
    })
    await page.close()
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(report, null, 1))
if (out) writeFileSync(out, JSON.stringify(report, null, 1))
