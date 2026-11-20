/**
 * Strips of the Grapple's release effects, for judging the look (evidence, not a test): a cord
 * to the bot let go (released), the same cord severed, and a hook that misses and sails away.
 * Time is held while each frame is taken: the Bungee's drawing is frozen and stepped by hand.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/grapple-release-strips.mjs [out dir]
 *
 * Writes <out>/<effect>.png, one row of frames each, and <out>/raw/. Fails on a page error, or
 * if an effect never started.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL')
const out = process.argv[2] ?? '/tmp/weapons-beauty/grapple-strips'
await mkdir(`${out}/raw`, { recursive: true })
const EFFECTS = {
  released: [0, 0.08, 0.18, 0.3, 0.45, 0.65],
  severed: [0, 0.08, 0.18, 0.3, 0.45, 0.65],
  sail: [0, 0.2, 0.45, 0.7, 0.95, 1.2],
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // Offline: no room, so nothing but this script lets a cord go.
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=grapple-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.bungee, null, { timeout: 120000 })
  await page.evaluate(() => {
    document.exitPointerLock?.()
    const s = window.syn3h, p = s.params
    p.set('gfx.auto', false); p.set('gfx.level', 2); p.set('daydream.seconds', 0)
    p.set('sun.dayLength', 0); p.set('sun.timeOfDay', 15)
    p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    p.set('bungee.hookSpeed', 40); p.set('bungee.cooldown', 0)
    for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
    s.shell.closeMenu?.()
    const B = window.syn3hNet.bungee, update = B.update.bind(B)
    window.__freeze = on => { B.update = on ? () => {} : update }
    window.__step = seconds => { for (let t = 0; t < seconds - 1e-6; t += 1 / 120) update(Math.min(1 / 120, seconds - t)) }
    s.game.add({ update() {
      const c = window.__cam
      if (!c) return
      s.game.camera.position.set(...c.eye); s.game.camera.lookAt(...c.look); s.game.camera.updateMatrixWorld()
    } })
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 60000 })
  // The player on the ground, the bot 24 m ahead and 8 m up, both held still; the camera off to
  // the side of the pair, looking at the middle.
  const place = () => page.evaluate(() => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
    window.__f ??= [f.x, f.z]
    const [fx, fz] = window.__f, heading = Math.atan2(-fx, -fz)
    const bx = p.x + fx * 24, bz = p.z + fz * 24
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(bx, bz)) + 1.5
    for (const [v, x, z, h] of [[s.player, p.x, p.z, y], [bot, bx, bz, y + 8]]) {
      v.teleport(s.player.object.position.clone().set(x, h, z), heading)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    const mx = (p.x + bx) / 2, mz = (p.z + bz) / 2, my = y + 5
    window.__cam = { eye: [mx + fz * 26, my + 4, mz - fx * 26], look: [mx, my, mz] }
  })
  for (const [effect, times] of Object.entries(EFFECTS)) {
    await page.evaluate(() => window.__freeze(false))
    await place(); await page.waitForTimeout(1500); await place(); await page.waitForTimeout(500)
    if (effect === 'sail') {
      // A short cord shot up and away from the bot: it reaches full length without catching.
      await page.evaluate(() => {
        window.syn3h.params.set('bungee.length', 30)
        const n = window.syn3hNet, [fx, fz] = window.__f
        n.gear.select('bungee')
        n.bungee.launch([-fx * 0.4, 0.9, -fz * 0.4])
      })
      await page.waitForFunction(() => window.syn3hNet.bungee.fading.includes('sail'), null, { timeout: 5000, polling: 'raf' })
      await page.evaluate(() => window.__freeze(true))
    } else {
      await page.evaluate(() => {
        window.syn3h.params.set('bungee.length', 120)
        const s = window.syn3h, n = window.syn3hNet, a = s.player.body.translation(), b = s.bots.vehicles[0].body.translation()
        n.gear.select('bungee')
        n.bungee.launch([b.x - a.x, b.y - a.y - 1.1, b.z - a.z])
      })
      await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 })
      await page.waitForTimeout(1200)
      await page.evaluate(effect => { window.__freeze(true); window.syn3hNet.bungee.letGo(effect) }, effect)
    }
    const started = await page.evaluate(() => window.syn3hNet.bungee.fading)
    if (!started.length) throw new Error(`${effect}: no release effect started`)
    let at = 0
    for (const [i, time] of times.entries()) {
      await page.evaluate(dt => window.__step(dt), time - at); at = time
      await page.waitForTimeout(150)
      await writeFile(`${out}/raw/${effect}-${i}.png`, await page.screenshot())
    }
    await page.evaluate(() => window.__step(3))
    report.push(`${effect}: ${started.join(',')} captured`)
  }
  await page.evaluate(() => window.__freeze(false))
  // One sheet per effect: a row of frames.
  for (const [effect, times] of Object.entries(EFFECTS)) {
    const imgs = await Promise.all(times.map(async (t, i) => `<figure><img src="data:image/png;base64,${(await readFile(`${out}/raw/${effect}-${i}.png`)).toString('base64')}"><figcaption>${t} s</figcaption></figure>`))
    const sheet = await browser.newPage({ viewport: { width: 1900, height: 300 } })
    await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">Grapple ${effect}</h3><div style="display:flex">${imgs.join('')}</div><style>figure{margin:3px}img{width:310px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    await sheet.screenshot({ path: `${out}/${effect}.png`, fullPage: true })
    await sheet.close()
  }
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 3).join(' | ')}`)
  console.log(report.join('\n'))
  console.log('GRAPPLE STRIPS OK')
} finally { await browser.close() }
