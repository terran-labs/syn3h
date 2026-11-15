/** One ordinary-entry archipelago reproduction. Observes bindings; never repairs them. */
import { chromium } from 'playwright-core'
import { createServer as createVite } from 'vite'
import { createServer } from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const out = process.argv[2]
// --gl forces the WebGL 2 backend (the draw trace still detects self-feedback there).
// --expect-clean fails the run when any conflict or self-sampling ripple draw is seen.
const gl = process.argv.includes('--gl'), expectClean = process.argv.includes('--expect-clean')
assert.ok(out, 'Unique output directory required')
await mkdir(out)
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer(); server.on('error', reject)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})
const roomPort = await freePort(), port = await freePort()
process.env.SYN3H_NO_ROOM_SERVER = '1'
process.env.VITE_SERVER_URL = `ws://127.0.0.1:${port}`
const room = spawn(process.execPath, ['--import', 'tsx', 'server/dev.ts'], { env: { ...process.env, PORT: String(roomPort) }, stdio: ['ignore', 'pipe', 'pipe'] })
let roomLog = '', browser, vite, evidence, failure
room.stdout.on('data', x => { roomLog += x }); room.stderr.on('data', x => { roomLog += x })
const errors = [], events = []
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${roomPort}/status`)).ok) break } catch {}
    if (i === 99) throw Error('Room startup timeout')
    await new Promise(r => setTimeout(r, 100))
  }
  vite = await createVite({ cacheDir: `${out}/vite-cache`, server: { host: '127.0.0.1', port, strictPort: true, proxy: {
    '/ws': { target: `ws://127.0.0.1:${roomPort}`, ws: true }, '/presence': { target: `http://127.0.0.1:${roomPort}` },
  } } })
  await vite.listen()
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  await context.addInitScript(() => {
    const trace = window.rendererFeedback = { conflicts: [], allocations: [], lifecycle: [], draws: [], active: null }
    const textures = new WeakMap(), views = new WeakMap(), groups = new WeakMap(), passes = new WeakMap()
    let serial = 0
    const textureCreate = GPUDevice.prototype.createTexture
    GPUDevice.prototype.createTexture = function (descriptor) {
      const texture = textureCreate.call(this, descriptor), size = descriptor.size
      const width = size.width ?? size[0], height = size.height ?? size[1] ?? 1
      const meta = { id: ++serial, width, height, format: descriptor.format, label: descriptor.label ?? '', layers: size.depthOrArrayLayers ?? size[2] ?? 1 }
      if (width === 256 && height === 256 && descriptor.format === 'rgba16float') {
        meta.createdAt = new Error().stack; trace.allocations.push(meta)
      }
      textures.set(texture, meta); return texture
    }
    const viewCreate = GPUTexture.prototype.createView
    GPUTexture.prototype.createView = function (descriptor = {}) {
      const view = viewCreate.call(this, descriptor)
      views.set(view, { texture: textures.get(this), descriptor: { ...descriptor } }); return view
    }
    const groupCreate = GPUDevice.prototype.createBindGroup
    GPUDevice.prototype.createBindGroup = function (descriptor) {
      const group = groupCreate.call(this, descriptor)
      groups.set(group, descriptor.entries.flatMap(e => views.has(e.resource) ? [{ binding: e.binding, ...views.get(e.resource) }] : []))
      return group
    }
    const begin = GPUCommandEncoder.prototype.beginRenderPass
    GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
      const pass = begin.call(this, descriptor)
      passes.set(pass, { encoder: this.label, attachments: descriptor.colorAttachments.filter(Boolean).map(a => views.get(a.view)).filter(Boolean), active: trace.active })
      return pass
    }
    const bind = GPURenderPassEncoder.prototype.setBindGroup
    GPURenderPassEncoder.prototype.setBindGroup = function (index, group, ...rest) {
      const pass = passes.get(this)
      if (pass && trace.conflicts.length < 8) for (const resource of groups.get(group) ?? []) {
        if (pass.attachments.some(a => a.texture?.id === resource.texture?.id)) {
          trace.conflicts.push({ at: Date.now(), group: index, resource, ...pass, stack: new Error().stack })
        }
      }
      return bind.call(this, index, group, ...rest)
    }
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push({ at: Date.now(), kind: 'page', text: e.message }))
  page.on('console', m => { if (m.type() === 'error' && errors.length < 40) errors.push({ at: Date.now(), kind: 'console', text: m.text() }) })
  page.on('websocket', ws => { if (ws.url().includes('/ws?')) assert.ok(ws.url().startsWith(`ws://127.0.0.1:${port}/ws?`)) })
  await page.goto(`http://127.0.0.1:${port}/?room=feedback${Date.now()}&name=FeedbackHost${gl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 90000 })
  await page.evaluate(async () => {
    const { rippleField: ripple } = await import('/src/world/water/ripples.ts')
    const renderer = window.syn3h.game.renderer, trace = window.rendererFeedback
    const state = () => ({ index: ripple.index, source: ripple.source.value.uuid, targets: ripple.targets.map(t => t.texture.uuid), cells: ripple.cells })
    for (const name of ['configure', 'allocate', 'dispose']) {
      const original = ripple[name]
      ripple[name] = function (...args) {
        const before = state(), result = original.apply(this, args)
        if (trace.lifecycle.length < 30) trace.lifecycle.push({ at: Date.now(), method: name, args, before, after: state() })
        return result
      }
    }
    const render = renderer.render
    renderer.render = function (object, camera) {
      const old = trace.active, target = renderer.getRenderTarget()
      const current = { object: object.name, material: object.material?.name, target: target ? { uuid: target.texture.uuid, name: target.texture.name, width: target.width, height: target.height, cube: !!target.isCubeRenderTarget } : null }
      if (object === ripple.quad) {
        current.path = 'water/Ripples.quad'; current.ripple = state()
        current.selfFeedback = ripple.source.value === target?.texture
        if (current.selfFeedback || trace.draws.length < 6) {
          if (trace.draws.length < 24) trace.draws.push({ at: Date.now(), ...current, stack: new Error().stack })
        }
      }
      trace.active = current
      try { return render.call(this, object, camera) } finally { trace.active = old }
    }
  })
  await page.locator('.galaxy-label.is-current').press('Enter')
  await page.waitForFunction(() => window.syn3h.shell.playing && window.syn3hNet?.connected, null, { timeout: 90000 })
  events.push({ event: 'applyPlanet archipelago', at: Date.now() })
  await page.evaluate(async () => {
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet('archipelago', 49731)
    window.syn3h.params.set('gfx.auto', false); window.syn3h.params.set('gfx.level', 2)
  })
  await page.waitForTimeout(5000)
  const shore = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain
    for (let z = -600; z <= 600; z += 20) for (let x = -600; x <= 600; x += 20) {
      if (t.liquidKindAt(x, z) !== null) continue
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (t.liquidKindAt(x + dx * 35, z + dz * 35) !== 'water') continue
        const h = t.heightAt(x, z)
        if (h - t.liquidHeightAt(x + dx * 35, z + dz * 35) > 12) continue
        s.player.teleport({ x, y: h + 2, z }, Math.atan2(dx, -dz)); return { x, y: h + 2, z }
      }
    }
    throw Error('No repeatable dry shore viewpoint')
  })
  events.push({ event: 'shore teleport', shore, at: Date.now() })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${out}/archipelago.png` })
  evidence = await page.evaluate(() => {
    const s = window.syn3h, g = s.game
    return { trace: window.rendererFeedback, backend: g.backend, seed: s.params.get('world.seed').value, quality: { level: s.params.get('gfx.level').value, auto: s.params.get('gfx.auto').value, rung: g.quality.governor.rung, settings: g.quality.governor.settings }, buffer: [g.canvas.width, g.canvas.height], sky: g.scene.userData.skyEnvironment }
  })
  const selfFeedback = evidence.trace.draws.filter(d => d.selfFeedback).length
  evidence.verdict = { backend: evidence.backend, conflicts: evidence.trace.conflicts.length, selfFeedbackDraws: selfFeedback, rippleDraws: evidence.trace.draws.length, lifecycleCalls: evidence.trace.lifecycle.length }
  if (gl) assert.equal(evidence.backend, 'webgl')
  if (expectClean) { assert.equal(evidence.trace.conflicts.length, 0, 'texture bound as input and attachment'); assert.equal(selfFeedback, 0, 'ripple step sampled its own target'); assert.ok(evidence.trace.draws.length > 0, 'no ripple draws observed') }
} catch (error) { failure = String(error); process.exitCode = 1 }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ source, events, errors, evidence, failure, roomLog }, null, 2))
  console.log(JSON.stringify({ source, verdict: evidence?.verdict, errors, failure, conflicts: evidence?.trace.conflicts, lifecycle: evidence?.trace.lifecycle }, null, 2))
  await browser?.close(); await vite?.close(); room.kill('SIGTERM')
}
