/** Temporal convergence, history reset and quality lifecycle. Run through heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [base, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], results = []
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('room', `temporal-accept-${Date.now()}`)
  if (process.argv.includes('--webgl')) url.searchParams.set('webgl', '1')
  await page.goto(url.href, { timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 120, null, { timeout: 120000 })
  await page.evaluate(async () => {
    const s = window.syn3h, g = s.game, p = s.params
    g.renderer.setAnimationLoop(null); g.postChain.release()
    const moduleUrl = performance.getEntriesByType('resource').find(r => r.name.includes('/three_webgpu.js'))?.name
    const T = await import(moduleUrl)
    for (const id of ['post.gi','post.clouds','post.bloom','post.shafts','post.flare','post.ao','post.contact','post.motionBlur','post.heat','post.look','post.vignette','post.grain']) p.set(id, 0)
    p.set('world.curve', 0); p.set('gfx.level', 2); p.set('post.temporal', true); p.set('post.on', true)
    g.quality.frame = () => {}
    Object.defineProperty(g.quality, 'postBudget', { configurable: true, get: () => window.temporalFixture?.budget ?? 1 })
    const scene = new T.Scene(); scene.background = new T.Color(0)
    const camera = new T.PerspectiveCamera(60, 640 / 360, .1, 100)
    camera.position.z = 10; camera.updateMatrixWorld()
    const plane = new T.Mesh(new T.PlaneGeometry(1.3, 5.1), new T.MeshBasicNodeMaterial({ color: 0xffffff }))
    plane.rotation.z = .37; scene.add(plane)
    const draw = async (frames = 1) => {
      for (let i = 0; i < frames; i++) {
        window.__syn3hCurve.updateCurve(camera.position, s.terrain.size)
        g.postChain.render(g.renderer, scene, camera, 16.667)
        await new Promise(requestAnimationFrame)
      }
    }
    const read = async () => {
      const target = g.postChain.built.temporalNode._resolveRenderTarget
      const data = await g.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height)
      return Array.from(data, v => data instanceof Uint16Array ? T.DataUtils.fromHalfFloat(v) : v)
    }
    window.temporalFixture = { T, scene, camera, plane, draw, read, budget: 1 }
  })
  const convergence = await page.evaluate(async () => {
    const f = window.temporalFixture, g = window.syn3h.game
    await f.draw(40); const first = await f.read()
    await f.draw(32); const second = await f.read()
    let difference = 0, fractional = 0
    for (let i = 0; i < first.length; i += 4) {
      difference += Math.abs(first[i] - second[i])
      if (second[i] > .02 && second[i] < .98) fractional++
    }
    f.still = second
    return { name: 'convergence', backend: g.backend, difference: difference / (first.length / 4), fractional, finite: second.every(Number.isFinite), samples: g.postChain.built.disposables.find(x => x.getMRT?.()?.has('velocity')).renderTarget.samples }
  })
  results.push(convergence)
  assert.equal(convergence.finite, true); assert.equal(convergence.samples, 0)
  assert.ok(convergence.fractional > 20, 'diagonal edges accumulate subpixel coverage')
  assert.ok(convergence.difference < .002, 'stationary image converges')
  await page.screenshot({ path: `${out}/converged.png` })

  const motion = await page.evaluate(async () => {
    const f = window.temporalFixture, g = window.syn3h.game
    const velocityAtCentre = async () => {
      const target = g.postChain.built.disposables.find(x => x.getMRT?.()?.has('velocity')).renderTarget
      const data = await g.renderer.readRenderTargetPixelsAsync(target, target.width / 2, target.height / 2, 1, 1, 1)
      return Array.from(data, v => data instanceof Uint16Array ? f.T.DataUtils.fromHalfFloat(v) : v).slice(0, 2)
    }
    f.plane.position.x += .1; await f.draw(); const object = await velocityAtCentre()
    f.plane.position.x -= .1; await f.draw(3)
    f.camera.position.x += .1; await f.draw(); const camera = await velocityAtCentre()
    f.camera.position.x -= .1; await f.draw(3)
    const { SkyEnvironmentMap } = await import('/src/world/sky/SkyEnvironmentMap.ts')
    const sky = g.scene.children.find(o => 'cloudLayerVisible' in o)
    const reflection = new SkyEnvironmentMap(g.scene, g.renderer, sky)
    try { reflection.update(1, 12) } finally { reflection.dispose() }
    await f.draw(); const afterReflection = await velocityAtCentre()
    await f.draw(32); f.still = await f.read()
    return { name: 'motion', object, camera, afterReflection, expected: .1 * f.camera.projectionMatrix.elements[0] / 10 }
  })
  results.push(motion)
  assert.ok(Math.abs(motion.object[0] - motion.expected) < .0001)
  assert.ok(Math.abs(motion.camera[0] + motion.expected) < .0001)
  assert.ok(motion.afterReflection.every(v => Math.abs(v) < .0001), 'reflection renders do not corrupt motion history')

  for (const kind of ['wrap', 'teleport', 'rotation', 'resize']) {
    const result = await page.evaluate(async kind => {
      const s = window.syn3h, g = s.game, f = window.temporalFixture
      const before = g.postChain.historyResets
      if (kind === 'wrap') { f.camera.position.x += s.terrain.size; f.plane.position.x += s.terrain.size }
      if (kind === 'teleport') f.camera.position.x += 100
      if (kind === 'rotation') f.camera.rotateY(Math.PI / 2)
      if (kind === 'resize') { g.renderer.setSize(320, 180, false); f.camera.aspect = 320 / 180; f.camera.updateProjectionMatrix() }
      await f.draw()
      const pixels = await f.read(), node = g.postChain.built.temporalNode
      const red = pixels.filter((_, i) => i % 4 === 0)
      const result = { name: kind, reset: g.postChain.historyResets > before, finite: pixels.every(Number.isFinite), max: red.reduce((m, v) => Math.max(m, v), 0), width: node._resolveRenderTarget.width, height: node._resolveRenderTarget.height }
      if (kind === 'wrap') result.equivalentDifference = red.reduce((sum, value, i) => sum + Math.abs(value - f.still[i * 4]), 0) / red.length
      if (kind === 'teleport') f.camera.position.x -= 100
      if (kind === 'rotation') f.camera.rotateY(-Math.PI / 2)
      await f.draw(3)
      return result
    }, kind)
    results.push(result); assert.equal(result.finite, true)
    if (kind !== 'resize') assert.equal(result.reset, true)
    if (kind === 'wrap') assert.ok(result.equivalentDifference < .01, 'wrap resets without a stale image')
    if (kind === 'teleport' || kind === 'rotation') assert.ok(result.max < .001, 'camera cut leaves no old silhouette')
    if (kind === 'resize') { assert.equal(result.width, 320); assert.equal(result.height, 180) }
  }
  for (const c of [
    { name: 'explicit-off', temporal: false }, { name: 'restored' },
    { name: 'lite', level: 1 }, { name: 'safe', level: 0 },
    { name: 'shed', budget: 0 }, { name: 'full' },
  ]) {
    const result = await page.evaluate(async c => {
      const s = window.syn3h, g = s.game, f = window.temporalFixture
      s.params.set('post.temporal', c.temporal ?? true); s.params.set('gfx.level', c.level ?? 2); f.budget = c.budget ?? 1
      await f.draw(3)
      return { name: c.name, active: !!g.postChain.built?.temporalNode, tier: g.postChain.tier, jitterCleared: !f.camera.view?.enabled }
    }, c)
    results.push(result); assert.equal(result.active, ['restored', 'full'].includes(c.name)); assert.equal(result.jitterCleared, true)
  }
  assert.deepEqual(errors, [])
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2)); await browser.close()
}
