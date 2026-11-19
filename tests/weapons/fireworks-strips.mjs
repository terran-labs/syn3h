// Strips of Plasma Thunder's fireworks, one per shape, as a player parked 60 m off sees them:
// the star shell climbing, the burst, and its fall, six full-screen frames across 3.2 s. At noon
// and at night. Evidence for judging the look, not a test. The same rig as impact-strips.mjs: a
// fixed world, offline, the clock held, the fireworks' own clock frozen and stepped by hand, and a
// camera the script places.
//
//   SYN3H_URL=http://127.0.0.1:<port>/ [SYN3H_VIEW=phone] tools/heavy.sh node tests/weapons/fireworks-strips.mjs [out dir]
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/weapons-beauty/fireworks'
assert.ok(process.env.SYN3H_URL, 'SYN3H_URL is required')
await mkdir(`${out}/raw`, { recursive: true })
const phone = process.env.SYN3H_VIEW === 'phone', size = phone ? 'phone' : 'desktop'
const TIMES = [0.5, 1.0, 1.4, 1.9, 2.5, 3.2]
const SHAPES = ['peony', 'chrysanthemum', 'ring', 'willow', 'palm', 'crossette']
const HOURS = { noon: 12, night: 22 }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=fireworks-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.lasers?.fireworks, null, { timeout: 120000 })
  await page.evaluate(() => {
    document.exitPointerLock?.()
    const s = window.syn3h, p = s.params
    p.set('gfx.auto', false); p.set('gfx.level', 2); p.set('daydream.seconds', 0)
    s.bots.remote = false; p.set('bots.count', 0)
    p.set('sun.dayLength', 0)
    for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
    s.shell.closeMenu?.()
    const F = window.syn3hNet.lasers.fireworks, update = F.update.bind(F)
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
    await page.evaluate(hour => window.syn3h.params.set('sun.timeOfDay', hour), hour)
    await page.waitForTimeout(3000)
    for (const [seed, shape] of SHAPES.entries()) {
      // A detonation on the ground 60 m ahead of the car; the camera behind the car, looking up at
      // where the shell will burst (flareHeight up).
      await page.evaluate(seed => {
        const s = window.syn3h, t = s.terrain, o = s.player.object.position
        const f = o.clone().set(0, 0, -1).applyQuaternion(s.player.object.quaternion).setY(0).normalize()
        const at = o.clone().addScaledVector(f, 60); at.y = t.heightAt(at.x, at.z) + 0.3
        const climb = s.params.get('thunder.flareHeight')?.value ?? 40
        const eye = o.clone().addScaledVector(f, -6).setY(o.y + 3)
        window.__cam = { eye: eye.toArray(), look: at.clone().setY(at.y + climb * 0.55).toArray() }
        window.__burst = { at: at.toArray(), climb, ground: at.y - 0.3, seed }
      }, seed)
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        window.__freeze(true)
        const T = window.syn3h.player.object.position.constructor, b = window.__burst
        window.syn3hNet.lasers.fireworks.burst({ at: new T(...b.at), climb: b.climb, ground: b.ground, colors: [{ r: 0.9, g: 0.08, b: 0.05 }, { r: 1, g: 0.75, b: 0.3 }], seed: b.seed })
      })
      let at = 0
      for (const [i, time] of TIMES.entries()) {
        await page.evaluate(dt => window.__step(dt), time - at); at = time
        await page.waitForTimeout(150)
        await writeFile(`${out}/raw/${size}-${when}-${shape}-${i}.png`, await page.screenshot())
      }
      await page.evaluate(() => { window.__step(3); window.__freeze(false) })
      report.push(`${size} ${when} ${shape}: captured`)
    }
  }
  if (errors.length) report.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)
  // One image per time of day: a row per shape.
  const { readFileSync } = await import('node:fs')
  for (const when of Object.keys(HOURS)) {
    const w = phone ? 130 : 280
    const rows = SHAPES.map(shape => `<div style="display:flex;align-items:center"><b style="width:110px;padding-left:8px">${shape}</b>${TIMES.map((t, i) => `<figure><img src="data:image/png;base64,${readFileSync(`${out}/raw/${size}-${when}-${shape}-${i}.png`).toString('base64')}"><figcaption>${t} s</figcaption></figure>`).join('')}</div>`).join('')
    await writeFile(`${out}/raw/strip.html`, `<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">${size} fireworks, ${when}</h3>${rows}<style>figure{margin:3px}img{width:${w}px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    const sheet = await browser.newPage({ viewport: { width: 1900, height: 800 } })
    await sheet.goto(`file://${out}/raw/strip.html`); await sheet.waitForTimeout(300)
    await sheet.screenshot({ path: `${out}/${size}-${when}.png`, fullPage: true }); await sheet.close()
  }
} finally {
  await browser.close()
}
console.log(report.join('\n'))
