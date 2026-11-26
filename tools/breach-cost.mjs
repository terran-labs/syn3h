// What the Zorb breach (spraySim.ts breach) costs a frame at its peak, at each quality level.
// Run from a built checkout:
//
//   tools/heavy.sh node tools/breach-cost.mjs [checkout] [--webgl]
//
// Archipelago 4 at 14:00, 1280 by 720, no bots, offline, the camera on open water. For each level,
// set as a player sets it (through the shell's veil): blocks of 40 frames alternating between
// quiet water and a breach from 8 m at 10 m/s, triggered through the game's own spray system (a
// ball of radius 2.5 reported 8 m under, then out) 6 frames before its block, so the block sits on
// the peak. Per frame: the game callback's script time and the time to the GPU finishing it
// (WebGPU: queue drained; WebGL: a 1-pixel read). Values are observations; no thresholds.
import { cpus, loadavg } from 'node:os'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const dir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? '.'
const webgl = process.argv.includes('--webgl')
const app = await serveStable({ dir, port: 0 })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const rows = [], loads = [loadavg()[0]], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?autoplay=1&vehicle=buggy&world=archipelago.4${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3h.game.tick > 60, null, { timeout: 120000 })
  const spot = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, sp = t.spawnPoint(0).position
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 14); s.params.set('sun.dayLength', 0); s.game.quality.setAuto(false)
    for (let r = 30; r < 3000; r += 15) for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
      if (t.liquidKindAt?.(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 12) return { x, z, surface: t.liquidHeightAt(x, z) }
    }
    return null
  })
  if (!spot) throw Error('no open water')
  for (const level of [0, 1, 2, 3, 4, 5]) {
    await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
    await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 120000 })
    // The player parked on the shore side, the camera looking at the spot from 25 m.
    await page.evaluate((spot) => {
      const s = window.syn3h, V = s.game.camera.position.constructor
      s.player.teleport({ x: spot.x + 40, y: spot.surface + 30, z: spot.z }, 0); s.player.body.setBodyType(2, true)
      s.camera.setCinematicPose(new V(spot.x - 25, spot.surface + 5, spot.z), new V(spot.x, spot.surface + 3, spot.z))
    }, spot)
    await page.waitForTimeout(2000)
    const samples = { quiet: [], breach: [] }, drops = []
    for (const which of ['quiet', 'breach', 'quiet', 'breach']) {
      const block = await page.evaluate(async ({ which, spot }) => {
        const s = window.syn3h, game = s.game, b = game.renderer.backend
        const fx = game.systems.find(x => x.spray && x.underwater), V = game.camera.position.constructor
        const frame = () => new Promise(r => requestAnimationFrame(r))
        if (which === 'breach') {
          const at = new V(spot.x, spot.surface, spot.z), id = `cost-${Math.random()}`
          fx.spray.vehicle(id, at, new V(0, 10, 0), 0, 1 / 60, { ball: 2.5, under: 8, height: 5 })
          await frame()
          fx.spray.vehicle(id, at, new V(0, 10, 0), 0, 1 / 60, { ball: 2.5, under: -5, height: 5 })
          for (let i = 0; i < 6; i++) await frame()
        } else for (let i = 0; i < 40; i++) await frame()
        const gl = b.gl, px = new Uint8Array(4)
        const drain = b.device ? () => b.device.queue.onSubmittedWorkDone() : async () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) }
        const original = game.frame, script = [], total = []
        game.frame = () => {}
        try {
          await drain()
          for (let i = 0; i < 40; i++) {
            await frame()
            const t0 = performance.now(); original.call(game); const t1 = performance.now()
            await drain()
            script.push(t1 - t0); total.push(performance.now() - t0)
          }
        } finally { game.frame = original }
        return { script, total, drops: fx.spray.sim?.dropletCount ?? 0 }
      }, { which, spot })
      samples[which].push(...block.total.map((t, i) => ({ total: t, script: block.script[i] })))
      if (which === 'breach') drops.push(block.drops)
      loads.push(loadavg()[0])
    }
    const p50 = (xs) => { const o = xs.toSorted((a, b) => a - b); return o[Math.floor(o.length / 2)] }
    const row = { level, name: await page.evaluate(() => window.syn3h.game.quality.getQualityState().name),
      quiet: p50(samples.quiet.map(x => x.total)), breach: p50(samples.breach.map(x => x.total)),
      quietScript: p50(samples.quiet.map(x => x.script)), breachScript: p50(samples.breach.map(x => x.script)),
      dropsAtBlockEnd: drops }
    rows.push(row)
    console.error(JSON.stringify(row))
  }
} catch (e) { errors.push(String(e)) } finally { await browser.close(); await app.close() }
const f = (x) => x?.toFixed(2) ?? 'n/a'
console.log(`Zorb breach from 8 m at its peak: frame cost (ms, p50 of 80 frames each), ${webgl ? 'WebGL 2' : 'WebGPU'}, ${cpus()[0].model}, 1280×720. Load ${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)}.`)
console.log('| Level | Quiet total | Breach total | Difference | Quiet script | Breach script | Drops alive at block end |\n|---|---:|---:|---:|---:|---:|---|')
for (const r of rows) console.log(`| ${r.name} | ${f(r.quiet)} | ${f(r.breach)} | ${f(r.breach - r.quiet)} | ${f(r.quietScript)} | ${f(r.breachScript)} | ${r.dropsAtBlockEnd.join(', ')} |`)
console.log(JSON.stringify({ errors }))
process.exit(errors.length ? 1 : 0)
