/**
 * Frame cost of the rich ground (terrain.detailNormal, surfaceResponse, macroColour, accent),
 * which is on by default. One page, fixed quality and pixel ratio, the camera parked on open
 * ground; the four sliders go on and off in turn, so drift in host load lands on both sides.
 * Reports the median GPU timestamp time and frame interval of each pass and the paired difference.
 * Run through tools/heavy.sh:
 *
 *   node tools/terrainlab/rich-cost.mjs [baseUrl] [out.json] [world,world] [rounds] [split]
 *
 * With `split`, each slider is also measured on its own against all four off.
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/terrainlab/rich-cost.json'
const worlds = (process.argv[4] ?? 'volcanic.1,desert.7').split(',')
const rounds = Number(process.argv[5] ?? 3)
const IDS = ['terrain.detailNormal', 'terrain.surfaceResponse', 'terrain.macroColour', 'terrain.accent']
// Each case is the list of sliders that are on.
const cases = process.argv[6] === 'split' ? [IDS, [], ...IDS.map((id) => [id])] : [IDS, []]
const label = (on) => on.length === IDS.length ? 'all' : on.length ? on[0].slice(8) : 'none'
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
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 120000 })
    const setup = await page.evaluate(async () => {
      const s = window.mira, g = s.game, r = g.renderer
      s.params.set('gfx.level', 2); s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 11)
      r.setPixelRatio(1)
      r.backend.trackTimestamp = r.hasFeature?.('timestamp-query') ?? false
      const samples = []
      let collecting = false, pending = false, lastGpu = null
      // Hold the requested quality: no adaptive downgrade while measuring.
      g.quality.frame = (m) => {
        if (collecting) samples.push({ frameMs: m.frameMs, gpuMs: lastGpu })
        if (r.backend.trackTimestamp && !pending) { pending = true; r.resolveTimestampsAsync().then((v) => { lastGpu = v }).finally(() => { pending = false }) }
      }
      window.richCost = {
        set(on) { for (const id of ['terrain.detailNormal', 'terrain.surfaceResponse', 'terrain.macroColour', 'terrain.accent']) s.params.set(id, on.includes(id) ? 1 : 0) },
        start() { samples.length = 0; collecting = true },
        stop() { collecting = false; return samples.slice() },
      }
      const info = (await navigator.gpu?.requestAdapter())?.info
      return { backend: g.backend, timestamps: r.backend.trackTimestamp, adapter: info ? `${info.vendor} ${info.architecture}` : null }
    })
    const passes = []
    for (let round = 0; round < rounds; round++) {
      for (const on of cases) {
        await page.evaluate((v) => window.richCost.set(v), on)
        await page.waitForTimeout(2500) // the material rebuilds and its pipeline compiles
        await page.evaluate(() => window.richCost.start())
        await page.waitForTimeout(4000)
        const samples = await page.evaluate(() => window.richCost.stop())
        passes.push({ on: label(on), frames: samples.length, gpuMs: median(samples.map((s) => s.gpuMs)), frameMs: median(samples.map((s) => s.frameMs)), load: loadavg()[0] })
      }
    }
    const pick = (on, key) => median(passes.filter((p) => p.on === on).map((p) => p[key]))
    const summary = Object.fromEntries(cases.map((c) => [label(c), { gpuMs: pick(label(c), 'gpuMs'), frameMs: pick(label(c), 'frameMs') }]))
    report.push({ world, ...setup, summary, passes, errors })
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(out, JSON.stringify(report, null, 2))
for (const r of report) console.log(JSON.stringify({ world: r.world, backend: r.backend, adapter: r.adapter, timestamps: r.timestamps, summary: r.summary, passes: r.passes.map((p) => `${p.on} gpu ${p.gpuMs?.toFixed?.(2)} frame ${p.frameMs?.toFixed?.(1)} load ${p.load.toFixed(1)}`), errors: r.errors }))
