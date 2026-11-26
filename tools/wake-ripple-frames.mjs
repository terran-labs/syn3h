/**
 * The wake behind a moving craft, before and after (src/world/water/spray.ts: water.wakeRipple,
 * water.wakeRippleWidth, water.wakeFoamWidth, water.wakeFoamLife), at the same instant on the
 * same sea. Production build:
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh npm run build
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/wake-ripple-frames.mjs <output directory> [width=2 life=2]
 *
 * Archipelago 4 at 14:00, High, no bots, interface hidden, offline, so the swell runs on the
 * game's own clock (seaWaves.ts waterTime). Each run is a fresh page: the vehicle waits held 30 m
 * over open water, is dropped onto it at physics tick LAUNCH heading along 200 m of deep water,
 * is towed at a constant horizontal speed (the water still lifts and drops it) and the game is
 * paused 4 s later, so every run shows the same swell at the same moment. Two views of that frozen
 * frame: a high three-quarter from behind (12 m up, 20 m back, looking down the trail at the
 * vehicle) and top down from 40 m over the trail. Looks: before (strength 1, 1.5 m, foam at its
 * old width and life) and after (today's defaults, or the foam width and life given).
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/wake-ripple/frames'
const opt = Object.fromEntries(process.argv.slice(3).filter(a => a.includes('=')).map(a => a.split('=')).map(([k, v]) => [k, Number(v)]))
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []
/** Physics tick of the drop (50 s of game time), and of the frozen frame 4 s later. */
const LAUNCH = 3000, HOLD = 240
const RUNS = [['buggy', 16], ['hovercraft', 20]]
const LOOKS = [['before', { 'water.wakeRipple': 1, 'water.wakeRippleWidth': 1.5, 'water.wakeFoamWidth': 1, 'water.wakeFoamLife': 1 }],
  ['after', { ...(opt.width ? { 'water.wakeFoamWidth': opt.width } : {}), ...(opt.life ? { 'water.wakeFoamLife': opt.life } : {}) }]]

for (const [vehicle, speed] of RUNS) for (const [look, set] of LOOKS) {
  const tag = `${vehicle}-${look}`
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=${vehicle}&world=archipelago.4`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3h.game.tick > 60, null, { timeout: 120000 })
  await page.evaluate(() => { const q = window.syn3h.game.quality; q.setAuto(false); q.manualChange = (_l, apply) => apply(); q.setLevel(3) })
  await page.waitForFunction(() => window.syn3h.game.quality.governor.level === 3 && !document.querySelector('.quality-change-veil'), null, { timeout: 90000 })
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
  const ready = await page.evaluate(({ set, LAUNCH, HOLD, speed }) => {
    const s = window.syn3h, t = s.terrain, sp = t.spawnPoint(0).position, game = s.game
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 14); s.params.set('sun.dayLength', 0)
    for (const [k, v] of Object.entries(set)) s.params.set(k, v)
    const deep = (x, z) => t.liquidKindAt?.(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 8
    let spot = null
    for (let r = 30; r < 3000 && !spot; r += 15) for (let a = 0; a < 64 && !spot; a++) {
      const ang = a / 64 * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
      if (!deep(x, z)) continue
      for (let k = 0; k < 8 && !spot; k++) {
        const hd = k / 8 * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
        let ok = true
        for (let d = -40; d <= 200 && ok; d += 10) ok = deep(x + dx * d, z + dz * d)
        if (ok) spot = { x, z, hd, dx, dz }
      }
    }
    if (!spot) return { error: 'no open water' }
    const b = s.player, V = game.camera.position.constructor
    // Held over the spot, clear of the water, until the drop.
    b.teleport({ x: spot.x, y: t.liquidHeightAt(spot.x, spot.z) + 30, z: spot.z }, spot.hd); b.body.setBodyType(2, true)
    s.camera.setCinematicPose(new V(spot.x - spot.dx * 20, t.liquidHeightAt(spot.x, spot.z) + 12, spot.z - spot.dz * 20), new V(spot.x, t.liquidHeightAt(spot.x, spot.z), spot.z))
    const cam = new V(), at = new V()
    window.__wake = { spot, done: false, launched: null }
    game.add({
      fixedUpdate() {
        if (game.tick === LAUNCH - 1) {
          b.body.setBodyType(0, true)
          b.teleport({ x: spot.x, y: t.liquidHeightAt(spot.x, spot.z) + 0.6, z: spot.z }, spot.hd)
          b.body.setLinvel({ x: spot.dx * speed, y: 0, z: spot.dz * speed }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          window.__wake.launched = game.tick
        }
        // Towed: horizontal speed held, the water free to lift and drop it.
        if (window.__wake.launched !== null && !window.__wake.done) { const v = b.body.linvel(); b.body.setLinvel({ x: spot.dx * speed, y: v.y, z: spot.dz * speed }, true) }
      },
      update() {
        if (window.__wake.launched === null) return
        const p = b.body.translation(), w = t.liquidHeightAt(p.x, p.z)
        cam.set(p.x - spot.dx * 20, w + 12, p.z - spot.dz * 20); at.set(p.x, w, p.z)
        s.camera.setCinematicPose(cam, at)
        if (game.tick >= LAUNCH + HOLD && !window.__wake.done) { window.__wake.done = true; window.__wake.tick = game.tick; window.__wake.time = game.time; game.pause() }
      },
    }, 'wake frames')
    return { tick: game.tick, spot, params: Object.fromEntries(['water.wakeRipple', 'water.wakeRippleWidth', 'water.wakeFoamWidth', 'water.wakeFoamLife'].map(k => [k, s.params.get(k).value])) }
  }, { set, LAUNCH, HOLD, speed })
  if (ready.error || ready.tick >= LAUNCH - 60) { errors.push(`${tag}: ${ready.error ?? `ready only at tick ${ready.tick}`}`); await page.close(); continue }
  await page.waitForFunction(() => window.__wake?.done, null, { timeout: 180000, polling: 100 })
  // The frozen frame, from each view: the game camera placed directly and the paused frame redrawn.
  const state = {}
  for (const view of ['three-quarter', 'top']) {
    Object.assign(state, await page.evaluate((view) => {
      const s = window.syn3h, { spot } = window.__wake, cam = s.game.camera, p = s.player.body.translation(), w = s.terrain.liquidHeightAt(p.x, p.z)
      if (view === 'top') { cam.position.set(p.x - spot.dx * 12, w + 40, p.z - spot.dz * 12 + .01); cam.lookAt(p.x - spot.dx * 12, w, p.z - spot.dz * 12) }
      else { cam.position.set(p.x - spot.dx * 20, w + 12, p.z - spot.dz * 20); cam.lookAt(p.x, w, p.z) }
      cam.updateMatrixWorld(); s.game.redrawPaused()
      return { tick: window.__wake.tick, time: +window.__wake.time.toFixed(3), gap: +(p.y - w).toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2) }
    }, view))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${vehicle}-${view}-${look}.png` })
  }
  notes.push({ tag, params: ready.params, frozen: state })
  await page.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ errors, frozen: notes.map(n => `${n.tag}: tick ${n.frozen.tick} time ${n.frozen.time} at ${n.frozen.x},${n.frozen.z}`) }))
process.exit(errors.length ? 1 : 0)
