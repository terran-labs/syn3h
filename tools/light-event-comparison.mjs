// node tools/light-event-comparison.mjs <origin> <new-output-dir> <webgpu|webgl> <fixed|batched> <1280x720|844x390> <Low|Medium>
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'
import { installRawCollector } from './performance-check.mjs'

const [origin, output, backend, mode, size, quality] = process.argv.slice(2)
assert.ok(origin && output && ['webgpu', 'webgl'].includes(backend) && ['fixed', 'batched'].includes(mode)
  && ['1280x720', '844x390'].includes(size) && ['Low', 'Medium'].includes(quality),
'Expected origin, new output directory, webgpu or webgl, fixed or batched, 1280x720 or 844x390, Low or Medium')
const level = quality === 'Low' ? 1 : 2
const [width, height] = size.split('x').map(Number)
const url = new URL('/', origin)
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
url.searchParams.set('world', 'volcanic.49731~sun.dayLength=0,sun.timeOfDay=12,weather.cloudSpeed=0,water.waves=false,bots.count=0')
url.searchParams.set('vehicle', 'buggy')
if (mode === 'batched') url.searchParams.set('lighting', 'batched')
if (backend === 'webgl') url.searchParams.set('webgl', '1')

const cases = {
  point: ['baseline', 'first-add', 'first-remove', 'repeat-add', 'repeat-remove'],
  spot: ['baseline', 'first-add', 'first-remove', 'repeat-add', 'repeat-remove'],
  directional: ['baseline', 'first-add', 'first-remove', 'repeat-add', 'repeat-remove'],
  hemisphere: ['baseline', 'first-on', 'first-off', 'repeat-on', 'repeat-off'],
  arrival: ['baseline', 'actual-arrival'],
  sun: ['baseline', 'replace-shadow-tier', 'restore-shadow-tier'],
}
const eventFrames = 8
const discardFrames = 24
const steadyFrames = 72
const stepMs = 1000 / 60

