// Manual WebGL 2 diagnostic for the first visible mote draw.
// Usage: node tools/mote-precompile-check.mjs <app URL>
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5207/')
url.searchParams.set('webgl', '1')
url.searchParams.set('world', 'volcanic.1~sun.dayLength=0,sun.timeOfDay=12')
url.searchParams.set('vehicle', 'buggy')

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    // Keep the lobby's background draws from compiling the graph before the test starts.
    let app
    Object.defineProperty(window, 'syn3h', {
      configurable: true,
      get: () => app,
      set: value => {
        app = value
        app.game.holdDraws = true
      },
    })
  })
  await page.goto(url.href)
  await page.waitForFunction(() => {
    const s = window.syn3h
    return s?.terrain.ready && s.game.tick > 0
  }, null, { timeout: 90000 })

  const result = await page.evaluate(async () => {
    const { game, params } = window.syn3h
    const { renderer, scene, camera, quality, postChain } = game
    if (game.backend !== 'webgl') throw Error('Expected the WebGL2 renderer')
    game.pause()
    await renderer.setAnimationLoop(null)
    quality.setAuto(false)
    quality.setLevel(3)

    const cover = game.systems.find(system => system.group?.name === 'groundcover')
    if (!cover || !postChain) throw Error('Ground cover or post chain unavailable')
    const daylightExposure = Number(params.get('sky.exposure').value)
    renderer.toneMappingExposure = daylightExposure
    cover.update(0)
    const mote = cover.layers.find(layer => layer.kind === 'motes')?.meshes[0]
    if (!mote || !cover.group.visible || mote.visible || !(mote.geometry.instanceCount > 0)) {
      throw Error('Expected planted but hidden volcanic motes before precompile')
    }

    const backend = renderer.backend
    let builds = 0, pipelines = 0, draws = 0
    const createBuilder = backend.createNodeBuilder
    const createPipeline = backend.createRenderPipeline
    const draw = backend.draw
    backend.createNodeBuilder = function (object, ...args) {
      const builder = createBuilder.call(this, object, ...args)
      if (object === mote) {
        const build = builder.build
        builder.build = function (...args) {
          builds++
          return build.apply(this, args)
        }
      }
      return builder
    }
    backend.createRenderPipeline = function (renderObject, ...args) {
      if (renderObject.object === mote) pipelines++
      return createPipeline.call(this, renderObject, ...args)
    }
    backend.draw = function (renderObject, ...args) {
      if (renderObject.object === mote) draws++
      return draw.call(this, renderObject, ...args)
    }

    game.holdDraws = true
    try { await game.precompile() }
    finally { game.holdDraws = false }
    if (mote.visible) throw Error('Precompile left daytime motes visible')
    const warmDraws = draws
    builds = pipelines = draws = 0

    // Drive the production exposure gate without relying on wall time or a descent.
    renderer.toneMappingExposure = daylightExposure * 3
    cover.update(0)
    if (!mote.visible) throw Error('The night exposure did not reveal the motes')
    postChain.render(renderer, scene, camera, 1000 / 60)

    return { warmDraws, firstVisibleDraws: draws, firstVisibleBuilds: builds, firstVisiblePipelines: pipelines }
  })

  console.log(JSON.stringify(result))
  assert.deepEqual(errors, [], 'Unexpected browser error')
  assert.ok(result.firstVisibleDraws > 0, 'First naturally visible frame must draw the mote mesh')
  assert.equal(result.firstVisibleBuilds, 0, 'First visible mote draw rebuilt a node graph after Game.precompile')
  assert.equal(result.firstVisiblePipelines, 0, 'First visible mote draw created a pipeline after Game.precompile')
} finally {
  await browser.close()
}
