// Other vehicles' full-detail distance per quality level (src/vehicles/skins/mergeStatic.ts): what
// it costs to draw a level's bots in full detail out to that level's distance instead of 30 m.
// Measured as tools/quality-frame-cost.mjs measures a frame (its own script time and GPU tail, a
// native GPU span where the backend has timers), in blocks alternating the old and the new
// distance on the same page. Run from a built checkout:
//
//   tools/heavy.sh node tools/vehicle-detail-cost.mjs [checkout] [--phone]
//
// Alpine seed 4 at 23:00. For each level from Medium up (Minimal and Low keep 30 m), its own
// maximum bots are parked in an arc in front of the camera, from 32 m to 95% of the level's new
// full-detail distance: the band where the change shows, so the worst case. Timing values are
// observations; no thresholds.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus, loadavg } from 'node:os'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const report = console.log
console.log = console.error
const dir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? '.'
const phone = process.argv.includes('--phone')
const viewport = phone ? { width: 844, height: 390 } : { width: 1280, height: 720 }
const release = await readFile(join(dir, 'dist/build.json'), 'utf8').then(JSON.parse).catch(() => ({}))
const app = await serveStable({ dir, port: 0 })
const loads = [loadavg()[0]]
// Each level's bot budget (src/core/quality.ts LEVELS `bots`), Medium to Cinematic.
const LEVEL_BOTS = { 2: 4, 3: 6, 4: 8, 5: 16 }
const rows = []
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const backend of ['webgpu', 'webgl']) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?planet=alpine&seed=4&autoplay=1&vehicle=buggy&daydream=0&room=vdc-${backend}${backend === 'webgl' ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.shell.transitioning && window.syn3hNet?.isHost, null, { timeout: 90000 })
    await page.evaluate(() => {
      const { params, game } = window.syn3h
      game.quality.setAuto(false)
      game.quality.manualChange = (_level, apply) => apply()
      params.set('bots.keepCount', true)
      params.set('bots.fleet', 1)
      params.set('sun.timeOfDay', 23)
      params.set('sun.dayLength', 0)
    })
    // Pipelines built from here on, as tools/performance-check.mjs counts them: none may be built
    // in play, including in the frames right after a vehicle crosses a distance or the level climbs.
    await page.evaluate(() => {
      const b = window.syn3h.game.renderer.backend, make = b.createRenderPipeline
      window.__pipelines = 0
      b.createRenderPipeline = function (...a) { window.__pipelines++; return make.apply(this, a) }
    })
    for (const level of [2, 3, 4, 5]) {
      await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
      await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 90000 })
      const target = await page.evaluate(n => { const { params } = window.syn3h; params.set('bots.count', n); return { n, near: params.get('vehicle.detailNear').value } }, LEVEL_BOTS[level])
      await page.waitForFunction(n => { const { bots, materialize } = window.syn3h; return bots.vehicles.length === n && bots.vehicles.every(v => !materialize.isMaterializing(v)) }, target.n, { timeout: 180000 })
      await page.evaluate(() => { const { game, bots } = window.syn3h; for (const brain of bots.brainList) game.remove(brain, false) })
      const place = ({ near }) => {
        const { terrain, bots, player, camera } = window.syn3h
        const pad = terrain.spawnPoint(0).position, V = pad.constructor
        const eye = new V(pad.x, terrain.heightAt(pad.x, pad.z) + 4, pad.z)
        camera.setCinematicPose(eye, new V(pad.x, eye.y - 2, pad.z - 100), 60)
        player.teleport(new V(pad.x, terrain.heightAt(pad.x, pad.z + 6) + 2, pad.z + 6), 0); player.body.setBodyType(2, true)
        const n = bots.vehicles.length, from = 32, to = Math.max(from + 1, near * 0.95)
        bots.vehicles.forEach((v, i) => {
          const d = from + (to - from) * (n > 1 ? i / (n - 1) : 0.5), a = (i % 2 ? 1 : -1) * (0.15 + 0.4 * (i / Math.max(1, n)))
          const x = pad.x + Math.sin(a) * d, z = pad.z - Math.cos(a) * d
          v.teleport(new V(x, terrain.heightAt(x, z) + 2, z), 0); v.body.setBodyType(2, true)
        })
      }
      const samples = { old: { script: [], tail: [], full: [], gpu: [], pipelines: 0 }, new: { script: [], tail: [], full: [], gpu: [], pipelines: 0 } }
      for (const which of ['old', 'new', 'old', 'new']) {
        const before = await page.evaluate(() => window.__pipelines)
        await page.evaluate(({ near }) => window.syn3h.params.set('vehicle.detailNear', near), { near: which === 'old' ? 30 : target.near })
        await page.evaluate(place, target)
        const block = await page.evaluate(async () => {
          const { game, bots } = window.syn3h
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
          if (bots.vehicles.some((v,i) => {
            const p = v.body.translation(), a = actors[i]
            return v.object.id !== a.id || Math.hypot(p.x-a.pos.x,p.y-a.pos.y,p.z-a.pos.z) > 0.1
          })) throw Error('The parked bot vehicles must remain where they were put')
          const full0 = bots.vehicles.filter(v => v.object.visible).length
          return { transitionError, name: game.quality.getQualityState().name, script, tail, full, gpu, bots: bots.vehicles.length, visible: full0 }
        })
        for (const metric of Object.keys(samples[which])) samples[which][metric].push(...block[metric])
        samples[which].pipelines = (samples[which].pipelines ?? 0) + (await page.evaluate(() => window.__pipelines)) - before
        console.error(backend, block.name, which, block.script.length, 'frames,', block.gpu.length, 'GPU samples,', block.bots, 'bots')
        loads.push(loadavg()[0])
      }
      const climb = await page.evaluate(() => window.__pipelines)
      rows.push({ backend, level, climb, name: (await page.evaluate(() => window.syn3h.game.quality.getQualityState().name)), bots: target.n, near: target.near, samples })
    }
    if (errors.length) throw Error(errors.join('; '))
    await page.context().close()
  }
  const q = (values, fraction) => {
    if (!values.length) return null
    const ordered = values.toSorted((a, b) => a - b)
    return ordered[Math.ceil(ordered.length * fraction) - 1]
  }
  const f = (x) => x === null ? 'n/a' : x.toFixed(2)
  report(`Other vehicles' full-detail distance: frame cost (ms), ${release.version ?? 'local build'}. Chrome ${browser.version()}, ${cpus()[0].model}, ${process.platform} ${process.arch}, ${viewport.width}×${viewport.height} DPR 1. Alpine seed 4, 23:00, each level's maximum bots parked from 32 m to 95% of its new distance. Sampled load ${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)}.`)
  report('| Backend | Quality | Bots | Full detail within (m) | Script p50 | GPU tail p50 | Total p50 | Total p95 | GPU span p50 | Pipelines built |\n|---|---|---:|---|---:|---:|---:|---:|---:|---:|')
  for (const r of rows) for (const which of ['old', 'new']) {
    const s = r.samples[which]
    report('| ' + [r.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2', r.name, r.bots, which === 'old' ? '30 (before)' : `${r.near} (after)`, f(q(s.script, .5)), f(q(s.tail, .5)), f(q(s.full, .5)), f(q(s.full, .95)), f(q(s.gpu, .5)), s.pipelines].join(' | ') + ' |')
  }
  report('Each distance: 96 frames in two blocks alternating with the other on the same page. Total runs from game callback start to GPU completion, excluding display pacing. Pipelines built: render pipelines created from the distance change and placement to the end of its blocks, counted as tools/performance-check.mjs does.')
} finally { await browser.close(); await app.close(); console.log = report }