// Runs in the page with the production bundle. Constructors come from the real light objects
// so every fixture uses the same Three instance and the same lighting node registry.
async function prepare({ name, mode, level, stepMs }) {
  const s = window.syn3h
  const g = s.game
  const { scene, renderer, camera, quality } = g
  const { materialize, params, player, terrain } = s
  const raw = window.performanceMatrix
  await renderer.setAnimationLoop(null)
  Date.now = () => 1700000000000
  g.time = 8

  const env = g.systems.find(system => system.sunDirection && system.sunColor)
  const nodeFrame = (renderer.nodes ?? renderer._nodes)?.nodeFrame
  if (!env || !nodeFrame || !g.postChain) throw new Error('Missing environment, renderer clock or post chain')

  const spawn = terrain.spawnPoint(0)
  player.teleport(spawn.position, spawn.heading)
  player.object.visible = true
  camera.position.copy(spawn.position)
  camera.position.x += 9
  camera.position.z += 12
  camera.position.y = Math.max(spawn.position.y, terrain.heightAt(camera.position.x, camera.position.z)) + 5
  camera.lookAt(spawn.position)
  camera.fov = 55
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  terrain.afterCamera?.()
  // Film grain uses wall time. All other enabled post passes follow the chosen quality.
  params.set('post.grain', 0)
  for (let i = 0; i < 24; i++) env.update(0.25)

  const descendants = predicate => {
    const lights = []
    scene.traverse(object => { if (predicate(object)) lights.push(object) })
    return lights
  }
  const sun = () => scene.children.find(child => child.isDirectionalLight)
  const spot = descendants(light => light.isSpotLight)
  const hemi = descendants(light => light.isHemisphereLight)
  if (!sun() || !hemi.length || !spot.length) throw new Error('Expected gameplay sun, hemisphere and headlights')

  function place(light) {
    light.position.copy(spawn.position)
    light.position.x += 3
    light.position.z += 4
    light.position.y += 5
    light.castShadow = false
    light.name = 'Comparison ' + name
    return light
  }

  let fixture
  let fixtureParent = scene
  let intensity
  if (name === 'point') {
    // Borrow the production PointLight constructor above its quality gate without drawing
    // that tier. Restore the requested tier before initializing the measured scene.
    quality.setLevel(3)
    materialize.update(0)
    const PointLight = materialize.light?.constructor
    quality.setLevel(level)
    materialize.update(0)
    if (!PointLight || materialize.light) throw new Error('Expected PointLight only at the temporary higher tier')
    fixture = place(new PointLight(0xffb477, 0, 28, 2))
    intensity = 105
  } else if (name === 'spot') {
    // The idle headlights already occupy a slot. Remove them in both cells so the
    // controlled spotlight is the only spot in the measured scene, even at zero.
    for (const light of spot) light.removeFromParent()
    fixture = place(new spot[0].constructor(0xffb477, 0, 34, 0.58, 0.45, 2))
    fixture.target.position.copy(spawn.position)
    scene.add(fixture.target)
    intensity = 155
  } else if (name === 'directional') {
    // Even at Low, the non-shadow sun would register this type before the fixture.
    const original = sun()
    scene.remove(original, original.target)
    fixture = place(new original.constructor(0xffb477, 0))
    fixture.target.position.copy(spawn.position)
    scene.add(fixture.target)
    intensity = 1.4
  } else if (name === 'hemisphere') {
    if (hemi.length !== 1) throw new Error('Expected one gameplay hemisphere light')
    fixture = hemi[0]
    fixtureParent = fixture.parent
    intensity = fixture.intensity
  }

  function setFixture(active) {
    fixture.visible = true
    fixture.intensity = active ? intensity : 0
    if (active || mode === 'fixed') {
      if (fixture.parent !== fixtureParent) fixtureParent.add(fixture)
    } else {
      fixture.removeFromParent()
    }
  }
  if (fixture) {
    setFixture(false)
    // Startup can register a type even with zero intensity. Start the fixture with a
    // fresh scene light node while retaining production renderer and material caches.
    const lighting = renderer.lighting
    const old = lighting.getNode(scene)
    const cache = mode === 'batched' ? lighting._nodes : lighting._lightsNodeMap
    if (!cache.delete(scene) || lighting.getNode(scene) === old) throw new Error('Could not reset the scene light node')
  }
  player.update(0, 0)

  const initialShadowTier = Number(params.get('gfx.shadowQuality').value)
  const shadowTier = () => Number(params.get('gfx.shadowQuality').value)
  let arrivalFrame = null
  const dt = stepMs / 1000
  const arrivalSamples = []

  const describe = light => ({
    id: light.id, type: light.type, name: light.name, parent: light.parent?.name || light.parent?.type || null,
    visible: light.visible, intensity: light.intensity, color: light.color?.toArray(),
    groundColor: light.groundColor?.toArray(), position: light.position.toArray(),
    worldPosition: light.getWorldPosition(light.position.clone()).toArray(),
    target: light.target?.getWorldPosition(light.position.clone()).toArray(),
    castShadow: light.castShadow, distance: light.distance, decay: light.decay,
    angle: light.angle, penumbra: light.penumbra,
    shadowMapSize: light.castShadow ? light.shadow.mapSize.toArray() : null,
    cascades: light.castShadow ? light.shadow.shadowNode?.cascades ?? null : null,
  })
  const inventory = () => ({
    camera: { position: camera.position.toArray(), orientation: camera.quaternion.toArray(), fov: camera.fov },
    worldSeed: params.get('world.seed').value, hour: env.hour, gameSeconds: g.time,
    width: g.canvas.width, height: g.canvas.height, viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio, rendererPixelRatio: renderer.getPixelRatio(), quality: raw.settings(),
    lightingNode: renderer.lighting.getNode(scene).type,
    registeredBatchedTypes: [...(renderer.lighting.getNode(scene)._dataNodes?.keys() ?? [])].sort(),
    backend: g.backend, shadowTier: shadowTier(),
    lights: descendants(object => object.isLight).map(describe),
    fixture: fixture ? describe(fixture) : null,
    arrivalLight: materialize.light ? describe(materialize.light) : null,
    arrivalFrame, arrivalPlaying: materialize.isMaterializing(player),
    arrivalVisualActive: materialize.looks.some(look => look.active),
  })

  function mutate(event) {
    if (!event || event === 'baseline') return
    if (name === 'sun') {
      const before = sun()
      params.set('gfx.shadowQuality', event === 'restore-shadow-tier' ? initialShadowTier : initialShadowTier === 0 ? 1 : 0)
      if (sun() === before) throw new Error('Shadow tier change failed to replace the sun')
      return
    }
    if (name === 'arrival') {
      arrivalFrame = 0
      materialize.begin(player, { hold: false, holdSeconds: 1 })
      return
    }
    setFixture(event.endsWith('-on') || event.endsWith('-add'))
  }

  let batch
  let previousStart
  function tick() {
    if (!batch) return
    try {
      const { count, index, phase, event, resolve } = batch
      raw.phase = phase
      const start = performance.now()
      const intervalSeeded = previousStart === undefined
      const frameMs = intervalSeeded ? stepMs : start - previousStart
      previousStart = start
      g.frames++
      if (index === 0) mutate(event)
      const afterMutation = performance.now()

      // The animation loop advances Three's frame ID for timestamp attribution. Fix its
      // shader clock while leaving the monotonic CPU timer available for the collector.
      nodeFrame.time = 8
      nodeFrame.deltaTime = dt
      if (name === 'sun' && index === 0 && event) env.update(0)
      if (arrivalFrame !== null) {
        // Advance the real arrival logic by a controlled step, including its wall-time fade.
        const now = performance.now()
        const hold = materialize.holds.find(hold => hold.vehicle === player)
        if (hold) hold.wallStart = now - arrivalFrame * stepMs
        materialize.lastWall = now - stepMs
        materialize.fixedUpdate(dt)
        materialize.update(dt)
        arrivalFrame++
      }
      const beforeDraw = performance.now()
      g.postChain.render(renderer, scene, camera, stepMs)
      const afterDraw = performance.now()
      quality.frame({
        ...g.performance, frameMs, intervalSeeded, drawCalls: renderer.info.render.drawCalls,
        mutationCpuMs: afterMutation - start, controlledUpdateCpuMs: beforeDraw - afterMutation,
        controlledFrameCpuMs: afterDraw - start,
      }, false)
      if (arrivalFrame !== null) {
        const light = materialize.light
        arrivalSamples.push({
          arrivalFrame, gameFrame: g.frames, active: materialize.isMaterializing(player),
          lightId: light?.id ?? null, intensity: light?.intensity ?? null,
          attached: Boolean(light?.parent), visible: light?.visible ?? null,
        })
      }
      if (++batch.index === count) {
        batch = undefined
        resolve()
      }
    } catch (error) {
      const { reject } = batch
      batch = undefined
      reject(error)
    }
  }
  await renderer.setAnimationLoop(tick)
  window.lightEventProbe = {
    inventory,
    arrivalSamples,
    async run(segments) {
      if (batch) throw new Error('Measurement already running')
      previousStart = undefined
      for (const segment of segments) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            batch = undefined
            reject(new Error('Frame collection timed out in ' + segment.phase))
          }, 120000)
          batch = {
            ...segment, index: 0,
            resolve() { clearTimeout(timer); resolve() },
            reject(error) { clearTimeout(timer); reject(error) },
          }
        })
      }
    },
  }
}

