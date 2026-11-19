// Run against this worktree's production build and isolated room server.
import assert from 'node:assert/strict'
import { loadavg } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { installRawCollector } from './performance-check.mjs'

const [origin, output, backend, profile = 'desktop'] = process.argv.slice(2)
assert.ok(['desktop', 'phone-low', 'phone-medium'].includes(profile))
const phoneSize = profile !== 'desktop'
const targetLevel = profile === 'phone-low' ? 1 : 2
const url = new URL(origin)
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
assert.ok(output && ['webgpu', 'webgl'].includes(backend))
if (backend === 'webgl') url.searchParams.set('webgl', '1')
const room = 'renderbaseline' + Date.now()
url.searchParams.set('room', room)
const samples = []
function sampleLoad() {
  samples.push({ at: Date.now(), oneMinute: loadavg()[0] })
}
sampleLoad()
assert.ok(samples[0].oneMinute < 8, 'Load must be below 8 before launch')
const timer = setInterval(sampleLoad, 1000)
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false })
  const page = await browser.newPage(phoneSize ? {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  } : { viewport: { width: 1280, height: 720 } })
  await page.addInitScript(installRawCollector, { gpuTimestamps: true })
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.shell)
  assert.equal(await page.evaluate(() => window.syn3h.game.backend), backend)
  const lightingNode = await page.evaluate(() => {
    const { renderer, scene } = window.syn3h.game
    return renderer.lighting.getNode(scene).type
  })
  const batched = url.searchParams.get('lighting') === 'batched'
  assert.equal(lightingNode, batched ? 'DynamicLightsNode' : 'LightsNode')
  const phases = []
  const sceneMaterials = {}
  async function record(phase, act) {
    phases.push(phase)
    await page.evaluate(phase => { window.performanceMatrix.phase = phase }, phase)
    await act()
    await page.waitForTimeout(4000)
    // Take inventory between measurement windows. Material IDs also appear in
    // node-build records, including when an object itself has no name.
    sceneMaterials[phase] = await page.evaluate(() => {
      window.performanceMatrix.phase = 'inventory'
      const materials = new Map()
      window.syn3h.game.scene.traverse(object => {
        if (!object.material) return
        for (const material of new Set([].concat(object.material))) {
          if (!material) continue
          let entry = materials.get(material.id)
          if (!entry) {
            const ancestry = []
            for (let parent = object; parent; parent = parent.parent) {
              if (parent.name) ancestry.unshift(parent.name)
            }
            entry = { id: material.id, name: material.name, type: material.type,
              example: ancestry.join('/') || object.type, objectCount: 0 }
            materials.set(material.id, entry)
          }
          entry.objectCount++
        }
      })
      return [...materials.values()]
    })
    await page.waitForFunction(() => window.performanceMatrix.frames.at(-1)?.phase === 'inventory')
  }
  await page.evaluate(() => {
    const s = window.syn3h
    s.game.quality.setAuto(false)
    s.game.quality.setLevel(3)
    s.params.set('bots.count', 0)
  })
  await record('world-entry', async () => {
    await page.locator('.galaxy-label.is-current').press('Enter')
    await page.waitForFunction(room => window.syn3h.shell.playing && window.syn3h.shell.room === room
      && window.syn3hNet?.connected && window.syn3hNet.isHost, room)
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 0)
  await record('bot-arrival', async () => {
    await page.evaluate(() => window.syn3h.params.set('bots.count', 1))
    await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)
  })
  await record('quality-change', () => page.evaluate(level => window.syn3h.game.quality.setLevel(level), targetLevel))
  const renderSize = await page.evaluate(() => {
    const g = window.syn3h.game
    return { width: g.canvas.width, height: g.canvas.height, pixelRatio: g.renderer.getPixelRatio(),
      level: g.quality.governor.level }
  })
  assert.equal(renderSize.level, targetLevel)
  await record('vehicle-swap', () => page.evaluate(() => {
    const s = window.syn3h
    const next = s.player.kind === 'jet' ? 'tank' : 'jet'
    if (!s.swapVehicle(next) || s.player.kind !== next) throw Error('Vehicle swap failed')
  }))
  for (const visible of [false, true]) {
    await record(visible ? 'light-shown' : 'light-hidden', () => page.evaluate(visible => {
      const light = window.syn3h.game.scene.getObjectByProperty('isHemisphereLight', true)
      if (!light || light.visible === visible) throw Error('Expected hemisphere light transition')
      light.visible = visible
    }, visible))
  }
  const shadows = []
  const shadowImages = new Map()
  if (process.env.RENDER_LIGHTING_SWEEP === '1') {
    // Exercise the gameplay path too. The vehicle derives both beams' intensity
    // from sun elevation. This phase also includes the sky responding to the hour.
    await page.evaluate(() => window.syn3h.params.set('sun.dayLength', 0))
    for (const [phase, hour] of [['daylight-setup', 12], ['night-headlights-on', 0], ['day-headlights-off', 12]]) {
      await record(phase, async () => {
        await page.evaluate(hour => window.syn3h.params.set('sun.timeOfDay', hour), hour)
        await page.waitForFunction(night => {
          const lights = window.syn3h.player.object.getObjectsByProperty('isSpotLight', true)
          return lights.length > 0 && lights.every(light => night ? light.intensity > 0 : light.intensity === 0)
        }, hour === 0)
      })
    }
    await page.evaluate(() => {
      const s = window.syn3h
      const target = s.terrain.spawnPoint(0).position.clone()
      const eye = target.clone()
      eye.x += 14
      eye.z += 18
      eye.y = s.terrain.heightAt(eye.x, eye.z) + 8
      s.camera.setCinematicPose(eye, target, 55)
    })
    let from = await page.evaluate(() => window.syn3h.params.get('gfx.shadowQuality').value)
    for (const level of [0, 1, 2, 3, 2, 1, 0]) {
      if (from === level) continue
      const phase = 'sun-shadow-' + from + '-to-' + level
      await record(phase, () => page.evaluate(level => window.syn3h.params.set('gfx.shadowQuality', level), level))
      const state = await page.evaluate(() => {
        const s = window.syn3h
        const sun = s.game.scene.children.find(child => child.isDirectionalLight)
        return { level: s.params.get('gfx.shadowQuality').value, casts: sun.castShadow,
          seed: s.params.get('world.seed').value, camera: s.game.camera.position.toArray(),
          orientation: s.game.camera.quaternion.toArray(), fov: s.game.camera.fov,
          cascades: sun.castShadow ? sun.shadow.shadowNode?.cascades : 0,
          mapSize: sun.castShadow ? sun.shadow.mapSize.toArray() : null }
      })
      assert.equal(state.level, level)
      assert.equal(state.casts, level > 0)
      const image = await page.locator('canvas').evaluateAll(nodes => nodes.indexOf(window.syn3h.game.canvas))
      assert.ok(image >= 0)
      const screenshot = output + '.' + phase + '.png'
      shadowImages.set(screenshot, await page.locator('canvas').nth(image).screenshot())
      shadows.push({ phase, ...state, screenshot })
      from = level
    }
  }
  sampleLoad()
  assert.ok(samples.every(s => s.oneMinute < 8), 'Load reached or exceeded 8. Discarding run.')
  const result = await page.evaluate(() => {
    const { initial, frames, asyncNodeBuilds, gpuTiming, overflow } = window.performanceMatrix
    return { initial, frames, asyncNodeBuilds, gpuTiming, overflow }
  })
  assert.ok(result.frames.length && !result.overflow)
  assert.ok(result.initial.nodeBuildTracking, 'Renderer node-build hook unavailable')
  const gpuTimes = new Map(result.gpuTiming.samples.map(({ frame, ms }) => [frame, ms]))
  // Game.frame samples the start-to-start interval before drawing. A build's
  // effect on pacing is visible in the next tick, even across phase boundaries.
  const followingIntervals = new Map()
  for (let i = 1; i < result.frames.length; i++) {
    const previous = result.frames[i - 1]
    const current = result.frames[i]
    if (current.gameFrame === previous.gameFrame + 1 && !current.hidden) {
      followingIntervals.set(previous.gameFrame, current.frameMs)
    }
  }
  const measurements = phases.map(phase => {
    const frames = result.frames.filter(frame => frame.phase === phase)
    assert.ok(frames.length, 'No frames recorded for ' + phase)
    assert.ok(frames.every(frame => !frame.hidden), 'Hidden page during ' + phase)
    assert.ok(frames.every(frame => frame.remotes === 0), 'Another player entered during ' + phase)
    const builds = frames.flatMap(frame => frame.nodeBuilds)
    const gpu = frames.map(frame => gpuTimes.get(frame.rendererFrame)).filter(Number.isFinite).sort((a,b)=>a-b)
    const materials = new Set(builds.map(build => build.materialId).filter(id => id != null))
    const buildIntervals = frames
      .filter(frame => frame.nodeBuilds.length || frame.pipelines)
      .map(frame => followingIntervals.get(frame.gameFrame))
      .filter(Number.isFinite)
    return {
      phase, frames: frames.length, materialsBuilt: materials.size, nodeBuilds: builds.length,
      gpuSamples: gpu.length, gpuMedianMs: gpu[Math.floor(gpu.length / 2)] ?? null,
      nodeBuildMs: frames.reduce((sum, frame) => sum + frame.nodeBuildMs, 0),
      shaderStageCalls: frames.reduce((sum, frame) => sum + frame.shaderStageCalls, 0),
      shaderStageSubmissionMs: frames.reduce((sum, frame) => sum + frame.shaderStageSubmissionMs, 0),
      pipelineCalls: frames.reduce((sum, frame) => sum + frame.pipelines, 0),
      pipelineSubmissionMs: frames.reduce((sum, frame) => sum + frame.pipelineMs, 0),
      longestIntervalAfterBuildOrPipelineMs: buildIntervals.length ? Math.max(...buildIntervals) : null,
      longestFrameMs: Math.max(...frames.map(frame => frame.frameMs)),
    }
  })
  await writeFile(output, JSON.stringify({ ...result, profile, renderSize, lightingNode, measurements, sceneMaterials, shadows, load: samples }), { flag: 'wx' })
  for (const [path, png] of shadowImages) await writeFile(path, png, { flag: 'wx' })
  console.table(measurements)
} finally {
  clearInterval(timer)
  await browser?.close()
}
