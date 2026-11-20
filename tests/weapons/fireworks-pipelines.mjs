/**
 * What Plasma Thunder's first firework builds in play, after the covered world entry
 * (Game.precompile). The owner's rule: a freeze in play is worse than a longer load, so the
 * first burst must build no shader module and no render pipeline. Counts are exact, not timings.
 * At night and at noon (the daytime stars and smoke are drawn only by day), with the ground glow.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/fireworks-pipelines.mjs
 *
 * Prints, per time of day, what was built while idle in play (for comparison), in the five
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
  for (const [when, hour] of [['night', 22], ['noon', 12]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const url = new URL(base)
    url.searchParams.set('world', `alpine.7~sun.dayLength=0,sun.timeOfDay=${hour}`)
    url.searchParams.set('autoplay', '1')
    url.searchParams.set('room', `fw-pipelines-${when}-${Date.now()}`)
    await page.goto(url.href)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.lasers?.fireworks && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(() => { const p = window.syn3h.params; p.set('gfx.auto', false); p.set('bots.count', 0); p.set('daydream.seconds', 0) })
    await page.waitForTimeout(3000)
    const backend = await page.evaluate(() => {
      const r = window.syn3h.game.renderer, device = r.backend.device
      const log = window.__built = []
      if (device) {
        for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
          const real = device[name].bind(device)
          device[name] = d => { log.push({ phase: window.__phase, kind: 'pipeline', label: String(d.label) }); return real(d) }
        }
        const real = device.createShaderModule.bind(device)
        device.createShaderModule = d => { log.push({ phase: window.__phase, kind: 'module', label: String(d.label) }); return real(d) }
      }
      window.__phase = 'idle'
      return r.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
    })
    await page.waitForTimeout(3000)
    await page.evaluate(() => {
      window.__phase = 'burst'
      const s = window.syn3h, c = s.game.camera, F = window.syn3hNet.lasers.fireworks
      const d = c.getWorldDirection(c.position.clone()); d.y = 0; d.normalize()
      const at = c.position.clone().addScaledVector(d, 60)
      at.y = s.terrain.heightAt(at.x, at.z)
      F.burst({ at, climb: 60, ground: at.y - 0.3, colors: [{ r: 0.9, g: 0.08, b: 0.05 }, { r: 1, g: 0.75, b: 0.3 }], seed: 7, heightAt: (x, z) => s.terrain.heightAt(x, z) })
    })
    await page.waitForTimeout(5000)
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
    }
    const log = await page.evaluate(() => window.__built)
    const count = phase => ({ pipelines: log.filter(x => x.phase === phase && x.kind === 'pipeline').length, modules: log.filter(x => x.phase === phase && x.kind === 'module').length, labels: [...new Set(log.filter(x => x.phase === phase).map(x => x.label))].slice(0, 12) })
    const idle = count('idle'), burst = count('burst'), more = count('more'), day = when === 'night' ? count('day comes') : undefined
    for (const w of [burst, more, day]) if (w) built += w.pipelines + w.modules
    report.push({ when, backend, idle, burst, more, ...(day ? { dayComes: day } : {}), errors: errors.slice(0, 3) })
    await page.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(report, null, 1))
console.log(built ? `FIREWORKS BUILT ${built} IN PLAY` : 'FIREWORKS PIPELINES OK')
process.exit(built ? 1 : 0)
