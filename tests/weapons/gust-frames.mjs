/**
 * The Yoink gust from the chase camera (evidence, not a test): the player gusts with nothing in
 * the cone, at noon and at night. The camera is held at the chase pose (6 m behind, 2.6 m up)
 * and the gear's clocks (the lasers' effects and the Yoink's rings) are held and stepped by hand.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/weapons/gust-frames.mjs <label> [out dir]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/gust'
await mkdir(out, { recursive: true })
const AGES = [0.03, 0.08, 0.15, 0.22, 0.3]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const hour of [12, 22]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(side => { window.__side = side }, process.env.SYN3H_VIEW === 'side')
    await page.goto(`${base}?planet=${process.env.SYN3H_PLANET ?? 'alpine'}&seed=7&autoplay=1&room=gust-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.yoink && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => {
      document.exitPointerLock?.()
      const s = window.syn3h, q = s.params
      q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.count', 0); q.set('daydream.seconds', 0); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour); q.set('yoink.cooldown', 0)
      for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden'
      const v = s.player, f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      v.teleport(v.object.position.clone(), Math.atan2(-f.x, -f.z))
      const o = v.object.position.clone()
      // SYN3H_VIEW=side: 12 m to the side of the ring (2 m ahead of the car), looking at it.
      const side = window.__side, rx = -f.z, rz = f.x, ring = o.clone().set(o.x + f.x * 2, o.y + 1, o.z + f.z * 2)
      const eye = side ? ring.clone().set(ring.x + rx * 12, ring.y + 2, ring.z + rz * 12) : o.clone().set(o.x - f.x * 6, o.y + 2.6, o.z - f.z * 6)
      const look = side ? ring : o.clone().set(o.x + f.x * 12, o.y + 1, o.z + f.z * 12)
      s.game.add({ update() { s.game.camera.position.copy(eye); s.game.camera.lookAt(look); s.game.camera.updateMatrixWorld() } })
      const L = window.syn3hNet.lasers, Y = window.syn3hNet.yoink, lu = L.update.bind(L), yu = Y.update.bind(Y)
      window.__freeze = on => { L.update = on ? () => {} : lu; Y.update = on ? () => {} : yu }
      window.__step = dt => { for (let t = 0; t < dt - 1e-6; t += 1 / 120) { const k = Math.min(1 / 120, dt - t); lu(k, 1); yu(k, 1) } }
    }, hour)
    await page.waitForTimeout(3000)
    await page.evaluate(() => { window.__freeze(true); window.syn3hNet.gear.select?.('yoink') })
    const kind = await page.evaluate(() => window.syn3hNet.yoink.press())
    let at = 0
    for (const age of AGES) {
      await page.evaluate(dt => window.__step(dt), age - at); at = age
      await page.waitForTimeout(120)
      await writeFile(`${out}/gust-${process.env.SYN3H_VIEW ?? 'chase'}-${process.env.SYN3H_PLANET ?? 'alpine'}-${hour}-${label}-${String(Math.round(age * 1000)).padStart(4, '0')}ms.png`, await page.screenshot())
    }
    report.push(`${hour}: ${kind}${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`)
    await ctx.close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
