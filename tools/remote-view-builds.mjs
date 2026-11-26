// Which render pipelines another PLAYER's vehicle builds on this page when it first comes into view
// at range: a remote human's jet, buggy or hovercraft (net/index.ts makes it with createVehicle, not
// from the bot pool), at its medium and far detail looks. Run from a built checkout:
//
//   tools/heavy.sh node tools/remote-view-builds.mjs <built checkout> [label] [--webgl]
//
// Two pages in one room on this checkout's server (serve-stable, with its room). A, the observer,
// enters at High; B, the other player, enters at Minimal and parks 400 m behind A's camera. For each
// kind: B switches to it out of sight, then is placed in front of A's camera at 30, 60, 90 and 120 m
// in turn, a second each, while A records every pipeline created. Then A climbs to Ultra through the
// shell's veil, as a player does, and the three kinds are shown again.
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const args = process.argv.slice(2).filter(a => !a.startsWith('--')), webgl = process.argv.includes('--webgl')
const dir = args[0] ?? '.', label = (args[1] ?? 'build') + (webgl ? '-webgl' : '')
const app = await serveStable({ dir, port: 0 })
const base = `http://127.0.0.1:${app.server.address().port}/`
const room = `rvb${Date.now().toString(36)}`
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const out = { label, phases: [], errors: [] }
const frames = (page, n) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k > n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)
try {
  const open = async (name, vehicle, gfx) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
    page.on('pageerror', e => out.errors.push(`${name}: ${e.message}`))
    await page.goto(`${base}?autoplay=1&vehicle=${vehicle}&gfx=${gfx}&daydream=0&planet=alpine&seed=4&room=${room}&name=${name}${webgl ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.mira?.shell?.playing && !window.mira.shell.transitioning && window.miraNet?.connected, null, { timeout: 120000 })
    await page.evaluate(() => { const s = window.mira; s.params.set('bots.keepCount', true); s.params.set('bots.count', 0); s.game.quality.setAuto(false) })
    return page
  }
  const a = await open('Observer', 'buggy', 3)
  const b = await open('Other', 'buggy', 0)
  // A records every pipeline while __builds is an array, with what it was for.
  await a.evaluate(() => {
    const s = window.mira, bk = s.game.renderer.backend, make = bk.createRenderPipeline
    window.__builds = null
    bk.createRenderPipeline = function (renderObject, ...rest) {
      if (window.__builds) {
        const m = renderObject?.material, o = renderObject?.object, chain = []
        for (let p = o; p && chain.length < 6; p = p.parent) chain.push(p.name || p.type)
        const remote = [...window.miraNet.remotes.values()].find(r => { for (let p = o; p; p = p.parent) if (p === r.vehicle.object) return true; return false })
        const q = window.mira.game.quality.getQualityState(), shade = window.mira.params.get('gfx.vehicleShading')?.value
        window.__builds.push(`[rung ${q.rung} shading ${shade}] ${remote ? remote.vehicle.kind : 'not a remote'} | ${m?.type ?? '?'}${m?.name ? ` "${m.name}"` : ''} | ${o?.type ?? '?'}${o?.name ? ` "${o.name}"` : ''} | ${chain.join(' < ')}`)
      }
      return make.call(this, renderObject, ...rest)
    }
  })
  // A's camera held looking along -z from its pad; B is placed on that line.
  const pose = await a.evaluate(() => {
    const s = window.mira, t = s.terrain, pad = t.spawnPoint(0).position, V = pad.constructor
    s.player.teleport(new V(pad.x, t.heightAt(pad.x, pad.z + 6) + 2, pad.z + 6), 0); s.player.body.setBodyType(2, true)
    const eye = new V(pad.x, t.heightAt(pad.x, pad.z) + 4, pad.z)
    s.camera.setCinematicPose(eye, new V(pad.x, eye.y - 2, pad.z - 100), 60)
    return { x: pad.x, z: pad.z }
  })
  const placeB = (d) => b.evaluate(({ pose, d }) => {
    const s = window.mira, t = s.terrain, V = s.terrain.spawnPoint(0).position.constructor
    const x = pose.x + 3, z = d === null ? pose.z + 400 : pose.z - d
    s.player.teleport(new V(x, t.heightAt(x, z) + 2, z), Math.PI); s.player.body.setBodyType(2, true)
  }, { pose, d })
  const show = async (phase) => {
    for (const kind of ['jet', 'buggy', 'hovercraft']) {
      await placeB(null)
      await b.evaluate(kind => window.mira.swapVehicle(kind), kind)
      await placeB(null)
      // A has B's new vehicle (out of sight) and has settled.
      await a.waitForFunction(kind => [...window.miraNet.remotes.values()].some(r => r.vehicle.kind === kind), kind, { timeout: 30000 })
      await frames(a, 90)
      await a.evaluate(() => { window.__builds = [] })
      for (const d of [120, 90, 60, 30]) { await placeB(d); await frames(a, 60) }
      const builds = await a.evaluate(() => { const l = window.__builds; window.__builds = null; return l })
      const grouped = {}
      for (const x of builds) grouped[x] = (grouped[x] ?? 0) + 1
      const state = await a.evaluate(() => { const q = window.mira.game.quality.getQualityState(); return { level: q.level, rung: q.rung, shading: window.mira.params.get('gfx.vehicleShading')?.value, load: null } })
      out.phases.push({ phase, kind, total: builds.length, grouped, state })
      console.log(`${label} ${phase}: other player's ${kind} into view at 120 to 30 m: ${builds.length} pipelines`)
    }
  }
  await show('after entry at High')
  await a.evaluate(() => window.mira.game.quality.setLevel(4))
  await a.waitForFunction(() => window.mira.game.quality.governor.level === 4 && !document.querySelector('.quality-change-veil'), null, { timeout: 120000 })
  await frames(a, 90)
  await show('after a climb to Ultra')
} catch (e) { out.errors.push(String(e)) } finally {
  await writeFile(`/tmp/syn3h-queue/remote-view-builds-${label}.json`, JSON.stringify(out, null, 2))
  await browser.close(); await app.close()
}
console.log(JSON.stringify({ errors: out.errors }))
process.exit(out.errors.length || out.phases.some(p => p.total) ? 1 : 0)
