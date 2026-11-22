/**
 * Splashes on water (Archipelago) and lava (Volcanic), as a player sees them (evidence, not a
 * test): a Plasma Tag hit, a Plasma Thunder hit and the car dropping in from 4 m, each once from
 * the side (camera 10 m off and 3 m up, looking at the splash, so the car cannot hide it) and
 * once from the chase pose (6 m behind the car, 2.6 m up). Noon and night. For a hit, the shot
 * and the spray are held and stepped by hand (stills at 0.1 to 1.2 s); the drop runs in real time.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/weapons/splash-frames.mjs <label> [out dir]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/splash2'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const [planet, kind] of [['archipelago', 'water'], ['volcanic', 'lava']]) for (const hour of [12, 22]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?planet=${planet}&seed=7&autoplay=1&room=splash-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.lasers && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    const found = await page.evaluate(([hour, kind]) => {
      document.exitPointerLock?.()
      const s = window.syn3h, q = s.params, t = s.terrain, p = s.player.body.translation()
      q.set('gfx.auto', false); q.set('gfx.level', 2); q.set('bots.count', 0); q.set('daydream.seconds', 0); q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour); q.set('bigRed.cooldown', 0.1)
      for (const n of document.body.children) if (n.tagName !== 'CANVAS' && n.tagName !== 'SCRIPT') n.style.visibility = 'hidden'
      let best = null
      for (let r = 20; r < 1500 && !best; r += 20) for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
        if (t.liquidKindAt?.(x, z) === kind && (t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z) + 3) { best = { x, z, a }; break }
      }
      if (!best) return null
      let x = best.x, z = best.z
      for (let i = 0; i < 400; i++) { x -= Math.cos(best.a) * 0.5; z -= Math.sin(best.a) * 0.5; if ((t.liquidHeightAt?.(x, z) ?? -Infinity) < t.heightAt(x, z)) break }
      // The car 10 m back from the shore, facing the liquid; the splash point 10 m out from the shore.
      const fx = Math.cos(best.a), fz = Math.sin(best.a)
      const sx = x - fx * 10, sz = z - fz * 10, tx = x + fx * 10, tz = z + fz * 10
      window.__S = { car: [sx, t.heightAt(sx, sz) + 1, sz], target: [tx, t.liquidHeightAt(tx, tz), tz], f: [fx, fz] }
      const hold = () => { const v = s.player, [cx, cy, cz] = window.__S.car; v.teleport(v.object.position.clone().set(cx, cy, cz), Math.atan2(-fx, -fz)); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true) }
      window.__hold = hold; hold()
      const L = window.syn3hNet.lasers, W = s.game.systems.find(x => x.constructor?.name === 'WaterEffects')
      const lu = L.update.bind(L), wu = W.update.bind(W)
      window.__freeze = on => { L.update = on ? () => {} : lu; W.update = on ? () => {} : wu }
      window.__step = dt => { for (let t = 0; t < dt - 1e-6; t += 1 / 120) { const k = Math.min(1 / 120, dt - t); lu(k, 1); wu(k) } }
      // Held on the shore every frame for the hits (a hit's push, or a slope, used to move it into
      // the side view); released for the drop.
      window.__holdOn = true
      s.game.add({ update() { if (window.__holdOn) hold() } })
      s.game.add({ update() { const c = window.__cam; if (!c) return; s.game.camera.position.set(...c.eye); s.game.camera.lookAt(...c.look); s.game.camera.updateMatrixWorld() } })
      return true
    }, [hour, kind])
    if (!found) { report.push(`${planet} ${hour}: no ${kind} found`); await ctx.close(); continue }
    await page.waitForTimeout(3000)
    for (const view of ['side', 'chase']) for (const ev of ['tag', 'thunder', 'drop']) {
      await page.evaluate(([view, ev]) => {
        window.__hold()
        const { car, target, f } = window.__S, [fx, fz] = f
        const at = ev === 'drop' ? target : target
        window.__cam = view === 'side'
          ? { eye: [at[0] - fz * 10 - fx * 2, at[1] + 3, at[2] + fx * 10 - fz * 2], look: [at[0], at[1] + 1.5, at[2]] }
          : { eye: [car[0] - fx * 6, car[1] + 2.6, car[2] - fz * 6], look: [car[0] + fx * 14, car[1] + 0.5, car[2] + fz * 14] }
      }, [view, ev])
      await page.waitForTimeout(1500)
      const t0 = Date.now()
      await page.evaluate(ev => {
        const s = window.syn3h, n = window.syn3hNet, { target } = window.__S, o = s.player.object.position
        window.__holdOn = ev !== 'drop'
        if (ev === 'drop') {
          const v = s.player, [tx, ty, tz] = target, [fx, fz] = window.__S.f
          v.teleport(o.clone().set(tx - fx * 2, ty + 4, tz - fz * 2), Math.atan2(-fx, -fz)); v.body.setLinvel({ x: fx * 4, y: 0, z: fz * 4 }, true)
          if (window.__cam && window.__cam.eye && window.__chase) {}
        } else {
          window.__freeze(true)
          const from = o.clone().setY(o.y + 1), d = o.clone().set(...target).sub(from).normalize()
          n.fire([d.x, d.y, d.z], undefined, ev === 'thunder' ? 'red' : undefined)
        }
      }, ev)
      if (ev === 'drop') {
        // Physics carries the car in: real time, stills as fast as they come.
        const shots = []
        while (Date.now() - t0 < 2200) shots.push({ t: Date.now() - t0, buf: await page.screenshot() })
        const keep = 5, pick = shots.length <= keep ? shots : Array.from({ length: keep }, (_, i) => shots[Math.round(i * (shots.length - 1) / (keep - 1))])
        for (const s of pick) await writeFile(`${out}/${kind}-${hour}-${view}-${ev}-${label}-${String(s.t).padStart(4, '0')}ms.png`, s.buf)
      } else {
        // A hit: the shot, its impact and the spray are held and stepped by hand from the trigger,
        // so every still is at a known age however slow the screenshots are.
        let at = 0
        for (const age of [0.1, 0.25, 0.5, 0.8, 1.2]) {
          await page.evaluate(dt => window.__step(dt), age - at); at = age
          await page.waitForTimeout(100)
          await writeFile(`${out}/${kind}-${hour}-${view}-${ev}-${label}-${String(Math.round(age * 1000)).padStart(4, '0')}ms.png`, await page.screenshot())
        }
        await page.evaluate(() => window.__freeze(false))
      }
      await page.evaluate(() => { window.__holdOn = true })
      await page.waitForTimeout(2500)
    }
    report.push(`${planet} ${hour}: done${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`)
    await ctx.close()
  }
} finally { await browser.close() }
console.log(report.join('\n'))
