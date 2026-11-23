/**
 * GPU time and frame interval of the same parked view at each performance level's ground
 * tier (plain, colour only, everything), with everything else held at the desktop level, so
 * the numbers show what the ground shader alone sheds. Passes alternate to spread host drift.
 * Run through tools/heavy.sh:
 *
 *   node tools/terrainlab/level-cost.mjs [baseUrl] [out.json] [world,world] [rounds] [extra query]
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/terrainlab/level-cost.json'
const worlds = (process.argv[4] ?? 'volcanic.1,desert.7').split(',')
const rounds = Number(process.argv[5] ?? 3)
const extra = process.argv[6] ?? ''
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const median = (v) => { v = v.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null }
const report = []
try {
  for (const world of worlds) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}${extra}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 180000 })
    const setup = await page.evaluate(async () => {
      const s = window.mira, g = s.game, r = g.renderer
      s.params.set('gfx.auto', false); s.params.set('gfx.level', 2); s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 11)
      r.setPixelRatio(1)
      r.backend.trackTimestamp = r.hasFeature?.('timestamp-query') ?? false
      const samples = []
      let collecting = false, pending = false, lastGpu = null
      g.quality.frame = (m) => {
        if (collecting) samples.push({ frameMs: m.frameMs, gpuMs: lastGpu })
        if (r.backend.trackTimestamp && !pending) { pending = true; r.resolveTimestampsAsync().then((v) => { lastGpu = v }).finally(() => { pending = false }) }
      }
      window.levelCost = {
        // Only the ground shader's tier changes; chunk detail, shadows and plants stay as they are.
        set(share) { s.terrain.look.setDetail(share) },
        start() { samples.length = 0; collecting = true },
        stop() { collecting = false; return samples.slice() },
      }
      return { backend: g.backend, timestamps: r.backend.trackTimestamp }
    })
    const passes = []
    for (let round = 0; round < rounds; round++) {
      for (const [name, share] of [['everything', 1], ['colour', 0.75], ['plain', 0.5]]) {
        await page.evaluate((v) => window.levelCost.set(v), share)
        await page.waitForTimeout(2500)
        await page.evaluate(() => window.levelCost.start())
        await page.waitForTimeout(4000)
        const samples = await page.evaluate(() => window.levelCost.stop())
        passes.push({ name, frames: samples.length, gpuMs: median(samples.map((s) => s.gpuMs)), frameMs: median(samples.map((s) => s.frameMs)), load: loadavg()[0] })
      }
    }
    const summary = Object.fromEntries(['everything', 'colour', 'plain'].map((n) => [n, { gpuMs: median(passes.filter((p) => p.name === n).map((p) => p.gpuMs)), frameMs: median(passes.filter((p) => p.name === n).map((p) => p.frameMs)) }]))
    report.push({ world, ...setup, summary, passes, errors })
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(out, JSON.stringify(report, null, 2))
for (const r of report) console.log(JSON.stringify({ world: r.world, backend: r.backend, timestamps: r.timestamps, summary: r.summary, passes: r.passes.map((p) => `${p.name} gpu ${p.gpuMs?.toFixed?.(1)} frame ${p.frameMs?.toFixed?.(1)} load ${p.load.toFixed(1)}`), errors: r.errors }))
