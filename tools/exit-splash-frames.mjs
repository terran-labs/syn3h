/**
 * Splashes going into and coming out of the water (src/world/water/spraySim.ts exitSplash), seen:
 * the Zorb first, then each vehicle, day and night. Production build:
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh npm run build
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/exit-splash-frames.mjs <output directory> [--phone]
 *
 * Archipelago 4, High, no bots, interface hidden, offline; open water over 12 m deep. Scenes:
 *   zorb-deep     the ball let go 8 m under, rising fast: the breach, the largest splash.
 *   zorb-shallow  the same from 2.5 m.
 *   zorb-bob      the ball let go at rest with its centre at the surface (its top never under):
 *                 it bobs and must throw no exit splash.
 *   <kind>-enter  dropped in at speed, 10 degrees down from 4 m up.
 *   <kind>-exit   let go 3 m under, moving forward and up at speed.
 *   buggy-shore   driven (towed at 6 m/s) out of 1 m of water up a beach: its top never goes
 *                 under, so it must throw no exit splash.
 * Camera 22 m to the side, 5 m up. Frames every 150 ms around the event; notes give the spray
 * simulation's entry and exit counts for each scene. --phone: 844 by 390, the Zorb and the buggy.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/exit-splash/frames'
const phone = process.argv.includes('--phone')
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []
// [name, vehicle, zorb, start depth under the surface (negative: above), forward m/s, up m/s, frames]
const ZORB = [['zorb-deep', 'buggy', true, 8, 4, 14, 14], ['zorb-shallow', 'buggy', true, 2.5, 4, 6, 12], ['zorb-bob', 'buggy', true, 'bob', 0, 0, 10]]
// The tank is hidden in this build (src/vehicles/available.ts): asking for it gets the buggy.
const KINDS = phone ? ['buggy'] : ['buggy', 'jet', 'hovercraft']
const SCENES = [...ZORB, ...KINDS.flatMap(k => [[`${k}-enter`, k, false, -4, 18, -3.2, 10], [`${k}-exit`, k, false, 3, 14, 9, 12]]), ['buggy-shore', 'buggy', false, 'shore', 6, 0, 20]]
const HOURS = phone ? [14] : [14, 22]

for (const hour of HOURS) for (const [name, vehicle, zorb, depth, forward, up, frames] of SCENES) {
  const tag = `${name}-${hour === 14 ? 'day' : 'night'}${phone ? '-phone' : ''}`
  const page = await (await browser.newContext({ viewport: phone ? { width: 844, height: 390 } : { width: 1280, height: 720 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=${vehicle}&world=archipelago.4`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3h.game.tick > 60, null, { timeout: 120000 })
  // High, set as the quality menu would, and wait for its change to finish (a veil hides the game meanwhile).
  await page.evaluate(() => { const q = window.syn3h.game.quality; q.setAuto(false); q.manualChange = (_l, apply) => apply(); q.setLevel(3) })
  await page.waitForFunction(() => window.syn3h.game.quality.governor.level === 3 && !document.querySelector('.quality-change-veil'), null, { timeout: 90000 })
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
  const spot = await page.evaluate((hour) => {
    const s = window.syn3h, t = s.terrain, sp = t.spawnPoint(0).position
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', hour); s.params.set('sun.dayLength', 0);
    const deep = (x, z) => t.liquidKindAt?.(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 12
    for (let r = 30; r < 3000; r += 15) for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
      if (!deep(x, z)) continue
      let ok = true
      for (let d = -40; d <= 40 && ok; d += 10) ok = deep(x + d, z) && deep(x, z + d)
      if (ok) return { x, z, surface: t.liquidHeightAt(x, z) }
    }
    return null
  }, hour)
  if (!spot) { errors.push(`${tag}: no open water`); await page.close(); continue }
  // Out at the spot first and let the world there finish arriving (a jump of up to 3 km from the
  // spawn draws black for a second or so).
  await page.evaluate((spot) => {
    const s = window.syn3h, V = s.game.camera.position.constructor
    s.player.teleport({ x: spot.x, y: spot.surface + 3, z: spot.z }, 0)
    s.camera.setCinematicPose(new V(spot.x - 4, spot.surface + 5, spot.z + 22), new V(spot.x - 4, spot.surface + 1.5, spot.z))
  }, spot)
  await page.waitForTimeout(2500)
  if (zorb) {
    // Ball on (the Zorb key), grown before the scene starts.
    await page.evaluate((spot) => window.syn3h.player.teleport({ x: spot.x, y: spot.surface + 3, z: spot.z }, 0), spot)
    // Straight to the input (a key press is ignored while the game's input is suspended).
    await page.evaluate(() => { const i = window.syn3h.game.input; if (!i.state.zorb) i.toggleZorb() })
    await page.waitForFunction(() => { const p = window.syn3h.player; return p.zorbed && p.zorb.radius > 0 && Math.abs(p.zorb.radius - p.zorb.target) < .01 }, null, { timeout: 15000 }).catch(() => errors.push(`${tag}: zorb did not grow`))
  }
  const before = await page.evaluate(({ spot, depth, forward, up }) => {
    const s = window.syn3h, b = s.player, fx = s.game.systems.find(x => x.spray && x.underwater)
    if (depth === 'shore') {
      // 1 m of water with dry land 12 m ahead, heading for it.
      const t = s.terrain, sp = t.spawnPoint(0).position, wet = (x, z) => t.liquidKindAt?.(x, z) === 'water'
      let at = null
      for (let r = 10; r < 3000 && !at; r += 5) for (let a = 0; a < 96 && !at; a++) {
        const ang = a / 96 * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
        if (!wet(x, z)) continue
        const d = t.liquidHeightAt(x, z) - t.heightAt(x, z)
        if (d < .8 || d > 1.3) continue
        for (let k = 0; k < 16 && !at; k++) {
          const hd = k / 16 * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
          if (!wet(x + dx * 6, z + dz * 6) || wet(x + dx * 14, z + dz * 14) || wet(x + dx * 20, z + dz * 20)) continue
          at = { x, z, hd, dx, dz }
        }
      }
      if (!at) return { error: 'no beach' }
      b.teleport({ x: at.x, y: t.heightAt(at.x, at.z) + 1, z: at.z }, at.hd)
      s.game.add({ fixedUpdate() { const v = b.body.linvel(); if (window.__towing) b.body.setLinvel({ x: at.dx * forward, y: v.y, z: at.dz * forward }, true) } }, 'shore tow')
      window.__towing = false; window.__shore = { ...at, forward }
      const V = s.game.camera.position.constructor, w = t.liquidHeightAt(at.x, at.z)
      s.camera.setCinematicPose(new V(at.x + at.dz * 18 - at.dx * 2, w + 5, at.z - at.dx * 18 - at.dz * 2), new V(at.x + at.dx * 8, w + 1, at.z + at.dz * 8))
      window.__fx = fx
      return { entries: fx.spray.sim?.entries ?? 0, exits: fx.spray.sim?.exits ?? 0 }
    }
    // Depth is the ball's top, or the body's centre, under the still surface.
    const r = b.zorbed ? b.zorb.radius : 0
    b.teleport({ x: spot.x - 12, y: depth === 'bob' ? spot.surface : spot.surface - depth - r, z: spot.z }, Math.PI / 2)
    b.body.setLinvel({ x: forward, y: up, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    const V = s.game.camera.position.constructor
    s.camera.setCinematicPose(new V(spot.x - 4, spot.surface + 5, spot.z + 22), new V(spot.x - 4, spot.surface + 1.5, spot.z))
    window.__fx = fx
    return { entries: fx.spray.sim?.entries ?? 0, exits: fx.spray.sim?.exits ?? 0 }
  }, { spot, depth, forward, up })
  if (before.error) { errors.push(`${tag}: ${before.error}`); await page.close(); continue }
  if (depth === 'shore') {
    // Let the world at the beach arrive, then start the tow.
    await page.waitForTimeout(2500)
    Object.assign(before, await page.evaluate(() => { const { dx, dz, forward } = window.__shore; window.syn3h.player.body.setLinvel({ x: dx * forward, y: 0, z: dz * forward }, true); window.__towing = true; const sim = window.__fx.spray.sim; return { entries: sim?.entries ?? 0, exits: sim?.exits ?? 0 } }))
  }
  const trace = []
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/${tag}-${String(i).padStart(2, '0')}.png` })
    trace.push({ frame: i, ...await page.evaluate((before) => { const s = window.syn3h, b = s.player, sim = window.__fx.spray.sim, p = (b.zorbed && b.zorb.collider ? b.zorb.collider : b.body).translation(); return { y: +(p.y - s.terrain.liquidHeightAt(p.x, p.z)).toFixed(2), vy: +b.body.linvel().y.toFixed(1), entries: (sim?.entries ?? 0) - before.entries, exits: (sim?.exits ?? 0) - before.exits } }, before) })
  }
  const after = await page.evaluate(() => { const sim = window.__fx.spray.sim; return { entries: sim?.entries ?? 0, exits: sim?.exits ?? 0, droplets: sim?.dropletCount ?? 0 } })
  notes.push({ tag, entries: after.entries - before.entries, exits: after.exits - before.exits, droplets: after.droplets, trace })
  await page.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes${phone ? '-phone' : ''}.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ errors, scenes: notes.map(n => `${n.tag}: in ${n.entries} out ${n.exits}`) }))
process.exit(errors.length ? 1 : 0)
