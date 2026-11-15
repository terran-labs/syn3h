/**
 * Post effects and cinematic look frame cost, after the Bots, Performance and QA lane's bloom profile: headed
 * Chrome on the GPU, vsync and the frame limit off (frame time shows the cost), a fresh
 * context per case, graphics level 2, pixel ratio 1, the governor held still, 2.5 s warm-up
 * and 5 s of samples. Cases run off, base, full, full, base, off, so drift shows.
 *
 *   tools/heavy.sh node tools/post-profile.mjs [URL] [output JSON]
 *
 * base is the colour look, vignette and grain only (one pass); full adds glow, sun shafts and
 * the lens flare. The renderer's GPU timestamps overcount on multi-pass pipelines, so frame
 * time is the measure. Load average is recorded per case; treat spread as noise.
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { writeFile } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://127.0.0.1:5207/'
const output = process.argv[3] ?? '/tmp/post-profile.json'
const sep = url.includes('?') ? '&' : '?'
const giOnly = process.argv.includes('--gi')
const cases = giOnly ? ['gi-off', 'gi-on', 'gi-on', 'gi-off'] : ['off', 'cinematic', 'cinematic', 'off']
const percentile = (values, p) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null }
const results = []
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
try {
  for (const [width, height] of [[1920, 1080]]) {
    for (const name of cases) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(`${url}${sep}autoplay=1&gfx=2&room=post-profile-${Date.now()}`)
      await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 90000 })
      const setup = await page.evaluate(name => {
        const s = window.syn3h, g = s.game, r = g.renderer
        s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 17.6)
        g.quality.frame = () => {}; r.setPixelRatio(1)
        s.params.set('post.on', name !== 'off')
        if (name.startsWith('gi-')) s.params.set('post.gi', name === 'gi-on' ? 1 : 0)
        // cinematic: the post chain plus the light rig, aerial perspective and terrain material.
        if (name === 'cinematic') for (const [k, v] of Object.entries({ 'light.bounce': 1, 'weather.aerial': 1, 'terrain.detailNormal': 1, 'terrain.surfaceResponse': 1, 'terrain.macroColour': 1, 'terrain.accent': 1 })) s.params.set(k, v)
        const chain = g.postChain
        let drawMs = 0
        const render = chain.render.bind(chain)
        chain.render = (...a) => { const t = performance.now(); render(...a); drawMs += performance.now() - t }
        const samples = []; let collecting = false
        g.add({ update() { if (collecting) samples.push({ frameMs: g.performance.frameMs, drawMs, drawCalls: g.performance.drawCalls }); drawMs = 0 } })
        window.postProfile = { start() { samples.length = 0; collecting = true }, stop() { collecting = false; return samples } }
        return { backend: g.backend, drawingBuffer: [r.domElement.width, r.domElement.height] }
      }, name)
      await page.waitForTimeout(2500)
      await page.evaluate(() => window.postProfile.start())
      await page.waitForTimeout(5000)
      const samples = await page.evaluate(() => window.postProfile.stop())
      const tier = await page.evaluate(() => window.syn3h.game.postChain.tier)
      const row = { width, height, case: name, tier, load: +loadavg()[0].toFixed(2), ...setup, frames: samples.length,
        frameMs: percentile(samples.map(s => s.frameMs), 0.5), p95Ms: percentile(samples.map(s => s.frameMs), 0.95),
        renderCpuMs: percentile(samples.map(s => s.drawMs), 0.5), drawCalls: percentile(samples.map(s => s.drawCalls), 0.5), errors }
      results.push(row)
      console.log(JSON.stringify(row))
      await context.close()
    }
  }
} finally { await browser.close() }
await writeFile(output, JSON.stringify({ url, results }, null, 2))
const fmt = v => v === null ? 'n/a' : v.toFixed(2)
console.log('\n| Size | Case | Tier | Load | Frame ms | p95 ms | Render CPU ms | Draws |\n|---|---|---|---:|---:|---:|---:|---:|')
for (const r of results) console.log(`| ${r.width}x${r.height} | ${r.case} | ${r.tier} | ${r.load} | ${fmt(r.frameMs)} | ${fmt(r.p95Ms)} | ${fmt(r.renderCpuMs)} | ${r.drawCalls} |`)
