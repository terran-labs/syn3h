/**
 * What Plasma Thunder's first firework builds in play, after the covered world entry
 * (Game.precompile). The owner's rule: a freeze in play is worse than a longer load, so the
 * first burst must build no shader (no node build, no render pipeline). Counts are exact, not
 * timings, read from the renderer's own counter (src/core/longFrameRenderer.ts, totals in
 * diagnosticShaders.ts), which covers the whole scene on WebGPU and WebGL 2; the probe checks the
 * counter is live by seeing a graphics level change's rebuild. At night and at noon (the daytime
 * stars and smoke are drawn only by day), with the ground glow, on both backends.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/fireworks-pipelines.mjs
 *
 * Prints, per backend and time of day, what was built while idle in play (for comparison), in the five
 * seconds after the first burst, then with three more at once (the other ground glow slots), and
 * for the night entry, as day comes (the daytime stars and smoke first drawn), with labels;
 * exits 1 if any of those built anything.
 */
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? 'http://127.0.0.1:5428/').replace(/\/+$/, '') + '/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
let built = 0
try {
  for (const webgl of [false, true]) for (const [when, hour] of [['night', 22], ['noon', 12]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const url = new URL(base)
    url.searchParams.set('world', `alpine.7~sun.dayLength=0,sun.timeOfDay=${hour}`)
    url.searchParams.set('autoplay', '1')
    url.searchParams.set('room', `fw-pipelines-${when}-${Date.now()}`)
    if (webgl) url.searchParams.set('webgl', '1')
    await page.goto(url.href)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.lasers?.fireworks && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(() => { const p = window.syn3h.params; p.set('gfx.auto', false); p.set('bots.count', 0); p.set('daydream.seconds', 0) })
    await page.waitForTimeout(3000)
    const backend = await page.evaluate(() => window.syn3h.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')
    // The renderer's running totals of node builds and render pipelines, the whole scene.
    const totals = () => page.evaluate(async () => {
      const line = (await import('/src/core/diagnosticShaders.ts')).shaderReportLines().find(l => l.startsWith('Whole session')) ?? ''
      const n = kind => Number(line.match(new RegExp(`${kind} ×(\\d+)`))?.[1] ?? NaN)
      return { builds: n('Node build'), pipelines: n('Render pipeline') }
    })
    const marks = { start: await totals() }
    await page.waitForTimeout(3000)
    marks.idle = await totals()
    await page.evaluate(() => {
      window.__phase = 'burst'
      const s = window.syn3h, c = s.game.camera, F = window.syn3hNet.lasers.fireworks
      const d = c.getWorldDirection(c.position.clone()); d.y = 0; d.normalize()
      const at = c.position.clone().addScaledVector(d, 60)
      at.y = s.terrain.heightAt(at.x, at.z)
      F.burst({ at, climb: 60, ground: at.y - 0.3, colors: [{ r: 0.9, g: 0.08, b: 0.05 }, { r: 1, g: 0.75, b: 0.3 }], seed: 7, heightAt: (x, z) => s.terrain.heightAt(x, z) })
    })
    await page.waitForTimeout(5000)
    marks.burst = await totals()
    await page.evaluate(() => {
      window.__phase = 'more'
      const s = window.syn3h, c = s.game.camera, F = window.syn3hNet.lasers.fireworks
      const d = c.getWorldDirection(c.position.clone()); d.y = 0; d.normalize()
      for (let k = 0; k < 3; k++) {
        const at = c.position.clone().addScaledVector(d, 70 + 15 * k).add(d.clone().set(-d.z, 0, d.x).multiplyScalar((k - 1) * 25))
        at.y = s.terrain.heightAt(at.x, at.z)
        F.burst({ at, climb: 50, ground: at.y - 0.3, colors: [{ r: 0.2, g: 0.5, b: 1 }, { r: 1, g: 1, b: 1 }], seed: 11 + k, heightAt: (x, z) => s.terrain.heightAt(x, z) })
      }
    })
    await page.waitForTimeout(5000)
    marks.more = await totals()
    if (when === 'night') {
      await page.evaluate(() => { window.__phase = 'day comes'; window.syn3h.params.set('sun.timeOfDay', 12) })
      await page.waitForTimeout(3000)
      await page.evaluate(() => {
        const s = window.syn3h, c = s.game.camera, F = window.syn3hNet.lasers.fireworks
        const d = c.getWorldDirection(c.position.clone()); d.y = 0; d.normalize()
        const at = c.position.clone().addScaledVector(d, 60); at.y = s.terrain.heightAt(at.x, at.z)
        F.burst({ at, climb: 60, ground: at.y - 0.3, colors: [{ r: 0.9, g: 0.08, b: 0.05 }, { r: 1, g: 0.75, b: 0.3 }], seed: 21, heightAt: (x, z) => s.terrain.heightAt(x, z) })
      })
      await page.waitForTimeout(4000)
      marks.day = await totals()
    }
    // The counter is live: a graphics level change rebuilds the fireworks' batches, and it counts that.
    const level = await page.evaluate(() => window.syn3h.params.get('gfx.level').value)
    await page.evaluate(level => window.syn3h.params.set('gfx.level', level > 0 ? 0 : 2), level)
    await page.waitForTimeout(4000)
    const live = await totals()
    const delta = (a, b) => ({ builds: b.builds - a.builds, pipelines: b.pipelines - a.pipelines })
    const idle = delta(marks.start, marks.idle), burst = delta(marks.idle, marks.burst), more = delta(marks.burst, marks.more)
    const day = marks.day ? delta(marks.more, marks.day) : undefined
    const levelChange = delta(marks.day ?? marks.more, live)
    for (const w of [burst, more, day]) if (w) built += w.builds + w.pipelines
    if (!(levelChange.builds + levelChange.pipelines > 0)) { built += 1000; errors.push('the counter saw no build on a level change: not live') }
    report.push({ when, backend, idle, burst, more, ...(day ? { dayComes: day } : {}), levelChange, errors: errors.slice(0, 3) })
    await page.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(report, null, 1))
console.log(built ? `FIREWORKS BUILT ${built} IN PLAY` : 'FIREWORKS PIPELINES OK')
process.exit(built ? 1 : 0)
