/**
 * The drop from the lobby into a world must be one continuous camera move that ends in the
 * chase pose behind the player's vehicle: no cut, no orbit, no detour to a landmark.
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/core/descent-camera-browser.mjs OUT [planet,planet,...]
 *
 * Starts its own dev server and room server on free ports. For each planet, twice (tapped at
 * once from a fresh lobby, and again from the menu after playing), it records the camera's
 * position and direction, the vehicle, and who owns the camera, every frame from the tap to
 * ten seconds after landing. It fails when the camera stands away from the vehicle during the
 * descent, steps or turns further in a frame than the designed fall can, when the director or
 * the lobby's tour owns a frame of the drop, or when the camera does not end behind the
 * vehicle. Then, in play, it lets the vehicle drive itself and takes the controls back during
 * each director shot (orbit, fly-by, crane, low): the view must ease to the chase pose.
 * Headless frames here are slow and uneven, so bounds scale with each frame's own length.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const out = process.argv[2]; assert.ok(out, 'output directory required'); await mkdir(out, { recursive: true })
/** The fall's designed top speed with margin, metres per second; the fastest turn, degrees per second; how far from the vehicle the camera may stand during a descent, metres. */
export const MAX_FALL_SPEED = 900, MAX_TURN_RATE = 200, AWAY_METRES = 80
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const port = await freePort(), roomPort = await freePort()
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, SYN3H_ROOM_PORT: String(roomPort) }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; vite.stdout.on('data', d => log += d); vite.stderr.on('data', d => log += d)
const base = `http://127.0.0.1:${port}/`
for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break } catch {} if (i > 300) throw Error(`dev server did not start\n${log}`); await new Promise(r => setTimeout(r, 200)) }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = []
/** Runs in the page: sample every animation frame until told to stop. */
const record = () => {
  const w = window, s = w.syn3h, T = []; w.__trace = T; w.__stop = false
  const dir = s.game.camera.position.clone()
  const sampler = { update() {
    // Camera motion uses the frame-start clock. Work before this sampler varies, so
    // timestamping here would invent short intervals after an expensive frame.
    const now = s.game.last
    const cam = s.game.camera, c = s.camera, p = s.player.object.position, shell = document.querySelector('.syn3h-shell').classList
    cam.getWorldDirection(dir)
    const f = s.player.object.getWorldDirection(dir.clone())
    T.push({ at: now, cam: [cam.position.x, cam.position.y, cam.position.z], dir: [dir.x, dir.y, dir.z], fov: cam.fov, veh: [p.x, p.y, p.z], fwd: [-f.x, -f.y, -f.z],
      ground: s.terrain.heightAt(cam.position.x, cam.position.z), director: c.director.active, shot: c.director.shot, directed: c.directed, cinematic: !!c.cinematic, blend: !!c.blend,
      attract: s.shell.attracting, descending: shell.contains('is-descending'), playing: shell.contains('is-playing'), overlay: Number(getComputedStyle(document.querySelector('.lobby-overlay, .shell-overlay') ?? document.body).opacity),
      suspended: s.game.input.suspended, planet: s.planets.currentPlanet().id })
    if (w.__stop) s.game.remove(sampler)
  } }
  s.game.add(sampler)
}
try {
  const planets = process.argv[3]?.split(',') ?? ['desert', 'alpine', 'volcanic', 'archipelago', 'ice']
  const selected = process.env.DESCENT_CASES?.split(',')
  for (const planet of planets.filter(p => !selected || selected.includes(p))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
    page.on('pageerror', e => errors.push(e.message))
    try {
      await page.goto(`${base}?room=descent-${Date.now()}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
      const known = await page.evaluate(() => window.syn3h.planets.PLANETS.map(p => p.id))
      if (!known.includes(planet)) { results.push({ id: planet, skipped: `no such planet; known: ${known.join(',')}` }); continue }
      await page.waitForFunction(() => window.syn3h.shell.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 90000 })
      // First from a fresh lobby, then again from the menu after playing, to a different world.
      const again = planets[(planets.indexOf(planet) + 1) % planets.length]
      for (const [id, world] of [[`${planet}-from-lobby`, planet], [`${again}-from-menu-after-${planet}`, again]]) {
        if (id.includes('from-menu')) {
          await page.evaluate(() => window.syn3h.shell.openMenu('index'))
          await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.activePanel === 'index' && document.querySelector('.lobby-panels').dataset.busy === 'false', null, { timeout: 15000 })
          await page.waitForTimeout(1500)
        }
        await page.evaluate(record)
        const tapAt = await page.evaluate(() => performance.now())
        await page.locator(`.galaxy-label[data-world="${world}"]`).dispatchEvent('click')
        await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 5000 })
        await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 60000 })
        const landedAt = await page.evaluate(() => performance.now())
        await page.waitForTimeout(10000)
        const trace = await page.evaluate(() => { window.__stop = true; return window.__trace })
        await page.screenshot({ path: `${out}/${id}.png` })
        await writeFile(`${out}/${id}.trace.json`, JSON.stringify({ tapAt, landedAt, trace }))
        results.push({ id, errors: [...errors], ...judge(trace, tapAt, landedAt) })
      }
    } catch (error) { results.push({ id: planet, errors, harness: String(error) }) }
    await page.close()
  }
  if (!process.env.DESCENT_SKIP_HANDBACK) {
  // In play: the vehicle drives itself after two idle seconds; take the controls during each shot.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    await page.goto(`${base}?room=handback-${Date.now()}&autoplay=1&daydream=2`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && window.syn3h.shell.playing, null, { timeout: 120000 })
    for (const shot of ['orbit', 'flyby', 'crane', 'low']) {
      const reached = await page.waitForFunction(s => window.syn3h.camera.director.active && window.syn3h.camera.director.shot === s && window.syn3h.camera.directed, shot, { timeout: 90000 }).then(() => true, () => false)
      if (!reached) { results.push({ id: `handback-${shot}`, skipped: 'the director did not reach this shot in 90 s (a fly-by needs speed)' }); await page.keyboard.press('KeyC'); await page.waitForTimeout(500); continue }
      await page.evaluate(record)
      await page.waitForFunction(() => window.__trace.length > 0)
      const keyAt = await page.evaluate(() => performance.now())
      await page.keyboard.down('ShiftLeft')
      await page.waitForTimeout(2500)
      const trace = await page.evaluate(() => { window.__stop = true; return window.__trace })
      await page.keyboard.up('ShiftLeft')
      await writeFile(`${out}/handback-${shot}.trace.json`, JSON.stringify({ keyAt, trace }))
      results.push({ id: `handback-${shot}`, errors: [...errors], shotAtKey: trace.filter(f => f.at < keyAt).at(-1)?.shot, ...judgeHandback(trace, keyAt) })
    }
  } catch (error) { results.push({ id: 'handback', errors, harness: String(error) }) }
  await page.close()
  }
  if (process.env.DESCENT_SMOKE) {
    await browser.close()
    const smoke = await promisify(execFile)(process.execPath, ['tools/smoke.mjs', `${base}?room=descent-smoke-${Date.now()}`, `${out}/smoke.png`], { maxBuffer: 1000000 })
    console.log(smoke.stdout)
  }
} finally { await browser.close(); vite.kill('SIGTERM') }

/**
 * Pure reading of one trace, from the tap on. The descent is by design a fast fall, so speed is
 * not the test. A cut is: the camera standing away from the vehicle while the descent has it,
 * or a step in position or direction between two frames that the vehicle did not make itself
 * (a rebuilt world moves the vehicle and its camera together, under the galaxy's light).
 */
export function judge(trace, tapAt, landedAt) {
  const after = trace.filter(f => f.at >= tapAt)
  const lifted = after.findIndex(f => f.cinematic)
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
  let away = { frames: 0, ms: 0, worst: 0 }, worstStep = { metres: 0 }, worstTurn = { degrees: 0 }
  for (let i = Math.max(1, lifted + 1); i < after.length; i++) {
    const a = after[i - 1], b = after[i], vehicleMoved = Math.hypot(b.veh[0] - a.veh[0], b.veh[1] - a.veh[1], b.veh[2] - a.veh[2])
    if (b.cinematic && b.descending && flat(b.cam, b.veh) > AWAY_METRES) { away.frames++; away.ms += b.at - a.at; away.worst = Math.max(away.worst, Math.round(flat(b.cam, b.veh))) }
    if (vehicleMoved > 50) continue
    const step = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2]), dt = Math.max(1 / 240, (b.at - a.at) / 1000)
    const dot = Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2])), turn = Math.acos(dot) * 180 / Math.PI
    // Slow frames move further: allow the designed fall's top speed for the frame's own length.
    if (step - MAX_FALL_SPEED * dt > worstStep.metres) worstStep = { metres: Math.round(step - MAX_FALL_SPEED * dt), step: Math.round(step), atMs: Math.round(b.at - tapAt), dtMs: Math.round(dt * 1000) }
    if (turn - MAX_TURN_RATE * dt > worstTurn.degrees) worstTurn = { degrees: Math.round(turn - MAX_TURN_RATE * dt), turn: Math.round(turn), atMs: Math.round(b.at - tapAt), dtMs: Math.round(dt * 1000) }
  }
  away.ms = Math.round(away.ms)
  const directed = after.filter(f => f.descending && (f.directed || f.director)).length, attract = after.filter((f, i) => i > lifted && f.attract).length
  const end = trace.at(-1), back = [end.cam[0] - end.veh[0], end.cam[1] - end.veh[1], end.cam[2] - end.veh[2]], dist = Math.hypot(...back)
  const behind = -(back[0] * end.fwd[0] + back[2] * end.fwd[2]) / Math.max(1e-6, Math.hypot(back[0], back[2]))
  const looks = (end.veh[0] - end.cam[0]) * end.dir[0] + (end.veh[1] - end.cam[1]) * end.dir[1] + (end.veh[2] - end.cam[2]) * end.dir[2]
  return { frames: after.length, dropMs: Math.round(landedAt - tapAt), away, worstStep, worstTurn, directorFramesInDescent: directed, attractFrames: attract,
    end: { distance: +dist.toFixed(1), behind: +behind.toFixed(2), facingVehicle: looks > 0, cinematic: end.cinematic, shot: end.shot, vehicleY: +end.veh[1].toFixed(1) },
    pass: away.frames === 0 && worstStep.metres === 0 && worstTurn.degrees === 0 && directed === 0 && attract === 0 && dist < 40 && behind > 0.5 && looks > 0 && !end.cinematic }
}
/** The player takes the controls during a director shot: the view must ease to the chase pose, not cut. */
export function judgeHandback(trace, keyAt) {
  const after = trace.filter(f => f.at >= keyAt)
  let worst = { metres: 0 }, worstTurn = { degrees: 0 }
  for (let i = 1; i < after.length; i++) {
    const a = after[i - 1], b = after[i], dt = Math.max(1 / 240, (b.at - a.at) / 1000)
    const step = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2])
    const dot = Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2])), turn = Math.acos(dot) * 180 / Math.PI
    // A hand-back covers at most a few tens of metres in 0.8 s: 80 m/s and 250 degrees/s are generous.
    if (step - 80 * dt > worst.metres) worst = { metres: +(step - 80 * dt).toFixed(1), step: +step.toFixed(1), atMs: Math.round(b.at - keyAt), dtMs: Math.round(dt * 1000) }
    if (turn - 250 * dt > worstTurn.degrees) worstTurn = { degrees: Math.round(turn - 250 * dt), turn: Math.round(turn), atMs: Math.round(b.at - keyAt), dtMs: Math.round(dt * 1000) }
  }
  const end = after.at(-1), back = [end.cam[0] - end.veh[0], end.cam[2] - end.veh[2]]
  const behind = -(back[0] * end.fwd[0] + back[1] * end.fwd[2]) / Math.max(1e-6, Math.hypot(...back))
  return { frames: after.length, worstStep: worst, worstTurn, end: { behind: +behind.toFixed(2), cinematic: end.cinematic, director: end.director }, pass: worst.metres === 0 && worstTurn.degrees === 0 && !end.cinematic && !end.director }
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
for (const r of results) console.log(JSON.stringify(r))
process.exit(results.every(r => (r.pass || r.skipped) && !r.errors?.length) ? 0 : 1)
