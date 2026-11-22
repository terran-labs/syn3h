/**
 * The Chaser from the chase camera (evidence, not a test), connected to a room so this page is
 * the host: the player sends one at a bot 15 m ahead and 4 m to the side, at noon and at night.
 * Stills in flight every 0.4 s or so, then, the moment it catches, its effects are held and
 * stepped by hand for the arrival.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/chaser-frames.mjs <label> [out dir]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/chaser'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const hour of [12, 22]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    await page.addInitScript(side => { window.__side = side }, process.env.SYN3H_VIEW === 'side')
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=chaser-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.connected && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => { document.exitPointerLock?.(); const s = window.syn3h, q = s.params; q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.canDrive', false); q.set('bots.canFire', false); q.set('bots.count', 1); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour); q.set('daydream.seconds', 0); for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden' }, hour)
    await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 90000 })
    await page.waitForTimeout(3000)
    await page.evaluate(() => {
      const s = window.syn3h, v = s.player, a = v.body.translation()
      const f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
      const rx = -f.z, rz = f.x
      const hold = (veh, x, z, up) => { veh.teleport(v.object.position.clone().set(x, s.terrain.heightAt(x, z) + up, z), Math.atan2(-f.x, -f.z)); veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true); veh.body.setAngvel({ x: 0, y: 0, z: 0 }, true); veh.body.setGravityScale(0, true) }
      hold(v, a.x, a.z, 1)
      const bx = a.x + f.x * 15 + rx * 4, bz = a.z + f.z * 15 + rz * 4
      hold(s.bots.vehicles[0], bx, bz, 1.5)
      const o = v.object.position
      // SYN3H_VIEW=side: 18 m to the side of the path's middle, looking at it, so the orb is seen
      // in flight rather than behind your own roof.
      const mid = o.clone().set(o.x + f.x * 7.5 + rx * 2, o.y + 3, o.z + f.z * 7.5 + rz * 2)
      const eye = window.__side ? mid.clone().set(mid.x - rx * 18, mid.y + 2, mid.z - rz * 18) : o.clone().set(o.x - f.x * 6, o.y + 2.6, o.z - f.z * 6)
      const look = window.__side ? mid : o.clone().set(o.x + f.x * 25, o.y + 3, o.z + f.z * 25)
      s.game.add({ update() { s.game.camera.position.copy(eye); s.game.camera.lookAt(look); s.game.camera.updateMatrixWorld() } })
      // The moment a Chaser ends, hold every effect (the impact flashes and the cloud).
      const L = window.syn3hNet.lasers, P = window.syn3hNet.pesters, lu = L.update.bind(L), pu = P.update.bind(P)
      window.__step = dt => { for (let t = 0; t < dt - 1e-6; t += 1 / 120) { lu(Math.min(1 / 120, dt - t), 1); pu(Math.min(1 / 120, dt - t), 1) } }
      const pop = L.fx.pop?.bind(L.fx)
      window.__popped = false
      const hook = P.hooks.onBurst
      P.hooks.onBurst = at => { hook?.(at); window.__popped = true; L.update = () => {}; P.update = () => {} }
    })
    await page.waitForTimeout(1500)
    const t0 = Date.now()
    const launched = await page.evaluate(() => { window.syn3hNet.gear.select?.('pester'); return window.syn3hNet.launchPester(0xff00) })
    let i = 0
    while (Date.now() - t0 < 15000 && !(await page.evaluate(() => window.__popped))) {
      await writeFile(`${out}/flight-${process.env.SYN3H_VIEW ?? 'chase'}-${hour}-${label}-${String(Date.now() - t0).padStart(4, '0')}ms.png`, await page.screenshot()); i++
      await page.waitForTimeout(250)
    }
    const popped = await page.evaluate(() => window.__popped)
    if (popped) {
      let at = 0
      for (const age of [0.02, 0.1, 0.2, 0.35, 0.6]) {
        await page.evaluate(dt => window.__step(dt), age - at); at = age
        await page.waitForTimeout(100)
        await writeFile(`${out}/arrive-${process.env.SYN3H_VIEW ?? 'chase'}-${hour}-${label}-${String(Math.round(age * 1000)).padStart(4, '0')}ms.png`, await page.screenshot())
      }
    }
    report.push(`${hour}: launched ${launched}, ${i} flight stills, ${popped ? 'caught' : 'NOT caught in 15 s'}${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`)
    await page.context().close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
