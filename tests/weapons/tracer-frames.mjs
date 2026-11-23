/**
 * Plasma Tag in flight from the chase camera (evidence for judging the look, not a test), at noon
 * and at night, connected to a room so this page is the host and its bots can fire:
 *   one shot: the player fires past three bots 25 to 35 m ahead, slowed to 25 m/s
 *     (laser.speed) so several stills catch it in flight;
 *   crossing: a bot fires across the view at another, at normal speed, its time held and stepped;
 *   three at once: the three bots fire Plasma Tag at the player together, twice, at normal speed.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/tracer-frames.mjs <label> [out dir]
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.MIRA_URL) throw new Error('Set MIRA_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/tracer'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
async function run(page, name, trigger, ms, keep) {
  const t0 = Date.now(); await page.evaluate(trigger)
  const shots = []
  while (Date.now() - t0 < ms) shots.push({ t: Date.now() - t0, buf: await page.screenshot() })
  const pick = shots.length <= keep ? shots : Array.from({ length: keep }, (_, i) => shots[Math.round(i * (shots.length - 1) / (keep - 1))])
  for (const s of pick) await writeFile(`${out}/${name}-${label}-${String(s.t).padStart(4, '0')}ms.png`, s.buf)
  report.push(`${name}: ${shots.length} stills`)
}
try {
  for (const hour of [12, 22]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=tracer-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.connected && window.mira.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => { document.exitPointerLock?.(); const s = window.mira, q = s.params; q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.canDrive', false); q.set('bots.canFire', false); q.set('bots.count', 3); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour); q.set('daydream.seconds', 0); for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden' }, hour)
    await page.waitForFunction(() => window.mira.bots.vehicles.length === 3, null, { timeout: 90000 })
    // A Plasma Tag shot from bot i along d, straight through the lasers (the bots' own firing
    // picks its targets and holds fire while another bot has just shot, so it cannot be aimed).
    await page.evaluate(() => { window.__tag = (i, d) => { const n = window.miraNet, b = window.mira.bots.vehicles[i]; const shot = n.lasers.aim(b.body, n.clock.now()); shot.d = d; n.lasers.spawn(0xff00 + i, shot); return true } })
    await page.waitForTimeout(3000)
    const place = () => page.evaluate(() => {
      const s = window.mira, v = s.player, a = v.body.translation()
      const f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
      window.__f ??= [f.x, f.z]; const [fx, fz] = window.__f, rx = -fz, rz = fx
      v.teleport(v.object.position.clone().set(a.x, s.terrain.heightAt(a.x, a.z) + 1, a.z), Math.atan2(-fx, -fz)); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      s.bots.vehicles.forEach((b, i) => {
        const ahead = 25 + i * 5, side = (i - 1) * 9, bx = a.x + fx * ahead + rx * side, bz = a.z + fz * ahead + rz * side
        b.teleport(v.object.position.clone().set(bx, s.terrain.heightAt(bx, bz) + 1, bz), Math.atan2(fx, fz)); b.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      })
    })
    await place(); await page.waitForTimeout(2500); await place(); await page.waitForTimeout(800)
    // Crossing: the left bot fires across the view at the right one, 18 m apart and 25 to 35 m
    // ahead, which is how other players' shots are seen. The beams' clock is held and stepped by
    // hand, so each still is at a known age however slow the screenshots are.
    // The camera held where the chase camera sits, 6 m behind the car and 2.6 m up, looking at the
    // middle bot, so nothing earlier (a knock, a swing) can turn the view away.
    await page.evaluate(() => {
      const s = window.mira, [fx, fz] = window.__f, o = s.player.object.position, m = s.bots.vehicles[1].object.position
      const eye = o.clone().set(o.x - fx * 6, o.y + 2.6, o.z - fz * 6), look = m.clone()
      window.__hold = s.game.add({ update() { s.game.camera.position.copy(eye); s.game.camera.lookAt(look); s.game.camera.updateMatrixWorld() } })
    })
    await page.evaluate(() => {
      const L = window.miraNet.lasers, update = L.update.bind(L)
      window.__step = dt => { for (let t = 0; t < dt - 1e-6; t += 1 / 120) update(Math.min(1 / 120, dt - t), 1) }
      L.update = () => {}
      const s = window.mira, n = window.miraNet, [a, , c] = s.bots.vehicles
      const d = c.object.position.clone().sub(a.object.position).normalize()
      window.__crossOk = window.__tag(0, [d.x, d.y + 0.02, d.z])
    })
    for (const [i, age] of [0.02, 0.08, 0.14, 0.2, 0.26].entries()) {
      await page.evaluate(dt => window.__step(dt), i === 0 ? age : 0.06)
      await page.waitForTimeout(100)
      await writeFile(`${out}/cross-${hour}-${label}-${String(Math.round(age * 1000)).padStart(4, '0')}ms.png`, await page.screenshot())
    }
    report.push(`cross-${hour}: fired ${await page.evaluate(() => window.__crossOk)}`)
    await page.evaluate(() => { const L = window.miraNet.lasers; delete L.update; window.mira.game.remove(window.__hold, false) })
    await page.waitForTimeout(1500); await place(); await page.waitForTimeout(800)
    await page.evaluate(() => window.mira.params.set('laser.speed', 25))
    await run(page, `one-${hour}`, () => { const [fx, fz] = window.__f; window.miraNet.gear.select?.('beam'); window.miraNet.fire([fx * 0.97 - fz * 0.12, 0.04, fz * 0.97 + fx * 0.12]) }, 2200, 8)
    await page.evaluate(() => window.mira.params.set('laser.speed', 180))
    await page.waitForTimeout(1500); await place(); await page.waitForTimeout(800)
    await run(page, `three-${hour}`, () => {
      const s = window.mira, n = window.miraNet, me = s.player.object.position
      const volley = () => s.bots.vehicles.forEach((b, i) => { const d = me.clone().setY(me.y + 0.6).sub(b.object.position).normalize(); window.__tag(i, [d.x, d.y, d.z]) })
      volley(); setTimeout(volley, 300)
    }, 900, 6)
    if (errors.length) report.push(`${hour} page errors: ${errors.slice(0, 2).join(' | ')}`)
    await page.context().close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
