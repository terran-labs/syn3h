// Run from a checkout with dependencies: tools/heavy.sh node tools/quality-frame-cost.mjs [built checkout or release snapshot]
// Prints a Markdown table for release notes. Timing values are observations. No performance thresholds.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadavg } from 'node:os'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

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
    await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.shell.transitioning && window.syn3hNet?.isHost, null, { timeout: 90000 })
    assert.equal(await page.evaluate(() => window.syn3h.game.backend), backend)
    await page.evaluate(() => {
      const { params, game } = window.syn3h
      game.quality.setAuto(false)
      params.set('bots.keepCount', true)
      params.set('bots.fleet', 1)
      params.set('bots.count', 4)
      params.set('sun.timeOfDay', 11)
      params.set('sun.dayLength', 0)
    })
    await page.waitForFunction(() => {
      const { bots, materialize } = window.syn3h
      return bots.vehicles.length === 4 && bots.vehicles.every(v => !materialize.isMaterializing(v))
    }, null, { timeout: 120000 })
    const placeActors = () => {
      const { terrain, bots, player, camera } = window.syn3h
      const pad = terrain.spawnPoint(0).position
      const place = (x, z, height) => pad.clone().set(pad.x+x, terrain.heightAt(pad.x+x, pad.z+z)+height, pad.z+z)
      for (const [i, vehicle] of [player, ...bots.vehicles].entries()) {
        vehicle.teleport(place((i-2)*6, i%2*4, 2), 0)
        vehicle.body.lockTranslations(true, true)
        vehicle.body.lockRotations(true, true)
      }
      camera.setCinematicPose(place(0, 32, 8), place(0, 2, 2), 60)
    }
    for (let level = 0; level < 6; level++) {
      await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
      await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 90000 })
      await page.evaluate(placeActors)
      const data = await page.evaluate(async () => {
        const { game, bots } = window.syn3h
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        // Let camera easing, the manual transition and quality-dependent resources settle.
        for (let i = 0; i < 90; i++) await frame()
        const positions = bots.vehicles.map(vehicle => vehicle.body.translation())
        const frames = []
        for (let i = 0; i < 240; i++) {
          const before = game.frames
          await frame()
          if (game.frames !== before+1 || document.hidden || game.holdDraws || game.applyingQuality) throw Error('Interrupted game frame sample')
          frames.push(game.performance.frameMs)
        }
        const b = game.renderer.backend
        const ext = b.gl?.getExtension('EXT_disjoint_timer_query_webgl2')
        const gpu = []
        if (b.device?.features.has('timestamp-query') || ext) {
          if (ext) b.disjoint = ext
          // Measure render-pass execution separately so query readback never delays the frame-time sample.
          const init = b.initTimestampQuery, old = b.trackTimestamp
          const ids = new Set()
          b.initTimestampQuery = function(type, id, ...args) {
            if (type === 'render') ids.add(id)
            return init.call(this, type, id, ...args)
          }
          try {
            for (let i = 0; i < 24; i++) {
              await frame()
              ids.clear()
              b.trackTimestamp = true
              await frame()
              const captured = [...ids]
              const resolving = b.resolveTimestampsAsync('render')
              b.trackTimestamp = false
              await resolving
              if (ext && b.gl.getParameter(ext.GPU_DISJOINT_EXT)) continue
              if (captured.length && captured.every(id => b.hasTimestampQuery(id))) {
                const total = captured.reduce((sum, id) => sum + b.getTimestamp(id), 0)
                if (Number.isFinite(total) && total > 0) gpu.push(total)
              }
            }
          } finally { b.trackTimestamp = old; b.initTimestampQuery = init }
        }
        if (bots.vehicles.some((vehicle,i) => {
          const p = vehicle.body.translation(), origin = positions[i]
          return !origin || Math.hypot(p.x-origin.x, p.y-origin.y, p.z-origin.z) > 0.1
        })) throw Error('Bot formation moved during measurement')
        const quantile = (a, p) => a.toSorted((x,y) => x-y)[Math.ceil(a.length*p)-1]
        return { name: game.quality.getQualityState().name, bots: bots.vehicles.length, median: quantile(frames,.5), slow: quantile(frames,.95), gpu: quantile(gpu,.5) }
      })
      assert.equal(data.bots, 4)
      const values = [data.median, data.slow, data.gpu].map(ms => ms === undefined ? 'n/a' : ms.toFixed(2))
      rows.set(data.name, [...(rows.get(data.name) ?? []), ...values])
      loads.push(loadavg()[0])
    }
    assert.deepEqual(errors, [])
    await page.context().close()
  }
  console.log(`Frame cost (ms), ${release.version ?? release.build ?? 'local build'}. Chrome ${browser.version()}, ${process.platform} ${process.arch}, 1280×720 DPR 1. Alpine seed 4, four parked bots. Sampled load ${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)}.`)
  console.log('| Quality | WebGPU p50 | p95 | GPU p50 | WebGL 2 p50 | p95 | GPU p50 |\n|---|---:|---:|---:|---:|---:|---:|')
  for (const [name, values] of rows) console.log('| '+[name,...values].join(' | ')+' |')
  console.log('Frame intervals include display pacing (240 frames per level). GPU time sums measured render passes separately; n/a means no usable timer result.')
} finally { await browser.close(); await app.close() }
