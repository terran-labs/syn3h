/**
 * Does warming vehicle kinds remove the compile from a switch? Measured in a real browser.
 * Run one at a time through tools/heavy.sh, against your own dev server:
 *
 *   SYN3H_URL=http://localhost:5199/ tools/heavy.sh node tests/vehicles2/warm-kinds-browser.mjs
 *
 * The swap itself is not on this branch, so a switch is stood in for by what it costs the
 * renderer: a new vehicle of a kind added to the live scene, in front of the camera. Two
 * page loads, both driving the buggy: one cold, one after warmVehicleKinds (src/vehicles/
 * warmKinds.ts). In each, every other kind is added in turn, drawn for two seconds, then
 * disposed; then added again, which is what switching back to a kind does. Render pipelines
 * are counted as the renderer asks the GPU for them, between the add and the end of the
 * window. Asserted: with warming, zero on every add, the first included; cold, some on the
 * first add of each kind (so a zero means something). Frame gaps are reported, not
 * asserted: they depend on how busy the machine is. Vehicle effects (dust, lamps, the
 * materialize shader) are not added: they belong to other lanes and are reported as such.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL to your own dev server')
const KINDS = ['jet', 'hovercraft', 'tank']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = {}
try {
  for (const mode of ['cold', 'warm']) {
    const errors = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', e => errors.push(e.message))
    const url = new URL(base)
    url.searchParams.set('vehicle', 'buggy')
    url.searchParams.set('autoplay', '1')
    url.searchParams.set('room', `warm-kinds-${mode}-${Date.now()}`)
    await page.goto(url.href, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3h.game.tick > 60, null, { timeout: 120000 })
    await page.evaluate(() => {
      const p = window.syn3h.params
      p.set('gfx.auto', false); p.set('bots.count', 0)
      let made = 0
      const device = window.syn3h.game.renderer.backend.device
      if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
        const real = device[name].bind(device)
        device[name] = d => { made++; (window.__labels ??= []).push(d.label); return real(d) }
      }
      let last = 0, worst = 0, running = false
      const tick = t => { if (running) { if (last) worst = Math.max(worst, t - last); last = t; requestAnimationFrame(tick) } }
      window.__win = {
        start() { this.from = made; window.__labels = []; last = 0; worst = 0; running = true; requestAnimationFrame(tick) },
        stop() { running = false; return { pipelines: made - this.from, worstFrameMs: Math.round(worst), labels: window.__labels.slice(0, 12) } },
      }
    })
    const backend = await page.evaluate(() => window.syn3h.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')
    let warm = null
    if (mode === 'warm') {
      warm = await page.evaluate(async () => {
        const { warmVehicleKinds } = await import('/src/vehicles/warmKinds.ts')
        const t = performance.now()
        const w = window.__warm = warmVehicleKinds(window.syn3h.game, window.syn3h.terrain)
        await w.done
        return { ms: Math.round(performance.now() - t), ...w.stats() }
      })
    }
    // Let what is already in view finish compiling.
    await page.waitForTimeout(3000)
    await page.evaluate(() => window.__win.start())
    await page.waitForTimeout(2000)
    const idle = await page.evaluate(() => window.__win.stop())
    const adds = {}
    for (const kind of KINDS) {
      adds[kind] = []
      for (let n = 0; n < 2; n++) {
        await page.evaluate(async kind => {
          const { createVehicle } = await import('/src/vehicles/index.ts')
          const THREE = await import('three/webgpu')
          const s = window.syn3h, cam = s.game.camera
          const at = cam.getWorldPosition(new THREE.Vector3()).add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(9))
          window.__win.start()
          const v = window.__added = createVehicle(s.game, s.terrain, kind, at, 0)
          v.isLocal = false
          v.body.setGravityScale(0, true)
          s.game.add(v)
        }, kind)
        await page.waitForTimeout(2000)
        adds[kind].push(await page.evaluate(() => {
          const r = window.__win.stop()
          r.meshesDrawn = 0; window.__added.object.traverse(o => { if (o.isMesh && o.visible) r.meshesDrawn++ })
          window.syn3h.game.remove(window.__added)
          return r
        }))
        await page.waitForTimeout(800)
      }
    }
    report[mode] = { backend, warm, idle, adds, errors }
    await page.close()
  }
  console.log(JSON.stringify(report, null, 2))
  for (const mode of ['cold', 'warm']) assert.deepEqual(report[mode].errors, [], `${mode}: page errors`)
  for (const kind of KINDS) {
    assert.ok(report.cold.adds[kind][0].pipelines > 0, `cold ${kind}: the first add built pipelines, so the check can see them`)
    for (const [n, add] of report.warm.adds[kind].entries()) assert.equal(add.pipelines, 0, `warm ${kind} add ${n + 1}: built ${add.labels.join(', ')}`)
  }
  console.log('WARM KINDS CHECK OK')
} finally { await browser.close() }
