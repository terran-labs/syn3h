/**
 * Bloom cost, measured the way tools/frame-profile.mjs measures: headed Chrome on the GPU,
 * a fresh context per case, graphics level 2, pixel ratio 1, the quality governor held still,
 * 2.5 seconds of warm-up and 5 seconds of samples.
 *
 *   tools/heavy.sh node tools/bloom-profile.mjs [URL] [output JSON] [default strength] [threshold] [radius] [stack]
 *
 * stack 'full' adds shafts 0.6, grade 0.5 and vignette 0.4 to the default case and all three
 * at 1 to the max case, with the sun low (18.6 h) so shafts are drawn.
 *
 * Cases at 1920 x 1080 and 1280 x 720, run back to back as off, default, max, max, default,
 * off, so drift shows as a difference between the two halves. Max is strength 1, radius 1.
 * Render CPU is the time in Game's draw (renderer.render, or the bloom pipeline), GPU is the
 * renderer's timestamp queries for the whole frame. The load average is recorded per case.
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { writeFile } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://127.0.0.1:5213/'
const output = process.argv[3] ?? '/tmp/bloom-profile.json'
const def = { strength: Number(process.argv[4] ?? 0.5), threshold: Number(process.argv[5] ?? 4), radius: Number(process.argv[6] ?? 0.4) }
const full = process.argv[7] === 'full'
if (full) def.extra = { 'gfx.shafts': 0.6, 'gfx.grade': 0.5, 'gfx.vignette': 0.4 }
const max = { strength: 1, threshold: def.threshold, radius: 1, ...(full ? { extra: { 'gfx.shafts': 1, 'gfx.grade': 1, 'gfx.vignette': 1 } } : {}) }
const sep = url.includes('?') ? '&' : '?'
const cases = [['off', null], ['default', def], ['max', max], ['max', max], ['default', def], ['off', null]]
const percentile = (values, p) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null }
const results = []
// BLOOM_UNCAPPED=1 turns off vsync and the frame rate limit, so frame time shows the real
// cost instead of the display's 8.3 ms. Timestamp sums from the renderer proved unreliable
// for the multi-pass pipeline (they exceeded the frame interval), so frame time is the
// measure to trust when uncapped.
const uncapped = process.env.BLOOM_UNCAPPED === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', ...uncapped] })
try {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    for (const [name, settings] of cases) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
      await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(`${url}${sep}autoplay=1&gfx=2&room=bloom-profile-${Date.now()}`)
      await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 90000 })
      const setup = await page.evaluate(([settings, full]) => {
        const s = window.syn3h, g = s.game, r = g.renderer
        s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0)
        g.quality.frame = () => {}; r.setPixelRatio(1)
        if (settings) { s.params.set('gfx.bloomThreshold', settings.threshold); s.params.set('gfx.bloomRadius', settings.radius); s.params.set('gfx.bloom', settings.strength); for (const [id, v] of Object.entries(settings.extra ?? {})) s.params.set(id, v) }
        if (full) s.params.set('sun.timeOfDay', 18.6)
        r.backend.trackTimestamp = r.hasFeature('timestamp-query')
        const draw = g.draw.bind(g)
        let drawMs = 0, gpuPending = false, lastGpu = null
        g.draw = () => { const t = performance.now(); draw(); drawMs += performance.now() - t }
        const samples = []; let collecting = false
        g.add({ update() {
          if (collecting) samples.push({ frameMs: g.performance.frameMs, drawMs, gpuMs: lastGpu, drawCalls: g.performance.drawCalls })
          drawMs = 0
          if (r.backend.trackTimestamp && !gpuPending) { gpuPending = true; r.resolveTimestampsAsync().then(v => { lastGpu = v }).finally(() => { gpuPending = false }) }
        } })
        window.bloomProfile = { start() { samples.length = 0; collecting = true }, stop() { collecting = false; return samples } }
        return { backend: g.backend, timestamps: r.backend.trackTimestamp, drawingBuffer: [r.domElement.width, r.domElement.height] }
      }, [settings, full])
      await page.waitForTimeout(2500)
      await page.evaluate(() => window.bloomProfile.start())
      await page.waitForTimeout(5000)
      const samples = await page.evaluate(() => window.bloomProfile.stop())
      const active = await page.evaluate(() => !!window.syn3h.game.post?.active)
      const row = {
        width, height, case: name, settings, active, load: +loadavg()[0].toFixed(2), ...setup, frames: samples.length,
        frameMs: percentile(samples.map(s => s.frameMs), 0.5), p95Ms: percentile(samples.map(s => s.frameMs), 0.95),
        renderCpuMs: percentile(samples.map(s => s.drawMs), 0.5), gpuMs: percentile(samples.map(s => s.gpuMs), 0.5),
        drawCalls: percentile(samples.map(s => s.drawCalls), 0.5), errors,
      }
      results.push(row)
      console.log(JSON.stringify(row))
      await context.close()
    }
  }
} finally { await browser.close() }
await writeFile(output, JSON.stringify({ url, def, max, uncapped: uncapped.length > 0, results }, null, 2))
const fmt = v => v === null ? 'n/a' : v.toFixed(2)
console.log('\n| Size | Case | Load | Frame ms | p95 ms | Render CPU ms | GPU ms | Draws |\n|---|---|---:|---:|---:|---:|---:|---:|')
for (const r of results) console.log(`| ${r.width}x${r.height} | ${r.case}${r.settings ? ` (${r.settings.strength}, ${r.settings.threshold}, ${r.settings.radius})` : ''} | ${r.load} | ${fmt(r.frameMs)} | ${fmt(r.p95Ms)} | ${fmt(r.renderCpuMs)} | ${fmt(r.gpuMs)} | ${r.drawCalls} |`)
