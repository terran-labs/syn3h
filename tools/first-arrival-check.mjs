// Cold first host arrival. Serve a local production build with its room server.
// Usage: node tools/first-arrival-check.mjs ORIGIN webgpu|webgl desktop|phone KIND DISTANCE OUTPUT.json
// For the two 5 m hysteresis bands run 24, 27.5, 31 and 114, 117.5, 121 metres.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const [origin, backend, viewport, kind, metres, output] = process.argv.slice(2)
const distance = Number(metres)
const url = new URL(origin)
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
assert(['webgpu', 'webgl'].includes(backend) && ['desktop', 'phone'].includes(viewport))
assert(['hovercraft', 'buggy', 'jet'].includes(kind) && distance > 0 && Number.isFinite(distance) && output)
url.searchParams.set('room', 'first-' + randomUUID().slice(0, 8))
url.searchParams.set('seed', '1')
if (backend === 'webgl') url.searchParams.set('webgl', '1')
const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  const phone = viewport === 'phone'
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.shell)
  await page.evaluate(() => {
    const { game, shell, params } = window.syn3h
    game.quality.setLevel(3)
    game.quality.setAuto(true)
    params.set('bots.count', 0)
    params.set('bots.fleet', 1)
    void shell.play(true)
  })
  await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing &&
    !window.syn3h.shell.transitioning, null, { timeout: 90000 })
  await page.evaluate(({ kind, distance }) => {
    const { game, bots, materialize, params } = window.syn3h
    const backend = game.renderer.backend, events = [], meshes = new Map()
    const build = bots.build, spot = bots.spot, begin = materialize.begin
    const builder = backend.createNodeBuilder, pipeline = backend.createRenderPipeline, draw = backend.draw
    let subject, arrival
    // Select its stock fleet slot for the first admission. Only the spawn point is staged.
    bots.build = function () { return build.call(this, { buggy: 0, hovercraft: 1, jet: 3 }[kind]) }
    bots.spot = function (...args) {
      const pose = spot.apply(this, args)
      if (pose) pose.position.copy(game.camera.position).addScaledVector(game.camera.getWorldDirection(pose.position.clone()), distance)
      return pose
    }
    materialize.begin = function (vehicle, ...args) {
      if (!subject) {
        subject = vehicle
        arrival = { kind: vehicle.kind, root: vehicle.object.id, distance: vehicle.object.position.distanceTo(game.camera.position),
          level: game.quality.governor.level, overlap: materialize.looks.some(look => look.active) }
      }
      return begin.call(this, vehicle, ...args)
    }
    function identity(object, material) {
      return { mesh: object?.name, object: object?.id, material: material?.name || material?.type,
        source: object?.material?.id, materialId: material?.id, frame: game.frames }
    }
    backend.createNodeBuilder = function (...args) {
      const node = builder.apply(this, args), build = node.build
      node.build = function (...args) { events.push({ kind: 'graph', ...identity(this.object, this.material) }); return build.apply(this, args) }
      return node
    }
    backend.createRenderPipeline = function (ro, ...args) {
      events.push({ kind: 'pipeline', ...identity(ro.object, ro.material) })
      return pipeline.call(this, ro, ...args)
    }
    backend.draw = function (ro, ...args) {
      if (subject?.object.getObjectById(ro.object.id)) {
        const key = ro.object.id + '/' + ro.material.id
        if (!meshes.has(key)) meshes.set(key, identity(ro.object, ro.material))
      }
      return draw.call(this, ro, ...args)
    }
    window.firstArrival = { get arrival() { return arrival }, result() {
      return { arrival, backend: game.backend, events, draws: [...meshes.values()] }
    } }
    params.set('bots.count', 1)
  }, { kind, distance })
  await page.waitForFunction(() => window.firstArrival.arrival, null, { timeout: 90000 })
  await page.waitForTimeout(2800)
  const result = await page.evaluate(() => window.firstArrival.result())
  await writeFile(output, JSON.stringify({ viewport, ...result, errors }, null, 2))
  assert.deepEqual(errors, [])
  assert.equal(result.backend, backend)
  assert.equal(result.arrival.kind, kind)
  assert.equal(result.arrival.level, 3)
  assert.equal(result.arrival.overlap, false)
  assert(Math.abs(result.arrival.distance - distance) < 0.1)
  assert(result.draws.length, 'Bot produced no submissions')
  console.log(kind, backend, viewport, distance, result.events.length, 'renderer calls')
  assert.equal(result.events.length, 0, 'Cold first arrival built a graph or requested a pipeline')
} finally { await browser.close() }
