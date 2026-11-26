/**
 * Skipping across water, in the browser: each vehicle's fast, shallow entry onto open sea as a
 * frame sequence from a camera held to the side (src/vehicles/skip.ts). Production build:
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh npm run build
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/water-skip-frames.mjs <output directory> [--phone]
 *
 * Serves dist/ from this checkout (and checks the port's listener is this process), offline.
 * Archipelago 4 at 14:00, High, no bots, interface hidden. For each vehicle: the first open water
 * over 8 m deep with 200 m of it ahead, out from the spawn; the vehicle put level 0.5 m over the
 * surface at about three times its planing speed (from the handling report), 10 degrees down;
 * the camera 25 m to the side and 6 m up, following along; a frame every quarter second for 6 s.
 * With --phone, only the buggy, at 844 by 390.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-skip/frames'
const phone = process.argv.includes('--phone')
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []
// About three times each vehicle's derived planing speed (tools/handling-report.ts), m/s.
// The tank is hidden in this build (src/vehicles/available.ts): asking for it gets the buggy. Its never-skips invariant is headless.
const RUNS = phone ? [['buggy', 31]] : [['buggy', 31], ['jet', 37], ['hovercraft', 40]]

for (const [vehicle, speed] of RUNS) {
  const page = await (await browser.newContext({ viewport: phone ? { width: 844, height: 390 } : { width: 1280, height: 720 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${vehicle}: ${e.message}`))
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
  const spot = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, sp = t.spawnPoint(0).position
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 14); s.params.set('sun.dayLength', 0);
    const deep = (x, z) => t.liquidKindAt?.(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 8
    for (let r = 30; r < 3000; r += 15) for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
      if (!deep(x, z)) continue
      for (let k = 0; k < 8; k++) {
        const hd = k / 8 * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
        let ok = true
        for (let d = 0; d <= 200 && ok; d += 10) ok = deep(x + dx * d, z + dz * d)
        if (ok) return { x, z, hd, surface: t.liquidHeightAt(x, z) }
      }
    }
    return null
  })
  if (!spot) { errors.push(`${vehicle}: no open water`); await page.close(); continue }
  // Out at the spot first and let the world there finish arriving (a jump of up to 3 km from the
  // spawn draws black for a second or so), then launch.
  await page.evaluate((spot) => {
    const s = window.syn3h, V = s.game.camera.position.constructor
    s.player.teleport({ x: spot.x, y: spot.surface + 1.5, z: spot.z }, spot.hd ?? 0)
    s.camera.setCinematicPose(new V(spot.x + 20, spot.surface + 6, spot.z + 20), new V(spot.x, spot.surface, spot.z))
  }, spot)
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.syn3h.camera.clearCinematicPose?.(0))
  await page.evaluate(({ spot, speed }) => {
    const s = window.syn3h, b = s.player, dx = -Math.sin(spot.hd), dz = -Math.cos(spot.hd), a = 10 * Math.PI / 180
    b.teleport({ x: spot.x, y: spot.surface + 1.5, z: spot.z }, spot.hd)
    b.body.setLinvel({ x: dx * speed * Math.cos(a), y: -speed * Math.sin(a), z: dz * speed * Math.cos(a) }, true)
    // Follow from the side, looking at where the vehicle is.
    const V = s.game.camera.position.constructor, cam = new V(), look = new V()
    window.__follow = setInterval(() => {
      const p = b.body.translation(), w = s.terrain.liquidHeightAt(p.x, p.z)
      cam.set(p.x - dz * 25, w + 6, p.z + dx * 25); look.set(p.x, w + 0.5, p.z)
      s.camera.setCinematicPose(cam, look)
    }, 16)
  }, { spot, speed })
  const trace = []
  for (let i = 0; i <= 24; i++) {
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${out}/${vehicle}${phone ? '-phone' : ''}-${String(i).padStart(2, '0')}.png` })
    trace.push(await page.evaluate(() => { const s = window.syn3h, p = s.player.body.translation(), v = s.player.body.linvel(); return { t: s.game.tick, gap: +(p.y - s.terrain.liquidHeightAt(p.x, p.z)).toFixed(2), speed: +Math.hypot(v.x, v.z).toFixed(1), skipping: +s.player.liquidState.skipping.toFixed(2) } }))
  }
  notes.push({ vehicle, spot, trace })
  await page.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes${phone ? '-phone' : ''}.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ errors, skips: notes.map((n) => ({ vehicle: n.vehicle, maxSkip: Math.max(...n.trace.map((s) => s.skipping)) })) }))
process.exit(errors.length ? 1 : 0)
