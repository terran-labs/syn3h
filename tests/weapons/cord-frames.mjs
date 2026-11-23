/**
 * The Grapple's cord as a player sees it from behind their car (evidence, not a test), connected
 * to a room so this page is the host and its bots can grapple too:
 *   one cord: the player's, to a bot 20 m ahead and 7 m to the side (about 29 m from the camera);
 *   against the sky: the same with the bot held 9 m up;
 *   three cords: the player's to a bot 40 m out, and two bots' to each other and to the ground.
 * At noon on alpine grass (sky behind), at noon on ice (snow), and at night on alpine. The camera
 * is held where the chase camera sits, 6 m behind and 2.6 m above the car.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/cord-frames.mjs <label> [out dir]
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.MIRA_URL) throw new Error('Set MIRA_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/cord'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const [planet, hour] of [['alpine', 12], ['ice', 12], ['alpine', 22]]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?planet=${planet}&seed=7&autoplay=1&room=cord-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.connected && window.mira.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => { document.exitPointerLock?.(); const s = window.mira, q = s.params; q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.canDrive', false); q.set('bots.canFire', false); q.set('bots.count', 3); q.set('bungee.cooldown', 0); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour); q.set('daydream.seconds', 0); for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden' }, hour)
    await page.waitForFunction(() => window.mira.bots.vehicles.length === 3, null, { timeout: 90000 })
    await page.waitForTimeout(3000)
    // Player still; bots at (ahead, side): A (20, 7), B (30, -8), C (40, 2). All held in the air a little.
    const place = () => page.evaluate(() => {
      const s = window.mira, v = s.player, a = v.body.translation()
      const f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
      window.__f ??= [f.x, f.z]; const [fx, fz] = window.__f, rx = -fz, rz = fx
      const hold = (veh, x, z, up) => { veh.teleport(v.object.position.clone().set(x, s.terrain.heightAt(x, z) + up, z), Math.atan2(-fx, -fz)); veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true); veh.body.setAngvel({ x: 0, y: 0, z: 0 }, true); veh.body.setGravityScale(0, true) }
      hold(v, a.x, a.z, 1)
      ;[[20, 7], [30, -8], [40, 2]].forEach(([ahead, side], i) => hold(s.bots.vehicles[i], a.x + fx * ahead + rx * side, a.z + fz * ahead + rz * side, 1.5))
      const o = v.object.position, m = s.bots.vehicles[0].object.position
      const eye = o.clone().set(o.x - fx * 6, o.y + 2.6, o.z - fz * 6), look = o.clone().set(o.x + fx * 25, o.y + 1, o.z + fz * 25)
      if (!window.__hold) window.__hold = s.game.add({ update() { s.game.camera.position.copy(window.__eye); s.game.camera.lookAt(window.__look); s.game.camera.updateMatrixWorld() } })
      window.__eye = eye; window.__look = look
    })
    await place(); await page.waitForTimeout(2500); await place(); await page.waitForTimeout(500)
    const launch = (from, to) => page.evaluate(([from, to]) => {
      const s = window.mira, n = window.miraNet
      const shooter = from < 0 ? s.player : s.bots.vehicles[from]
      // A bot's gear is made on its first gear action; make it here the same way.
      let gear = null
      if (from >= 0) { const id = 0xff00 + from; gear = n.botGear.get(id); if (!gear) { n.sendBot(id, shooter); gear = n.makeBotGear(id, shooter); n.botGear.set(id, gear) } }
      const B = from < 0 ? n.bungee : gear?.bungee
      if (!B) return 'no bungee'
      if (from < 0) n.gear.select?.('bungee'); else gear.selected = 'bungee'
      const a = shooter.body.translation()
      const t = to === 'ground' ? { x: a.x + window.__f[0] * 8, y: s.terrain.heightAt(a.x + window.__f[0] * 8, a.z + window.__f[1] * 8), z: a.z + window.__f[1] * 8 } : s.bots.vehicles[to].body.translation()
      return B.launch([t.x - a.x, t.y - a.y - (to === 'ground' ? 0 : 1.1), t.z - a.z])
    }, [from, to])
    const attached = () => page.evaluate(() => [window.miraNet.bungee.attached, ...[0, 1].map(i => window.miraNet.botGear.get(0xff00 + i)?.bungee.attached)].map(Boolean))
    const one = await launch(-1, 0)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${out}/one-${planet}-${hour}-${label}.png` })
    const oneAttached = await attached()
    await page.evaluate(() => window.miraNet.bungee.letGo('released'))
    // Against the sky: the same bot held 9 m up, so the cord rises across the sky.
    await page.waitForTimeout(1500); await place()
    await page.evaluate(() => { const b = window.mira.bots.vehicles[0], p = b.object.position.clone(); p.y += 8; b.teleport(p, b.object.rotation.y); b.body.setLinvel({ x: 0, y: 0, z: 0 }, true) })
    await page.waitForTimeout(800)
    const sky = await launch(-1, 0)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${out}/sky-${planet}-${hour}-${label}.png` })
    report.push(`${planet} ${hour} sky: ${sky} ${JSON.stringify(await attached())}`)
    await page.evaluate(() => window.miraNet.bungee.letGo('released'))
    await page.waitForTimeout(1500); await place(); await page.waitForTimeout(800)
    const three = [await launch(-1, 2), await launch(0, 1), await launch(1, 'ground')]
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${out}/three-${planet}-${hour}-${label}.png` })
    report.push(`${planet} ${hour}: one ${one} ${JSON.stringify(oneAttached)}, three ${JSON.stringify(three)} ${JSON.stringify(await attached())}${errors.length ? ' errors: ' + errors.slice(0, 2).join(' | ') : ''}`)
    await page.context().close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
