/** Identify incorrect static motion by rendered object, without temporal accumulation. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [base, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('room', `velocity-isolate-${Date.now()}`)
  if (process.argv.includes('--webgl')) url.searchParams.set('webgl', '1')
  await page.goto(url.href, { timeout: 120000 })
  await page.waitForFunction(() => window.mira?.game?.tick > 120, null, { timeout: 120000 })
  const results = await page.evaluate(async custom => {
    const s = window.mira, g = s.game
    g.renderer.setAnimationLoop(null); g.postChain.release()
    const module = name => performance.getEntriesByType('resource').find(r => r.name.includes(`/${name}.js`))?.name
    const T = await import(module('three_webgpu')), N = await import(module('three_tsl'))
    const Velocity = custom ? (await import('/src/fx/post/CurvedVelocity.ts')).CurvedVelocity : T.VelocityNode
    s.params.set('world.curve', 0); window.__miraCurve.updateCurve(g.camera.position, s.terrain.size)
    const decode = data => Array.from(data, v => data instanceof Uint16Array ? T.DataUtils.fromHalfFloat(v) : v)
    const inspect = async (scene, camera, name) => {
      const ids = new Map(), objects = []
      const id = N.uniform(0).onObjectUpdate(({ object }) => {
        if (!ids.has(object)) { ids.set(object, objects.length + 1); objects.push(object) }
        return ids.get(object)
      })
      const velocity = new Velocity()
      const pass = N.pass(scene, camera, { samples: 0 })
      pass.setMRT(N.mrt({ output: N.output, velocity: N.nodeObject(velocity), identity: N.vec4(id, 0, 0, 1) }))
      pass.getTexture('velocity'); pass.getTexture('identity')
      const pipeline = new T.RenderPipeline(g.renderer, pass.getTextureNode().context({ velocity }))
      for (let i = 0; i < 8; i++) { pipeline.render(); await new Promise(requestAnimationFrame) }
      const target = pass.renderTarget
      const motion = decode(await g.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, 1))
      const identity = decode(await g.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, 2))
      const stats = new Map()
      for (let i = 0; i < motion.length; i += 4) {
        const id = Math.round(identity[i]), magnitude = Math.hypot(motion[i], motion[i + 1])
        const row = stats.get(id) ?? { id, pixels: 0, badPixels: 0, max: 0, sample: null }
        row.pixels++
        if (magnitude > .001) row.badPixels++
        if (magnitude > row.max) { row.max = magnitude; row.sample = [i / 4 % target.width, Math.floor(i / 4 / target.width), motion[i], motion[i + 1]] }
        stats.set(id, row)
      }
      let moving = null
      if (name === 'stationary-box') {
        scene.children[0].position.x += .1
        pipeline.render(); await new Promise(requestAnimationFrame)
        const sample = decode(await g.renderer.readRenderTargetPixelsAsync(target, target.width / 2, target.height / 2, 1, 1, 1))
        const expected = .1 * camera.projectionMatrix.elements[0] / 8.5
        moving = { actual: sample.slice(0, 2), expected }
      }
      let movingVehicle = null
      if (name === 'curved-game') {
        const vehicle = scene.getObjectByName('mira buggy skin'), stators = scene.getObjectByName('Stators')
        if (!vehicle || !stators?.isInstancedMesh) throw new Error('Actual buggy and instanced stators unavailable')
        const original = stators.instanceMatrix.array.slice(), matrix = new T.Matrix4()
        vehicle.position.x += .1
        for (let i = 0; i < stators.count; i++) { stators.getMatrixAt(i, matrix); matrix.elements[12] += .15; stators.setMatrixAt(i, matrix) }
        stators.instanceMatrix.needsUpdate = true
        pipeline.render(); await new Promise(requestAnimationFrame)
        const values = decode(await g.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, 1))
        const labels = decode(await g.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, 2))
        let bodyMax = 0, instanceMax = 0, instancePixels = 0
        for (let i = 0; i < values.length; i += 4) {
          const object = objects[Math.round(labels[i]) - 1]
          if (!object || object.material?.positionNode || object.material?.isSpriteNodeMaterial) continue
          const magnitude = Math.hypot(values[i], values[i + 1])
          if (object === stators) { instanceMax = Math.max(instanceMax, magnitude); instancePixels++ }
          if (!object.isInstancedMesh) for (let parent = object; parent; parent = parent.parent) if (parent === vehicle) { bodyMax = Math.max(bodyMax, magnitude); break }
        }
        vehicle.position.x -= .1; stators.instanceMatrix.array.set(original); stators.instanceMatrix.needsUpdate = true
        movingVehicle = { bodyMax, instanceMax, instancePixels }
      }
      pipeline.dispose(); pass.dispose()
      return { name, moving, movingVehicle, objects: [...stats.values()].sort((a, b) => b.max - a.max).map(row => {
        const object = objects[row.id - 1]
        return { ...row, name: object?.name, parent: object?.parent?.name, type: object?.type, material: object?.material?.type, reactive: !!object?.material?.positionNode || !!object?.material?.isSpriteNodeMaterial, positionNode: !!object?.material?.positionNode, vertexNode: !!object?.material?.vertexNode, position: object?.position.toArray() }
      }) }
    }
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 640 / 360, .1, 100)
    camera.position.z = 10; camera.updateMatrixWorld()
    const material = new T.MeshBasicNodeMaterial({ color: 0xffffff })
    scene.add(new T.Mesh(new T.BoxGeometry(3, 3, 3), material))
    const simple = await inspect(scene, camera, 'stationary-box')
    const game = await inspect(g.scene, g.camera, 'flat-game')
    s.params.set('world.curve', .71); window.__miraCurve.updateCurve(g.camera.position, s.terrain.size)
    const curved = custom ? await inspect(g.scene, g.camera, 'curved-game') : null
    return { backend: g.backend, simple, game, curved }
  }, process.argv.includes('--custom'))
  writeFileSync(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2))
  assert.deepEqual(errors, [])
  assert.ok(results.simple.objects.every(o => o.max < .001), 'stationary box has zero velocity')
  assert.ok(Math.abs(results.simple.moving.actual[0] - results.simple.moving.expected) < .0001, 'moving box matches projected displacement')
  if (process.argv.includes('--custom')) for (const run of [results.game, results.curved]) {
    assert.ok(run.objects.filter(o => !o.reactive).every(o => o.max < .001), `${run.name}: stationary geometry has zero velocity`)
    assert.ok(run.objects.some(o => o.reactive && o.max > 5), `${run.name}: unsupported procedural history is rejected`)
  }
  if (results.curved) {
    assert.ok(results.curved.movingVehicle.bodyMax > .001 && results.curved.movingVehicle.bodyMax < .5, 'actual buggy motion is finite and nonzero')
    assert.ok(results.curved.movingVehicle.instancePixels > 0 && results.curved.movingVehicle.instanceMax > .001 && results.curved.movingVehicle.instanceMax < .5, 'actual instanced stator motion reaches the velocity buffer')
  }
} finally { await browser.close() }
