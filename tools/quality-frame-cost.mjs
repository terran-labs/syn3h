// Run from a checkout with dependencies: tools/heavy.sh node tools/quality-frame-cost.mjs [built checkout or release snapshot]
// Prints a Markdown table for release notes. Timing values are observations. No performance thresholds.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus, loadavg } from 'node:os'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

// The snapshot's room server logs connections. Keep stdout pasteable as Markdown.
const report = console.log
console.log = console.error
const dir = process.argv[2] ?? '.'
const release = await readFile(join(dir, 'dist/build.json'), 'utf8').then(JSON.parse).catch(() => ({}))
const app = await serveStable({ dir, port: 0 })
const rows = new Map()
const loads = [loadavg()[0]]
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const backend of ['webgpu', 'webgl']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?planet=alpine&seed=4&autoplay=1&vehicle=buggy&daydream=0&room=bench-${backend}${backend === 'webgl' ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.shell.transitioning && window.miraNet?.isHost, null, { timeout: 90000 })
    assert.equal(await page.evaluate(() => window.mira.game.backend), backend)
    await page.evaluate(() => {
      const { params, game } = window.mira
      game.quality.setAuto(false)
      // Measure settled presets. The manual transition veil starts asynchronous
      // preparation for other variants, which can continue into the next block.
      game.quality.manualChange = (_level, apply) => apply()
      params.set('bots.keepCount', true)
      params.set('bots.fleet', 1)
      params.set('bots.count', 4)
      params.set('sun.timeOfDay', 23)
      params.set('sun.dayLength', 0)
    })
    await page.waitForFunction(() => {
      const { bots, materialize } = window.mira
      return bots.vehicles.length === 4 && bots.vehicles.every(v => !materialize.isMaterializing(v))
    }, null, { timeout: 120000 })
    // An immobile driver eventually requests rescue and teleports out of the fixture.
    // Park the drivers for this local page. Vehicle rendering and world updates keep running.
    await page.evaluate(() => {
      const { game, bots } = window.mira
      for (const brain of bots.brainList) game.remove(brain, false)
    })
    const placeActors = () => {
      const { terrain, bots, player, camera } = window.mira
      const pad = terrain.spawnPoint(0).position
      const place = (x, z, height) => pad.clone().set(pad.x+x, terrain.heightAt(pad.x+x, pad.z+z)+height, pad.z+z)
      for (const [i, vehicle] of [player, ...bots.vehicles].entries()) {
        vehicle.teleport(place((i-2)*6, i%2*4, 2), 0)
        vehicle.body.setBodyType(2, true) // Rapier position-based kinematic body
      }
      camera.setCinematicPose(place(0, 32, 8), place(0, 2, 2), 60)
    }
    const order = [0, 3, 1, 4, 2, 5]
    const byLevel = new Map()
    for (const level of [...order, ...order.toReversed()]) {
      await page.evaluate(level => window.mira.game.quality.setLevel(level), level)
      await page.waitForFunction(level => window.mira.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 90000 })
      await page.evaluate(placeActors)
      const block = await page.evaluate(async () => {
        const { game, bots } = window.mira
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        for (let i = 0; i < 60; i++) await frame()
        const actors = bots.vehicles.map(v => ({ id: v.object.id, pos: v.body.translation() }))
        const b = game.renderer.backend
        const gl = b.gl
        const transitionError = gl?.getError()
        const pixel = new Uint8Array(4)
        // Three may leave a floating point read framebuffer bound after a post pass.
        // Read the presented color buffer and restore the binding Three is tracking.
        const readCanvas = () => {
          const saved = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)
          if (saved) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
          try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel) }
          finally { if (saved) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved) }
        }
        const drain = b.device ? () => b.device.queue.onSubmittedWorkDone()
          : readCanvas
        const nativeTimer = b.device?.features.has('timestamp-query') || b.disjoint
        const original = game.frame, tracking = b.trackTimestamp
        // Read the actual first-to-last pass span. Adding individual pass durations
        // double counts GPU work on hardware that overlaps vertex and fragment stages.
        const device = b.device
        const pool = nativeTimer && device ? device.createQuerySet({ type: 'timestamp', count: 256 }) : null
        const resolve = pool && device.createBuffer({ size: 2048, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
        const read = pool && device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
        const init = b.initTimestampQuery
        let slots = 0
        const stamp = (type, uid, descriptor) => {
          if (slots >= pool.count) throw Error('Too many passes for this timestamp sample')
          descriptor.timestampWrites = { querySet: pool, beginningOfPassWriteIndex: slots++, endOfPassWriteIndex: slots++ }
        }
        const script = [], tail = [], full = [], gpu = []
        // Three keeps its normal animation clock. Between samples no other game draw
        // may submit work to this queue. Drain the previous frame before timing this one.
        game.frame = () => {}
        try {
          await drain()
          for (let i = 0; i < 60; i++) {
            await frame()
            const timerFrame = i % 5 === 4
            const timedPasses = timerFrame && nativeTimer
            b.trackTimestamp = false
            slots = 0
            b.initTimestampQuery = timedPasses && pool ? stamp : init
            const query = timedPasses && !device ? b.gl.createQuery() : null
            if (query) b.gl.beginQuery(b.disjoint.TIME_ELAPSED_EXT, query)
            const previous = game.lastDraw
            const start = performance.now()
            original.call(game)
            const submitted = performance.now()
            if (query) b.gl.endQuery(b.disjoint.TIME_ELAPSED_EXT)
            if (previous === game.lastDraw || document.hidden || game.holdDraws || game.applyingQuality)
              throw Error('The sampled game callback did not draw an ordinary play frame')
            await drain()
            const finished = performance.now()
            if (timedPasses && slots) {
              const encoder = device.createCommandEncoder()
              encoder.resolveQuerySet(pool, 0, slots, resolve, 0)
              encoder.copyBufferToBuffer(resolve, 0, read, 0, slots * 8)
              device.queue.submit([encoder.finish()])
              await read.mapAsync(GPUMapMode.READ, 0, slots * 8)
              const stamps = new BigUint64Array(read.getMappedRange(0, slots * 8))
              let first = stamps[0], last = stamps[1]
              for (let j = 2; j < slots; j += 2) {
                if (stamps[j] < first) first = stamps[j]
                if (stamps[j+1] > last) last = stamps[j+1]
              }
              if (first > 0n && last > first) gpu.push(Number(last-first)/1e6)
              read.unmap()
            } else if (query) {
              // WebGL query availability updates after control returns to the browser.
              await frame()
              if (b.gl.getQueryParameter(query, b.gl.QUERY_RESULT_AVAILABLE) && !b.gl.getParameter(b.disjoint.GPU_DISJOINT_EXT)) {
                const ms = b.gl.getQueryParameter(query, b.gl.QUERY_RESULT) / 1e6
                if (ms > 0) gpu.push(ms)
              }
              b.gl.deleteQuery(query)
            } else if (!timerFrame) {
              script.push(submitted-start)
              tail.push(finished-submitted)
              full.push(finished-start)
            }
          }
        } finally {
          game.frame = original
          b.trackTimestamp = tracking
          b.initTimestampQuery = init
          pool?.destroy()
          resolve?.destroy()
          read?.destroy()
        }
        if (gl) {
          const error = gl.getError()
          if (error !== gl.NO_ERROR) throw Error('WebGL measurement failed with code '+error)
        }
        if (actors.length !== 4 || bots.vehicles.length !== 4 || bots.vehicles.some((v,i) => {
          const p = v.body.translation(), a = actors[i]
          return v.object.id !== a.id || !v.object.visible || Math.hypot(p.x-a.pos.x,p.y-a.pos.y,p.z-a.pos.z) > 0.1
        })) throw Error('The four parked bot vehicles must remain in formation and visible')
        return { transitionError, name: game.quality.getQualityState().name, script, tail, full, gpu,
          pools: game.scene.userData.vehicleEffects?.pools }
      })
      const samples = byLevel.get(level) ?? { script: [], tail: [], full: [], gpu: [] }
      for (const metric of Object.keys(samples)) samples[metric].push(...block[metric])
      byLevel.set(level,samples)
      console.error(backend,block.name,block.script.length,'sampled frames;',block.gpu.length,'native GPU samples;',block.pools,'ground pools')
      if (block.transitionError) console.error(backend, block.name, 'GL error present before sampling:', block.transitionError)
      rows.set(level, { ...rows.get(level), name: block.name, [backend]: samples })
      loads.push(loadavg()[0])
    }
    assert.deepEqual(errors, [])
    await page.context().close()
  }
  const quantile = (values, fraction) => {
    if (!values.length) return 'n/a'
    const ordered = values.toSorted((a, b) => a - b)
    return ordered[Math.ceil(ordered.length * fraction) - 1].toFixed(2)
  }
  report(`Frame cost (ms), ${release.version ?? 'local build'}. Chrome ${browser.version()}, ${cpus()[0].model}, ${process.platform} ${process.arch}, 1280×720 DPR 1. Alpine seed 4, 23:00, four parked mixed bots. Sampled load ${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)}.`)
  report('| Backend | Quality | Script p50 | GPU tail p50 | Total p50 | Total p95 | GPU span p50 |\n|---|---|---:|---:|---:|---:|---:|')
  for (const backend of ['webgpu', 'webgl']) {
    for (let level = 0; level < 6; level++) {
      const row = rows.get(level), s = row[backend]
      const label = backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'
      const cells = [label, row.name, quantile(s.script, 0.5), quantile(s.tail, 0.5),
        quantile(s.full, 0.5), quantile(s.full, 0.95), quantile(s.gpu, 0.5)]
      report('| ' + cells.join(' | ') + ' |')
    }
  }
  report('96 frames per row in two interleaved blocks. Total runs from game callback start to GPU completion, excluding display pacing. Tail includes WebGPU queue notification or a one-pixel WebGL readback. Native GPU span includes gaps between passes and uses separate timed frames where supported.')
} finally { await browser.close(); await app.close(); console.log = report }
