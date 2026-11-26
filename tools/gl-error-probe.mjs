// Run from a checkout with dependencies: tools/heavy.sh node tools/gl-error-probe.mjs [built checkout or release snapshot]
//
// GL errors and shaders built in play, which no other check sees. On WebGL 2 every GL call is
// followed by getError, through loading, play, a quality change down and back up, four bots
// arriving and a vehicle switch and back; on WebGPU and WebGL 2 every node graph built and
// pipeline requested after the player is in play is counted. Fails (exit 1) on any GL error or
// any build in play. Written for v26.11.2601, whose WebGL 2 build polled deleted programs every
// frame (GL_INVALID_VALUE from getProgramParameter COMPLETION_STATUS_KHR).
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'
const dir = process.argv[2] ?? '.'
let failed = false
const app = await serveStable({ dir, port: 0 })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
for (const backend of ['webgl', 'webgpu']) {
const label = backend
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
await page.addInitScript(() => {
  const log = window.__glErrors = []
  window.__phase = 'loading'
  const proto = WebGL2RenderingContext.prototype
  window.__built = []
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'getError' || name === 'constructor') continue
    const d = Object.getOwnPropertyDescriptor(proto, name)
    if (!d || typeof d.value !== 'function') continue
    const f = d.value
    proto[name] = function (...args) {
      const r = f.apply(this, args)
      const e = proto.getError.call(this)
      const inPhase = log.filter((x) => x.phase === window.__phase).length
      if (e !== 0 && inPhase < 400) {
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
        log.push({ phase: window.__phase, name, error: e, frame: window.mira?.game?.frames ?? -1, t: Math.round(performance.now()), centre: top ? `${top.tagName.toLowerCase()}${top.className && typeof top.className === 'string' ? '.' + top.className.split(' ').join('.') : ''}` : 'none', playing: !!window.mira?.shell?.playing, transitioning: !!window.mira?.shell?.transitioning })
      }
      return r
    }
  }
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`http://127.0.0.1:${app.server.address().port}/?planet=alpine&seed=4&autoplay=1&vehicle=buggy&daydream=0&room=glp2-${label}-${Date.now().toString(36)}${backend === 'webgl' ? '&webgl=1' : ''}`)
await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.shell.transitioning, null, { timeout: 90000 })
const entry = await page.evaluate(() => ({ frame: window.mira.game.frames, t: Math.round(performance.now()) }))
await page.evaluate(() => {
  const b = window.mira.game.renderer.backend, builder = b.createNodeBuilder, pipeline = b.createRenderPipeline
  const id = (o, m) => `${o?.name || o?.type}/${m?.name || m?.type}`
  b.createNodeBuilder = function (...args) { const node = builder.apply(this, args), build = node.build; node.build = function (...a) { window.__built.push({ phase: window.__phase, what: 'graph ' + id(this.object, this.material) }); return build.apply(this, a) }; return node }
  b.createRenderPipeline = function (ro, ...args) { window.__built.push({ phase: window.__phase, what: 'pipeline ' + id(ro.object, ro.material) }); return pipeline.call(this, ro, ...args) }
})
await page.evaluate(() => { window.__phase = 'play'; const { params, game } = window.mira; game.quality.setAuto(false); params.set('sun.timeOfDay', 23); params.set('bots.count', 0); params.set('daydream.seconds', 0) })
await page.waitForTimeout(5000)
// Settled: which named materials draw, and with a linked program, over 30 frames.
const NAMES = ['paint showroom 1', 'Smooth tyres and chrome rings showroom 1', 'Stators showroom 1', 'Shocks showroom 1', 'Suspension arms showroom 1']
const drawn = await page.evaluate(async (names) => {
  const b = window.mira.game.renderer.backend, gl = b.gl, draw = b.draw, seen = {}
  b.draw = function (ro, ...a) {
    const r = draw.call(this, ro, ...a)
    const m = ro.material?.name ?? ''
    // The buggy's own materials, whatever tier they are at now.
    const key = names.find((n) => m === n) ?? (/mira buggy skin/.test(ro.object?.parent?.name ?? '') || /mira buggy skin/.test(ro.object?.parent?.parent?.name ?? '') ? m : null)
    if (key) { const p = gl.getParameter(gl.CURRENT_PROGRAM); const s = seen[key] ??= { draws: 0, linked: 0 }; s.draws++; if (p && gl.getProgramParameter(p, gl.LINK_STATUS)) s.linked++ }
    return r
  }
  for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))
  b.draw = draw
  return seen
}, NAMES)
const quality = await page.evaluate(() => window.mira.game.quality.governor.level)
// Repeats.
const phase = async (name, run) => { await page.evaluate((n) => { window.__phase = n }, name); await page.evaluate(run); await page.waitForTimeout(6000) }
await phase('quality change', () => window.mira.game.quality.setLevel(Math.max(0, window.mira.game.quality.governor.level - 1)))
await phase('quality back', () => window.mira.game.quality.setLevel(window.mira.game.quality.governor.level + 1))
await phase('bots arrive', () => { window.mira.params.set('bots.fleet', 1); window.mira.params.set('bots.count', 4) })
await phase('switch to hovercraft', () => window.mira.swapVehicle('hovercraft'))
await phase('switch back to buggy', () => window.mira.swapVehicle('buggy'))
const log = await page.evaluate(() => window.__glErrors)
const byPhase = {}
for (const e of log) { const k = `${e.phase}: ${e.name} ${e.error}`; byPhase[k] = byPhase[k] ?? { count: 0, firstFrame: e.frame, centre: e.centre, playing: e.playing, transitioning: e.transitioning }; byPhase[k].count++; byPhase[k].lastFrame = e.frame; byPhase[k].lastTransitioning = e.transitioning }
console.log(`${label}: entry (play, no transition) at frame ${entry.frame}; quality level ${quality}`)
console.log(`${label}: GL errors by phase ${JSON.stringify(byPhase, null, 1)}`)
console.log(`${label}: buggy materials over 30 frames, settled ${JSON.stringify(drawn)}`)
const built = await page.evaluate(() => window.__built)
const builtByPhase = {}
for (const b of built) (builtByPhase[b.phase] ??= []).push(b.what)
console.log(`${label}: built in play ${built.length} ${JSON.stringify(builtByPhase)}`)
console.log(`${label}: page errors ${errors.length}`)
if (log.length || built.length || errors.length || Object.values(drawn).some((d) => d.draws !== d.linked)) failed = true
await page.close()
}
await browser.close()
await app.close?.()
console.log(failed ? 'GL ERROR PROBE: FAILED' : 'GL ERROR PROBE: clean')
process.exit(failed ? 1 : 0)