function summarize(rows, allFrames, timestamps, pixels, eventPhase) {
  assert.ok(rows.length && rows.every(row => !row.hidden && row.remotes === 0 && row.rendererCalls > 0),
    'Expected visible, isolated, rendered frames')
  const values = rows.map(row => timestamps.get(row.rendererFrame)).filter(Number.isFinite).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median = values.length === 0 ? null : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  const cpu = Object.fromEntries([
    'mutationCpuMs', 'controlledUpdateCpuMs', 'controlledFrameCpuMs', 'renderCpuMs', 'nodeBuildMs',
    'shaderStageCalls', 'shaderStageSubmissionMs', 'pipelines', 'pipelineMs', 'uploads', 'uploadCpuMs',
  ].map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]))
  // The row's own interval ends at its start. The next row measures the interval after its work.
  const intervals = rows.map(row => {
    const next = allFrames.get(row.gameFrame + 1)
    return { gameFrame: row.gameFrame, cpuMs: row.controlledFrameCpuMs, incomingMs: row.frameMs,
      followingMs: next && !next.hidden && !next.intervalSeeded ? next.frameMs : null }
  })
  if (eventPhase) assert.ok(intervals.every(row => Number.isFinite(row.followingMs)), 'Missing interval after event frame')
  const worstBy = key => intervals.filter(row => Number.isFinite(row[key])).reduce(
    (worst, row) => !worst || row[key] > worst[key] ? row : worst, null)
  return {
    frames: rows.length, nodeBuilds: rows.reduce((sum,row) => sum + row.nodeBuilds.length, 0),
    cpu, worstCpuFrame: worstBy('cpuMs'),
    worstFollowingInterval: worstBy('followingMs'),
    gpu: { samples: values.length, medianMs: median, medianNsPerOutputPixel: median === null ? null : median * 1e6 / pixels },
  }
}

