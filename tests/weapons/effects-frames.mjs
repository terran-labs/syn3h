// Frames of every gear effect as it is today (and after each change), for the weapons
// beautification pass: Plasma Tag on grass, on water and on a vehicle, and its beam; Plasma
// Thunder's charge, bolt and detonation; the Chaser; the Grapple; the Yoink gust. Each moment
// is a short run of stills stamped with the time since the trigger. Evidence, not a test: it
// asserts only that each trigger ran.
//
//   SYN3H_URL=http://127.0.0.1:<port>/ [SYN3H_VIEW=phone] tools/heavy.sh node tests/weapons/effects-frames.mjs [out dir] [world]
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/weapons-beauty/frames'
const world = process.argv[3] ?? 'alpine'
assert.ok(process.env.SYN3H_URL, 'SYN3H_URL is required')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], done = []
const stamp = (page, text) => page.evaluate(text => { let s = document.getElementById('fx-stamp'); if (!s) { s = document.createElement('div'); s.id = 'fx-stamp'; s.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;font:600 15px/1.3 ui-monospace,monospace;color:#fff;background:rgb(0 0 0 / .6);padding:5px 8px;border-radius:6px;white-space:pre'; document.body.append(s) } s.textContent = text }, text)
try {
  // SYN3H_VIEW=phone for a phone (390 x 844, touch), else a 1280 x 800 desktop.
  const page = await browser.newPage(process.env.SYN3H_VIEW === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?room=fx-frames-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.locator(`.galaxy-label[data-world="${world}"]`).dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended, null, { timeout: 90000 })
  await page.evaluate(() => document.exitPointerLock?.())
  await page.evaluate(() => {
    const s = window.syn3h, p = s.params
    p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    p.set('bigRed.cooldown', 0.3); p.set('yoink.cooldown', 0)
    // A camera this script places: looking at `__look` from `__eye`, both relative to the player.
    s.game.add({ update() {
      const look = window.__look, eye = window.__eye
      if (!look || !eye) return
      const at = s.player.object.position.clone().add(s.player.object.position.clone().set(...look))
      s.game.camera.position.copy(s.player.object.position).add(s.player.object.position.clone().set(...eye))
      s.game.camera.lookAt(at); s.game.camera.updateMatrixWorld()
    } })
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 30000 })
  await page.waitForTimeout(3000)
  /** Park the player and the bot (8 m ahead), still, a little above the ground. */
  const park = () => page.evaluate(() => {
    const s = window.syn3h, a = s.player.body.translation()
    const y = Math.max(s.terrain.heightAt(a.x, a.z), s.terrain.heightAt(a.x, a.z - 8)) + 1.5
    for (const [v, dz] of [[s.player, 0], [s.bots.vehicles[0], -8]]) {
      v.teleport(s.player.object.position.clone().set(a.x, y, a.z + dz), 0)
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  })
  /** Run `trigger` in the page, then take stills as fast as the browser allows for `ms`. */
  const moment = async (name, eye, look, trigger, ms = 900, keep = 6) => {
    await park(); await page.waitForTimeout(600)
    await page.evaluate(([eye, look]) => { window.__eye = eye; window.__look = look }, [eye, look])
    await page.waitForTimeout(400)
    const t0 = Date.now()
    await page.evaluate(trigger)
    const shots = []
    while (Date.now() - t0 < ms) {
      const t = Date.now() - t0
      await stamp(page, `${name}\nt = ${t} ms`)
      shots.push({ t, buf: await page.screenshot() })
    }
    // Keep `keep` of them, spread through the run.
    const pick = shots.length <= keep ? shots : Array.from({ length: keep }, (_, i) => shots[Math.round(i * (shots.length - 1) / (keep - 1))])
    const { writeFile } = await import('node:fs/promises')
    for (const s of pick) await writeFile(`${out}/${name}-${String(s.t).padStart(4, '0')}ms.png`, s.buf)
    done.push(`${name}: ${shots.length} stills, kept ${pick.length}`)
  }
  // Plasma Tag into the grass in front: impact sparks and ring.
  await moment('tag-ground', [6, 4, 6], [0, 0, -6], () => window.syn3hNet.fire([0, -0.55, -0.83]))
  // Plasma Tag in flight, slowed so the beam is seen.
  await page.evaluate(() => window.syn3h.params.set('laser.speed', 25))
  await moment('tag-beam', [10, 5, 4], [0, 1, -10], () => window.syn3hNet.fire([0, 0.02, -1]), 700, 4)
  await page.evaluate(() => window.syn3h.params.set('laser.speed', 180))
  // Plasma Tag on the bot 8 m ahead.
  await moment('tag-vehicle', [6, 3, 2], [0, 0.5, -8], () => window.syn3hNet.fire([0, 0, -1]))
  // Plasma Thunder: the charge at the nose, held full.
  await moment('thunder-charge', [4, 2.5, -4], [0, 1.5, -1], () => { const b = window.syn3hNet.bigRed; window.syn3hNet.gear.select?.('red'); b.charge = 1 }, 500, 2)
  await page.evaluate(() => { window.syn3hNet.bigRed.reset() })
  // Plasma Thunder in flight (slowed) and into the ground.
  await page.evaluate(() => window.syn3h.params.set('bigRed.speed', 25))
  await moment('thunder-bolt', [12, 6, 4], [0, 1, -12], () => window.syn3hNet.fire([0.2, 0.02, -1], undefined, 'red'), 700, 4)
  await page.evaluate(() => window.syn3h.params.set('bigRed.speed', 110))
  await moment('thunder-ground', [14, 9, 10], [0, 0, -10], () => window.syn3hNet.fire([0.5, -0.35, -0.8], undefined, 'red'), 1200, 6)
  // The Chaser after the bot.
  await moment('chaser', [8, 5, 4], [0, 1, -5], () => window.syn3hNet.launchPester(0xff00), 1500, 5)
  // The Grapple, thrown ahead.
  await moment('grapple', [8, 6, 8], [0, 0, -10], () => window.syn3hNet.bungee.launch(), 1500, 4)
  await page.evaluate(() => window.syn3hNet.bungee.reset?.())
  // The Yoink gust (nothing in the cone: aim the bot away first).
  await page.evaluate(() => { const b = window.syn3h.bots.vehicles[0]; b.teleport(b.object.position.clone().setX(b.object.position.x + 40), 0) })
  await moment('yoink-gust', [5, 3, 4], [0, 1, -3], () => { window.syn3hNet.gear.select?.('yoink'); window.syn3hNet.yoink.press() }, 600, 4)
} finally {
  await browser.close()
}
console.log(done.join('\n'))
if (errors.length) console.log('page errors:', errors.slice(0, 5))
