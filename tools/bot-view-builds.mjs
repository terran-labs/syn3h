// Which render pipelines are built when other vehicles come into view at range, and for what.
// The same parking as tools/vehicle-detail-cost.mjs (a level's maximum bots in an arc in front of
// the camera, from 32 m out), at fixed ranges so any build can be compared with another:
//
//   tools/heavy.sh node tools/bot-view-builds.mjs <built checkout> [label] [--close] [--webgl]
//
// --close parks them from 8 m to 28 m instead: inside the old 30 m full-detail distance.
//
// Levels are changed as a player changes them, through the shell's veil. Alpine seed 4 at 23:00,
// WebGPU, 1280 by 720. For High (6 bots to 66 m), Ultra (8 to 85 m) and
// Cinematic (16 to 105 m): the level set and settled, bots materialised and parked out of sight
// 400 m behind the camera, then every render pipeline created from the moment they are parked in
// view until 120 frames later, each with its material, object and the vehicle it belongs to.
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const args = process.argv.slice(2).filter(a => !a.startsWith('--')), close = process.argv.includes('--close'), webgl = process.argv.includes('--webgl')
const dir = args[0] ?? '.', label = (args[1] ?? 'build') + (close ? '-close' : '') + (webgl ? '-webgl' : '')
const app = await serveStable({ dir, port: 0 })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const LEVELS = [[3, 6, 66], [4, 8, 85], [5, 16, 105]]
const out = { label, dir, levels: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => out.errors.push(e.message))
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?planet=alpine&seed=4&autoplay=1&vehicle=buggy&daydream=0&room=bvb${Date.now().toString(36)}${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.shell.transitioning && window.syn3hNet?.isHost, null, { timeout: 90000 })
  out.build = await page.evaluate(() => fetch('/build.json').then(r => r.ok ? r.json() : null).catch(() => null))
  await page.evaluate(() => {
    const { params, game } = window.syn3h
    // The shell's own manual change (Shell.ts), as a player's: in play it applies the level behind
    // its veil, with the climb's preparation (Game.prepareClimbedLevel). Replacing it with a bare
    // apply climbs in play unprepared, which no player does, and builds what that preparation would.
    game.quality.setAuto(false)
    params.set('bots.keepCount', true); params.set('bots.fleet', 1); params.set('sun.timeOfDay', 23); params.set('sun.dayLength', 0)
    // Every pipeline created, with what it is for; recording switched on and off around a window.
    const b = game.renderer.backend, make = b.createRenderPipeline
    window.__builds = null
    b.createRenderPipeline = function (renderObject, ...rest) {
      if (window.__builds) {
        const m = renderObject?.material, o = renderObject?.object, chain = []
        for (let p = o; p && chain.length < 8; p = p.parent) chain.push(p.name || p.type)
        const owner = window.syn3h.bots.vehicles.find(v => { for (let p = o; p; p = p.parent) if (p === v.object) return true; return false })
        window.__builds.push({ material: `${m?.type ?? '?'}${m?.name ? ` "${m.name}"` : ''}`, object: `${o?.type ?? '?'}${o?.name ? ` "${o.name}"` : ''}`, chain: chain.join(' < '), vehicle: owner ? owner.kind : null })
      }
      return make.call(this, renderObject, ...rest)
    }
  })
  for (const [level, n, range] of LEVELS) {
    // How long the climb takes and keeps its veil up, from the request to the veil gone.
    const climbStart = Date.now()
    await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
    await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 90000 })
    const climbMs = Date.now() - climbStart
    await page.evaluate(n => window.syn3h.params.set('bots.count', n), n)
    await page.waitForFunction(n => { const { bots, materialize } = window.syn3h; return bots.vehicles.length === n && bots.vehicles.every(v => !materialize.isMaterializing(v)) }, n, { timeout: 180000 })
    // Brains off, everyone parked out of sight behind the camera, and a moment to settle.
    await page.evaluate(() => {
      const { game, bots, terrain, player, camera } = window.syn3h
      for (const brain of bots.brainList) game.remove(brain, false)
      const pad = terrain.spawnPoint(0).position, V = pad.constructor
      const eye = new V(pad.x, terrain.heightAt(pad.x, pad.z) + 4, pad.z)
      camera.setCinematicPose(eye, new V(pad.x, eye.y - 2, pad.z - 100), 60)
      player.teleport(new V(pad.x, terrain.heightAt(pad.x, pad.z + 6) + 2, pad.z + 6), 0); player.body.setBodyType(2, true)
      bots.vehicles.forEach((v, i) => { const x = pad.x + 20 * i, z = pad.z + 400; v.teleport(new V(x, terrain.heightAt(x, z) + 2, z), 0); v.body.setBodyType(2, true) })
    })
    await page.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k > 90 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }))
    // Into view: recording from the parking on.
    const builds = await page.evaluate(async ({ range, close }) => {
      const { terrain, bots } = window.syn3h, pad = terrain.spawnPoint(0).position, V = pad.constructor
      window.__builds = []
      const n = bots.vehicles.length, from = close ? 8 : 32, to = close ? 28 : range
      bots.vehicles.forEach((v, i) => {
        const d = from + (to - from) * (n > 1 ? i / (n - 1) : 0.5), a = (i % 2 ? 1 : -1) * (0.15 + 0.4 * (i / Math.max(1, n)))
        const x = pad.x + Math.sin(a) * d, z = pad.z - Math.cos(a) * d
        v.teleport(new V(x, terrain.heightAt(x, z) + 2, z), 0); v.body.setBodyType(2, true)
      })
      await new Promise(r => { let k = 0; const f = () => (++k > 120 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) })
      const list = window.__builds; window.__builds = null
      return list
    }, { range, close })
    const grouped = {}
    for (const b of builds) { const k = `${b.vehicle ?? 'not a bot'} | ${b.material} | ${b.object} | ${b.chain}`; grouped[k] = (grouped[k] ?? 0) + 1 }
    const kinds = await page.evaluate(() => window.syn3h.bots.vehicles.map(v => v.kind))
    // The bots' reserve models (BotRenderWarm.reserve, where the build has them): their geometry.
    const reserve = await page.evaluate(() => {
      const warm = window.syn3h.game.systems.find(s => s.covered?.reserve instanceof Map)?.covered
      if (!warm) return null
      let bytes = 0, meshes = 0
      const seen = new Set()
      for (const v of warm.reserve.values()) v.object.traverse(o => {
        if (!o.geometry || seen.has(o.geometry)) return
        seen.add(o.geometry); meshes++
        for (const a of Object.values(o.geometry.attributes)) bytes += a.array?.byteLength ?? 0
        bytes += o.geometry.index?.array?.byteLength ?? 0
      })
      return { kinds: [...warm.reserve.keys()], meshes, geometryMB: +(bytes / 1048576).toFixed(2) }
    })
    out.levels.push({ level, bots: n, range, kinds, total: builds.length, grouped, climbMs, reserve })
    console.log(`${label} level ${level}: ${builds.length} pipelines built bringing ${n} bots (${[...new Set(kinds)].join(', ')}) into view to ${range} m; climb ${climbMs} ms`)
  }
} catch (e) { out.errors.push(String(e)) } finally {
  await writeFile(`/tmp/syn3h-queue/bot-view-builds-${label}.json`, JSON.stringify(out, null, 2))
  await browser.close(); await app.close()
}
console.log(JSON.stringify({ errors: out.errors }))
process.exit(out.errors.length ? 1 : 0)
