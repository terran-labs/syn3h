/**
 * Plasma Thunder bursting on the player's own car, as the chase camera sees it (evidence, not a
 * test): one burst, three bursts a quarter second apart, and one 800 m off for comparison, at
 * night and at noon. The camera is held at the chase pose (6 m behind the car, 2.6 m up); the
 * bursts' clock is held and stepped by hand, so each still is at a known age.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/close-burst-frames.mjs <label> [out dir]
 *   then: python3 <sat.py> <out dir>   (per frame: share near white, share veiled, and share brighter
 *   than the same view just before the burst by 40 or more, which counts pale coverage too)
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.MIRA_URL) throw new Error('Set MIRA_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/close-burst'
await mkdir(out, { recursive: true })
const AGES = [0.05, 0.15, 0.3, 0.5, 0.8, 1.2]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const hour of [22, 12]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=burst-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.lasers && window.mira.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => {
      document.exitPointerLock?.()
      const s = window.mira, q = s.params
      q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.count', 0); q.set('daydream.seconds', 0); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour)
      for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden'
      const v = s.player, f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
      window.__f = [f.x, f.z]
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      const o = v.object.position.clone()
      window.__eye = o.clone().set(o.x - f.x * 6, o.y + 2.6, o.z - f.z * 6); window.__look = o.clone().set(o.x + f.x * 10, o.y + 1, o.z + f.z * 10)
      s.game.add({ update() { if (!window.__eye) return; s.game.camera.position.copy(window.__eye); s.game.camera.lookAt(window.__look); s.game.camera.updateMatrixWorld() } })
      const L = window.miraNet.lasers, update = L.update.bind(L)
      window.__freeze = on => { L.update = on ? () => {} : update }
      window.__step = dt => { for (let t = 0; t < dt - 1e-6; t += 1 / 120) update(Math.min(1 / 120, dt - t), 1) }
      let shot = 500000
      // A Thunder burst at a point, as a contact on a vehicle bursts (no climb, no push).
      window.__burst = (x, y, z) => L.burst(0xff00, shot++, o.clone().set(x, y, z), o.clone().set(0, 1, 0), 'contact', false)
    }, hour)
    await page.waitForTimeout(3000)
    for (const scene of ['one', 'three', 'far']) {
      await page.evaluate(() => window.__freeze(true))
      if (scene === 'far') await page.evaluate(() => { const [fx, fz] = window.__f, e = window.__eye; window.__look = e.clone().set(e.x + fx * 800, e.y + 60, e.z + fz * 800) })
      // The same view just before the burst: the baseline for counting what the burst brightens.
      await page.waitForTimeout(150)
      await writeFile(`${out}/${scene}-${hour}-${label}-pre.png`, await page.screenshot())
      await page.evaluate(scene => {
        const o = window.mira.player.object.position, [fx, fz] = window.__f
        if (scene === 'far') window.__burst(o.x + fx * 800, window.mira.terrain.heightAt(o.x + fx * 800, o.z + fz * 800) + 60, o.z + fz * 800)
        else window.__burst(o.x, o.y + 1, o.z)
      }, scene)
      let at = 0, next = 0.25, extra = scene === 'three' ? 2 : 0
      for (const [i, age] of (scene === 'far' ? [0.3, 0.8, 1.5] : AGES).entries()) {
        // The other two of three go off a quarter second apart, a metre or two off the car.
        while (extra > 0 && next <= age) {
          await page.evaluate(dt => window.__step(dt), next - at); at = next
          await page.evaluate(k => { const o = window.mira.player.object.position; window.__burst(o.x + (k === 2 ? 1.5 : -1.5), o.y + 1.2, o.z + 1) }, extra)
          extra--; next += 0.25
        }
        await page.evaluate(dt => window.__step(dt), age - at); at = age
        await page.waitForTimeout(120)
        await writeFile(`${out}/${scene}-${hour}-${label}-${String(Math.round(age * 1000)).padStart(4, '0')}ms.png`, await page.screenshot())
      }
      await page.evaluate(() => { window.__step(4); window.__freeze(false) })
      if (scene === 'far') await page.evaluate(() => { const o = window.mira.player.object.position, [fx, fz] = window.__f; window.__look = o.clone().set(o.x + fx * 10, o.y + 1, o.z + fz * 10) })
      await page.waitForTimeout(1500)
    }
    report.push(`${hour}: done${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`)
    await ctx.close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
