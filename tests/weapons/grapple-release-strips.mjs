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
  released: [0.03, 0.1, 0.2, 0.32, 0.47, 0.65],
  severed: [0.03, 0.1, 0.2, 0.32, 0.47, 0.65],
  sail: [0.03, 0.25, 0.5, 0.75, 1, 1.2],
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // A fresh room of its own, so this page is the host and runs the bot (offline, the bot's
  // vehicle is not known to the network layer and a cord to it lets go at once).
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=grapple-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.connected && window.syn3hNet?.bungee, null, { timeout: 120000 })
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
    const letGo = B.letGo.bind(B); B.letGo = why => { (window.__letGo ??= []).push(`${why} ${new Error().stack.split('\n').slice(2, 6).join(' | ')}`); return letGo(why) }
    window.__freeze = on => { B.update = on ? () => {} : update }
    window.__step = seconds => { for (let t = 0; t < seconds - 1e-6; t += 1 / 120) update(Math.min(1 / 120, seconds - t)) }
    s.game.add({ update() {
      // Following a missed hook: from the side of its line of flight, on the hook in flight and
      // then on the middle of the loose cord as it sails, 22 m back and a little above.
      const fol = window.__follow
      if (fol) {
        const B = window.syn3hNet.bungee, rope = B.loose[0]?.cord, hook = B.mine?.hook
        const at = rope ? rope.pos[Math.floor(rope.pos.length / 2)] : hook ? hook.pos.clone().lerp(s.player.object.position, 0.4) : null
        if (at) window.__cam = { eye: [at.x - fol[0] * 22, at.y + 4, at.z - fol[1] * 22], look: [at.x, at.y, at.z] }
      }
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
    window.__cam = { eye: [mx + fz * 14, my + 2, mz - fx * 14], look: [mx, my, mz] }
  })
  for (const [effect, times] of Object.entries(EFFECTS)) {
    await page.evaluate(() => window.__freeze(false))
    await place(); await page.waitForTimeout(1500); await place(); await page.waitForTimeout(500)
    if (effect === 'sail') {
      // A short cord shot flat across open ground, at right angles to the bot (so it cannot
      // catch it), a little up: it reaches full length without catching. The camera follows it
      // from the side; one frame in flight, then the frames after it lets go.
      await page.evaluate(() => {
        window.syn3h.params.set('bungee.length', 30)
        const n = window.syn3hNet, [fx, fz] = window.__f
        window.__follow = [fx, fz]
        n.gear.select('bungee')
        n.bungee.launch([fz, 0.12, -fx])
      })
      await page.waitForFunction(() => (window.syn3hNet.bungee.mine?.hook?.travelled ?? 0) >= 18, null, { timeout: 5000, polling: 'raf' })
      await page.waitForTimeout(50)
      await writeFile(`${out}/raw/${effect}-before.png`, await page.screenshot())
      await page.waitForFunction(() => window.syn3hNet.bungee.fading.includes('sail'), null, { timeout: 5000, polling: 'raf' })
      await page.evaluate(() => window.__freeze(true))
    } else {
      await page.evaluate(() => {
        window.syn3h.params.set('bungee.length', 120)
        const s = window.syn3h, n = window.syn3hNet, a = s.player.body.translation(), b = s.bots.vehicles[0].body.translation()
        n.gear.select('bungee')
        return n.bungee.launch([b.x - a.x, b.y - a.y - 1.1, b.z - a.z])
      }).then(ok => { if (!ok) throw new Error(`${effect}: the hook did not launch`) })
      await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 }).catch(async e => {
        throw new Error(`${effect}: no cord to the bot: ${JSON.stringify(await page.evaluate(() => {
          const s = window.syn3h, n = window.syn3hNet
          return { stats: n.bungee.stats, me: s.player.body.translation(), bot: s.bots.vehicles[0]?.body.translation(), allowed: s.params.get('bungee.allowed')?.value, vehicles: s.params.get('bungee.vehicles')?.value, gear: n.gear.current, letGo: window.__letGo }
        }))}`)
      })
      await page.waitForTimeout(1200)
      await writeFile(`${out}/raw/${effect}-before.png`, await page.screenshot())
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
    const before = [`<figure><img src="data:image/png;base64,${(await readFile(`${out}/raw/${effect}-before.png`)).toString('base64')}"><figcaption>${effect === 'sail' ? 'in flight' : 'attached'}</figcaption></figure>`]
    const imgs = before.concat(await Promise.all(times.map(async (t, i) => `<figure><img src="data:image/png;base64,${(await readFile(`${out}/raw/${effect}-${i}.png`)).toString('base64')}"><figcaption>${t} s</figcaption></figure>`)))
    const sheet = await browser.newPage({ viewport: { width: 2240, height: 300 } })
    await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">Grapple ${effect}</h3><div style="display:flex">${imgs.join('')}</div><style>figure{margin:3px}img{width:310px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    await sheet.screenshot({ path: `${out}/${effect}.png`, fullPage: true })
    await sheet.close()
  }
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 3).join(' | ')}`)
  console.log(report.join('\n'))
  console.log('GRAPPLE STRIPS OK')
} finally { await browser.close() }
