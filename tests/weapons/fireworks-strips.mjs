// Strips of Plasma Thunder's fireworks, one per shape, as a player parked 60 m off sees them:
// the star shell climbing, the burst, and its fall, six full-screen frames across 3.2 s. At noon
// and at night. Evidence for judging the look, not a test. The same rig as impact-strips.mjs: a
// fixed world, offline, the clock held, the fireworks' own clock frozen and stepped by hand, and a
// camera the script places.
//
//   MIRA_URL=http://127.0.0.1:<port>/ [MIRA_VIEW=phone] tools/heavy.sh node tests/weapons/fireworks-strips.mjs [out dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/weapons-beauty/fireworks'
assert.ok(process.env.MIRA_URL, 'MIRA_URL is required')
await mkdir(`${out}/raw`, { recursive: true })
const phone = process.env.MIRA_VIEW === 'phone', size = phone ? 'phone' : 'desktop'
const TIMES = [0.7, 1.45, 1.9, 2.5, 3.3, 4.5]
const SHAPES = ['peony', 'chrysanthemum', 'ring', 'willow', 'palm', 'crossette'].slice(0, Number(process.env.MIRA_SHAPES ?? 6))
// MIRA_HOURS=night for one of them.
const HOURS = Object.fromEntries(Object.entries({ noon: 12, night: 22 }).filter(([k]) => !process.env.MIRA_HOURS || process.env.MIRA_HOURS.split(',').includes(k)))
// MIRA_DISTANCES=60,300,800: metres from the camera to the burst's ground point (60: from behind the car).
const DISTANCES = (process.env.MIRA_DISTANCES ?? '60').split(',').map(Number)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=fireworks-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.lasers?.fireworks, null, { timeout: 120000 })
  await page.evaluate(() => {
    document.exitPointerLock?.()
    const s = window.mira, p = s.params
    p.set('gfx.auto', false); p.set('gfx.level', 2); p.set('daydream.seconds', 0)
    s.bots.remote = false; p.set('bots.count', 0)
    p.set('sun.dayLength', 0)
    for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
    s.shell.closeMenu?.()
    const F = window.miraNet.lasers.fireworks, update = F.update.bind(F)
    window.__freeze = on => { F.update = on ? () => {} : update }
    window.__step = seconds => { for (let t = 0; t < seconds - 1e-6; t += 1 / 120) update(Math.min(1 / 120, seconds - t)) }
    s.game.add({ update() {
      const c = window.__cam
      if (!c) return
      s.game.camera.position.set(...c.eye); s.game.camera.lookAt(...c.look); s.game.camera.updateMatrixWorld()
    } })
  })
  await page.waitForTimeout(3000)
  for (const [when, hour] of Object.entries(HOURS)) {
    await page.evaluate(hour => window.mira.params.set('sun.timeOfDay', hour), hour)
    await page.waitForTimeout(3000)
    for (const dist of DISTANCES) for (const [seed, shape] of SHAPES.entries()) {
      // A detonation on the ground 60 m ahead of the car; the camera behind the car, looking up at
      // where the shell will burst (flareHeight up).
      await page.evaluate(([seed, dist, ground]) => {
        const s = window.mira, t = s.terrain, o = s.player.object.position
        const f = o.clone().set(0, 0, -1).applyQuaternion(s.player.object.quaternion).setY(0).normalize()
        const at = o.clone().addScaledVector(f, 60); at.y = t.heightAt(at.x, at.z) + 0.3
        const climb = s.params.get('thunder.flareHeight')?.value ?? 40
        // A player `dist` m off on the ground, looking at the burst (from behind the car at 60 m).
        let eye = at.clone().addScaledVector(f, -dist); eye.y = Math.max(t.heightAt(eye.x, eye.z), dist <= 60 ? o.y : -Infinity) + 3
        // Farther off, a place on the ground with a clear view of the whole burst (its lower
        // edge, 60 m under the top, as well): the first heading round it that has one.
        if (dist > 60) {
          const clear = e => { for (let k = 1; k < 60; k++) { const q = e.clone().lerp(at.clone().setY(at.y + climb - 60), k / 60); if (t.heightAt(q.x, q.z) > q.y - 1) return false } return true }
          for (let i = 0; i < 72; i++) {
            const a = i / 72 * Math.PI * 2, e = at.clone().add(o.clone().set(Math.sin(a) * dist, 0, Math.cos(a) * dist)); e.y = t.heightAt(e.x, e.z) + 3
            if (clear(e)) { eye = e; break }
          }
        }
        window.__cam = { eye: eye.toArray(), look: at.clone().setY(at.y + climb).toArray() }
        // MIRA_GROUND=1: looking down at the ground under the burst instead, for its glow.
        if (ground) { const e = at.clone().addScaledVector(f, -dist); e.y = Math.max(t.heightAt(e.x, e.z), at.y) + 30; window.__cam = { eye: e.toArray(), look: at.toArray() } }
        window.__burst = { at: at.toArray(), climb, ground: at.y - 0.3, seed }
      }, [seed, dist, process.env.MIRA_GROUND === '1'])
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        window.__freeze(true)
        const T = window.mira.player.object.position.constructor, b = window.__burst
        window.miraNet.lasers.fireworks.burst({ at: new T(...b.at), climb: b.climb, ground: b.ground, colors: [{ r: 0.9, g: 0.08, b: 0.05 }, { r: 1, g: 0.75, b: 0.3 }], seed: b.seed, heightAt: (x, z) => window.mira.terrain.heightAt(x, z) })
      })
      let at = 0
      for (const [i, time] of TIMES.entries()) {
        await page.evaluate(dt => window.__step(dt), time - at); at = time
        await page.waitForTimeout(150)
        await writeFile(`${out}/raw/${size}-${dist}m-${when}-${shape}-${i}.png`, await page.screenshot())
      }
      await page.evaluate(() => { window.__step(3); window.__freeze(false) })
      report.push(`${size} ${dist} m ${when} ${shape}: captured`)
    }
  }
  if (errors.length) report.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)
  // One image per time of day: a row per shape.
  const { readFileSync } = await import('node:fs')
  for (const dist of DISTANCES) for (const when of Object.keys(HOURS)) {
    const w = phone ? 130 : 280
    const rows = SHAPES.map(shape => `<div style="display:flex;align-items:center"><b style="width:110px;padding-left:8px">${shape}</b>${TIMES.map((t, i) => `<figure><img src="data:image/png;base64,${readFileSync(`${out}/raw/${size}-${dist}m-${when}-${shape}-${i}.png`).toString('base64')}"><figcaption>${t} s</figcaption></figure>`).join('')}</div>`).join('')
    await writeFile(`${out}/raw/strip.html`, `<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">${size} fireworks from ${dist} m, ${when}</h3>${rows}<style>figure{margin:3px}img{width:${w}px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    const sheet = await browser.newPage({ viewport: { width: 1900, height: 800 } })
    await sheet.goto(`file://${out}/raw/strip.html`); await sheet.waitForTimeout(300)
    await sheet.screenshot({ path: `${out}/${size}-${dist}m-${when}.png`, fullPage: true }); await sheet.close()
  }
} finally {
  await browser.close()
}
console.log(report.join('\n'))