await mkdir(output)
const report = {
  backend, mode, size, quality, url: url.href, eventFrames, discardFrames, steadyFrames,
  notes: [
    'Fixture cases start with a fresh scene light node. First means first introduction to that node in batched mode, or first change from the already-visible zero-intensity fixture in fixed mode. Production material and pipeline caches may already contain related work.',
    'Fixed keeps fixtures visible at zero intensity when off. Batched removes the off fixture from the scene.',
    'Point, spot and directional use non-shadow fixtures. The directional fixture removes the original sun in both modes. Hemisphere uses the gameplay light. AmbientLight is batchable but absent from production gameplay, so it has no case here.',
    'Sun replacement uses the real shadow-quality setter in both modes and changes shadow workload.',
    'The actual arrival runs at the requested quality. Its production point light is gated above Low and Medium. This case includes arrival visuals and is not a point-light add/remove timing.',
    'CPU totals are sums over the stated render frames. Build and submission timings can overlap render CPU. Physics and unrelated game systems are frozen.',
    'GPU timing uses matched renderer frame IDs and includes recorded render passes. Normalization uses canvas backing pixels. A missing timestamp remains null.',
    'Intervals are observed animation spacing on this host. The first incoming interval of each batch is a nominal seed and is excluded from following-interval claims.',
  ],
  cases: {},
}
let browser
const load = []
const sampleLoad = () => load.push({ at: Date.now(), oneMinute: loadavg()[0] })
sampleLoad()
const timer = setInterval(sampleLoad, 1000)
try {
  assert.ok(load[0].oneMinute < 8, 'Load must be below 8 before launch')
  browser = await chromium.launch({ channel: 'chrome', headless: false,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  for (const [name, events] of Object.entries(cases)) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    const result = report.cases[name] = { errors: [], states: {} }
    try {
      const page = await context.newPage()
      page.on('pageerror', error => result.errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()) })
      await page.addInitScript(installRawCollector, { gpuTimestamps: true })
      await page.addInitScript(level => {
        localStorage.setItem('syn3h.quality.v2', JSON.stringify({ level, auto: false, pinned: true, overrides: {} }))
      }, level)
      await page.goto(url.href, { timeout: 90000 })
      await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 90000 })
      await page.evaluate(level => {
        const s = window.syn3h
        // Enter the real play view without joining a room that can change the fixture.
        s.shell.onPlay = undefined
        s.shell.play()
        s.game.quality.setAuto(false)
        s.game.quality.setLevel(level)
        s.bots.daydream.setBlocker(() => true)
        s.params.set('bots.count', 0)
      }, level)
      await page.waitForFunction(() => window.syn3h.shell.playing && !window.syn3h.bots.vehicles.length
        && !window.syn3h.materialize.isMaterializing(window.syn3h.player), null, { timeout: 90000 })
      await page.evaluate(prepare, { name, mode, level, stepMs })
      const initial = await page.evaluate(() => window.lightEventProbe.inventory())
      assert.equal(initial.backend, backend, 'Unexpected renderer fallback')
      assert.equal(initial.lightingNode, mode === 'batched' ? 'DynamicLightsNode' : 'LightsNode')
      assert.equal(initial.quality.level, level)
      assert.equal(initial.quality.auto, false)
      assert.equal(initial.worldSeed, 49731)
      assert.deepEqual(initial.viewport, [width, height])
      assert.ok(Math.abs(initial.hour - 12) < 0.001, 'Expected frozen noon')
      result.initial = initial

      const run = segments => page.evaluate(segments => window.lightEventProbe.run(segments), segments)
      for (const event of events) {
        const phase = event + '/event'
        const baseline = event === 'baseline'
        const dynamicArrival = event === 'actual-arrival'
        const capture = async suffix => {
          const image = name + '-' + event + suffix + '.png'
          await writeFile(join(output, image), await page.locator('#game').screenshot(), { flag: 'wx' })
          return { image, ...(await page.evaluate(() => window.lightEventProbe.inventory())) }
        }
        if (dynamicArrival) {
          // Capture during the effect at a fixed step. Resume through release and use
          // the following-frame record to cover the final active measurement frame.
          await run([{ count: eventFrames, phase, event }, { count: 16, phase: event + '/active' }])
          result.states[event] = await capture('')
          await run([{ count: 152, phase: event + '/follow-through' }])
          result.states[event].after = await capture('-after')
        } else {
          const segments = [{ count: discardFrames, phase: event + '/settle' },
            { count: steadyFrames, phase: event + '/steady' }, { count: 1, phase: event + '/after' }]
          if (!baseline) segments.unshift({ count: eventFrames, phase, event })
          await run(segments)
          result.states[event] = await capture('')
        }
      }

      const raw = await page.evaluate(() => {
        const { initial, frames, asyncNodeBuilds, gpuTiming, overflow } = window.performanceMatrix
        return { initial, frames, asyncNodeBuilds, gpuTiming, overflow, arrivalSamples: window.lightEventProbe.arrivalSamples }
      })
      assert.ok(raw.initial.nodeBuildTracking && !raw.overflow)
      const allFrames = new Map(raw.frames.map(row => [row.gameFrame, row]))
      const timestamps = new Map(raw.gpuTiming.samples.map(({ frame, ms }) => [frame, ms]))
      const pixels = initial.width * initial.height
      assert.ok(pixels > 0)
      result.gpuTiming = { supported: raw.gpuTiming.supported, error: raw.gpuTiming.error }
      for (const [event, state] of Object.entries(result.states)) {
        assert.deepEqual([state.width, state.height], [initial.width, initial.height])
        assert.deepEqual(state.camera, initial.camera)
        assert.equal(state.quality.level, level)
        if (state.fixture) {
          const on = name === 'hemisphere'
            ? event.endsWith('-on')
            : event.endsWith('-add')
          assert.equal(state.fixture.intensity > 0, on)
          assert.equal(state.fixture.visible, true)
          const sameType = state.lights.filter(light => light.type === state.fixture.type)
          assert.equal(sameType.length, on || mode === 'fixed' ? 1 : 0)
          if (sameType.length) assert.equal(sameType[0].id, state.fixture.id)
          if (mode === 'batched') {
            assert.equal(state.registeredBatchedTypes.includes(state.fixture.type), event !== 'baseline',
              'Expected first-introduction registration to persist after removal')
          }
        }
        for (const kind of ['event', 'steady', 'active', 'follow-through']) {
          const rows = raw.frames.filter(row => row.phase === event + '/' + kind)
          if (rows.length) state[kind] = summarize(rows, allFrames, timestamps, pixels, kind === 'event')
        }
      }
      if (name === 'arrival') {
        const arrival = result.states['actual-arrival']
        assert.equal(arrival.arrivalVisualActive, true)
        arrival.fullSequence = summarize(raw.frames.filter(row => row.phase.startsWith('actual-arrival/')),
          allFrames, timestamps, pixels, false)
        assert.ok(raw.arrivalSamples.some(row => row.active) && !raw.arrivalSamples.at(-1).active, 'Arrival did not run through release')
        assert.ok(raw.arrivalSamples.every(row => row.lightId === null), 'Unexpected production arrival light at the selected quality')
      }
      await writeFile(join(output, name + '.raw.json'), JSON.stringify(raw, null, 2), { flag: 'wx' })
      assert.deepEqual(result.errors, [], 'Browser errors in ' + name)
      console.log(name + ' recorded')
      sampleLoad()
      assert.ok(load.every(sample => sample.oneMinute < 8), 'Load reached or exceeded 8. Discarding run.')
    } finally {
      await context.close()
    }
  }
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  clearInterval(timer)
  report.load = load
  await browser?.close()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
}
