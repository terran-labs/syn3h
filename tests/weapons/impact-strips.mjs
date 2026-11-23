// Strips of gear impacts as a player sees them: the normal chase camera, six frames across the
// first 400 ms, for Plasma Tag and Plasma Thunder, on grass, sand, rock, water and a vehicle.
// Evidence for judging the look, run against any build (an old one beside a new one), not a test.
//
// For each surface it finds a patch of that ground near the player, parks the car 12 m off
// facing it, freezes the impact effects' clocks, fires, and from the moment the shot lands steps
// those clocks through the six ages, one still each, while the world goes on around them.
//
//   MIRA_URL=http://127.0.0.1:<port>/ [MIRA_VIEW=phone] [MIRA_HOUR=22] [MIRA_FULL=1] [MIRA_BOT_AHEAD=30] tools/heavy.sh node tests/weapons/impact-strips.mjs <label> [out dir]
//   then: node tests/weapons/impact-strips.mjs --compose <out dir> <old label> <new label>   (one image per strip, old above new)
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

if (process.argv[2] === '--compose') {
  const [dir, oldLabel, newLabel] = process.argv.slice(3)
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(dir).filter(f => f.endsWith('.png'))
  const strips = [...new Set(files.map(f => f.split('-').slice(0, 3).join('-')))]
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1900, height: 800 } })
  await mkdir(`${dir}/../strips`, { recursive: true })
  for (const strip of strips) {
    const row = lab => [0, 1, 2, 3, 4, 5].map(i => `${dir}/${strip}-${lab}-${i}.png`)
    const ages = ['20', '80', '150', '220', '300', '400']
    const cell = (src, i) => `<figure><img src="file://${src}"><figcaption>${ages[i]} ms</figcaption></figure>`
    // A page in a file beside the frames: one set from a string cannot load files.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${dir}/strip.html`, `<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">${strip}</h3>${[oldLabel, newLabel].filter(Boolean).map(lab => `<div style="display:flex;align-items:center"><b style="width:60px;padding-left:8px">${lab}</b>${row(lab).map(cell).join('')}</div>`).join('')}<style>figure{margin:3px}img{width:${strip.startsWith('phone') ? 200 : 300}px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    await page.goto(`file://${dir}/strip.html`)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${dir}/../strips/${strip}.png`, fullPage: true })
  }
  await browser.close()
  console.log(`${strips.length} strips in ${dir}/../strips`)
  process.exit(0)
}
const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
const label = process.argv[2] ?? 'build', out = process.argv[3] ?? '/tmp/weapons-beauty/strips/raw'
assert.ok(process.env.MIRA_URL, 'MIRA_URL is required')
await mkdir(out, { recursive: true })
const phone = process.env.MIRA_VIEW === 'phone', size = phone ? 'phone' : 'desktop'
const AGES = [0.02, 0.08, 0.15, 0.22, 0.3, 0.4]
// MIRA_HOUR=22 for night (default noon); MIRA_FULL=1 for the whole screen instead of a crop.
const HOUR = Number(process.env.MIRA_HOUR ?? 12), FULL = !!process.env.MIRA_FULL
// MIRA_BOT_AHEAD: metres from the car to the bot it shoots (default 12; the camera is 6 m further back).
const AHEAD = Number(process.env.MIRA_BOT_AHEAD ?? 12)
// MIRA_SURFACES=vehicle,grass for a few of them.
const SURFACES = process.env.MIRA_SURFACES ? process.env.MIRA_SURFACES.split(',') : ['grass', 'sand', 'rock', 'water', 'vehicle']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } })
  // Offline: the room would set its own time of day (and other world settings) back over noon.
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  await page.addInitScript(([hour, ahead]) => { window.__hour = hour; window.__ahead = ahead }, [HOUR, AHEAD])
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  // The same world in every build (a fixed planet and seed), so both stand in the same places.
  await page.goto(`${base}?planet=${process.env.MIRA_PLANET ?? "alpine"}&seed=7&autoplay=1&room=strips-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.lasers, null, { timeout: 120000 })
  await page.evaluate(() => {
    document.exitPointerLock?.()
    const s = window.mira, p = s.params
    p.set('gfx.auto', false); p.set('gfx.level', 2); p.set('daydream.seconds', 0)
    // Offline, this client simulates the bots itself (as tools/frame-profile.mjs does).
    s.bots.remote = false
    p.set('bots.count', 1); p.set('bots.canDrive', false); p.set('bots.canFire', false)
    p.set('bigRed.cooldown', 0.3)
    // Noon, held, in every build; no interface in the frames.
    p.set('sun.dayLength', 0); p.set('sun.timeOfDay', window.__hour)
    for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
    s.shell.closeMenu?.()
    // The impact effects of either build: frozen while a strip is taken, stepped by hand.
    const L = window.miraNet.lasers, world = s.game.systems.find(x => x.constructor?.name === 'EffectWorld')
    window.__fx = [L.fx, L.pulses, world].filter(Boolean).map(sys => ({ sys, update: sys.update.bind(sys) }))
    window.__freeze = on => {
      for (const f of window.__fx) f.sys.update = on ? () => {} : f.update
      // The player's car held still too, so a blast beside it cannot throw it (and the camera).
      const b = window.mira.player.body; b.lockTranslations(on, true); b.lockRotations(on, true)
      if (on) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true) }
    }
    // For the vehicle strips, a camera this script places (absolute `__cam` eye and look): the
    // chase camera settles side on often enough that the bot hides behind the car.
    s.game.add({ update() {
      const c = window.__cam
      if (!c) return
      s.game.camera.position.set(...c.eye); s.game.camera.lookAt(...c.look); s.game.camera.updateMatrixWorld()
    } })
    window.__step = seconds => { for (let t = 0; t < seconds - 1e-6; t += 1 / 120) for (const f of window.__fx) f.update(Math.min(1 / 120, seconds - t)) }
  })
  await page.waitForFunction(() => window.mira.bots.vehicles.length === 1, null, { timeout: 30000 })
  await page.waitForTimeout(2000)
  for (const surface of SURFACES) {
    if (surface === 'vehicle') await page.waitForFunction(() => window.mira.bots.vehicles.length > 0, null, { timeout: 30000 }).catch(() => {})
    // Find the ground, park 12 m off it, facing it.
    const placed = await page.evaluate(surface => {
      const s = window.mira, t = s.terrain, me = s.player.object.position, bot = s.bots.vehicles[0]
      const land = (x, z) => !((t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z) - 0.2)
      const flat = (x, z) => t.normalAt(x, z, me.clone()).y > 0.85
      const fits = (x, z) => surface === 'water' ? (t.liquidKindAt?.(x, z) === 'water' && (t.liquidHeightAt(x, z) - t.heightAt(x, z)) > 1)
        : surface === 'vehicle' ? land(x, z) && flat(x, z)
        : land(x, z) && (surface === 'rock' || flat(x, z)) && t.surfaceAt?.(x, z) === surface
      let target = null
      for (let r = 20; r < 1500 && !target; r += 20) for (let i = 0; i < 36 && !target; i++) {
        const a = i / 36 * Math.PI * 2, x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r
        if (fits(x, z)) target = { x, z }
      }
      if (!target) return null
      // Stand on that ground (for water, on the shore 8 m off, facing it), so the chase camera,
      // once settled, looks across it.
      let stand = target, heading = 0
      if (surface === 'water') {
        stand = null
        for (let i = 0; i < 24 && !stand; i++) {
          const a = i / 24 * Math.PI * 2
          for (let d = 6; d <= 30 && !stand; d += 3) { const x = target.x + Math.cos(a) * d, z = target.z + Math.sin(a) * d; if (land(x, z) && flat(x, z)) stand = { x, z } }
        }
        if (!stand) return null
        heading = Math.atan2(-(target.x - stand.x), -(target.z - stand.z))
      }
      s.player.teleport(me.clone().set(stand.x, t.heightAt(stand.x, stand.z) + 1, stand.z), heading)
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      if (surface !== 'vehicle') bot?.teleport(me.clone().set(stand.x + 300, t.heightAt(stand.x + 300, stand.z) + 1, stand.z), 0)
      return { surface }
    }, surface)
    if (!placed) { report.push(`${surface}: no ground of that kind found`); continue }
    // Noon again: the clock is held, but the room's own setting can come back between strips.
    await page.evaluate(() => { window.mira.params.set('sun.dayLength', 0); window.mira.params.set('sun.timeOfDay', window.__hour) })
    await page.waitForTimeout(5000)
    // The target: where a ray from the camera, right of centre and low on the screen, meets the
    // ground or the water. In view by construction, beside the car rather than behind it.
    const aimed = await page.evaluate(([surface, phone]) => {
      const s = window.mira, t = s.terrain, cam = s.game.camera, o = s.player.object.position
      const dir = o.clone().set(0.35, -0.3, 0.5).unproject(cam).sub(cam.position).normalize()
      const p = cam.position.clone()
      for (let i = 0; i < 400; i++) {
        p.addScaledVector(dir, 0.5)
        const floor = Math.max(t.heightAt(p.x, p.z), t.liquidHeightAt?.(p.x, p.z) ?? -Infinity)
        if (p.y <= floor) break
      }
      const bot = s.bots.vehicles[0]
      if (surface === 'vehicle' && bot) {
        // The bot 12 m ahead of the car and 3 m right; the camera behind the car's left
        // shoulder, as a chase camera would sit, so the bot shows clear of the car on any screen.
        const f = o.clone().set(0, 0, -1).applyQuaternion(s.player.object.quaternion).setY(0).normalize(), right = o.clone().set(-f.z, 0, f.x)
        p.copy(o).addScaledVector(f, window.__ahead).addScaledVector(right, 3)
        p.y = t.heightAt(p.x, p.z) + 1
        const eye = o.clone().addScaledVector(f, -6).addScaledVector(right, phone ? -1 : -2.5).setY(o.y + 2.6)
        const look = o.clone().lerp(p, 0.7)
        window.__cam = { eye: eye.toArray(), look: look.toArray() }
        bot.teleport(p.clone(), Math.atan2(-right.x, -right.z)); bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true); bot.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        p.y += 0.3
      }
      window.__target = { x: p.x, y: p.y, z: p.z }
      const wet = (t.liquidHeightAt?.(p.x, p.z) ?? -Infinity) > t.heightAt(p.x, p.z)
      return wet ? t.liquidKindAt?.(p.x, p.z) : t.surfaceAt?.(p.x, p.z)
    }, [surface, phone])
    placed.found = aimed
    if (surface === 'vehicle') await page.waitForTimeout(1200)
    for (const weapon of ['tag', 'thunder']) {
      await page.evaluate(() => { window.__freeze(true); window.__shots = window.miraNet.lasers.impacted.size })
      await page.evaluate(weapon => {
        const s = window.mira, o = s.player.object.position, T = window.__target
        const from = o.clone().setY(o.y + 1), d = o.clone().set(T.x, T.y, T.z).sub(from).normalize()
        window.miraNet.fire([d.x, d.y, d.z], undefined, weapon === 'thunder' ? 'red' : undefined)
      }, weapon)
      const landed = await page.waitForFunction(() => window.miraNet.lasers.impacted.size > window.__shots, null, { timeout: 3000 }).then(() => true, () => false)
      let at = 0
      // A crop around where the shot struck, the same size in every frame.
      const clip = await page.evaluate(phone => {
        const s = window.mira, T = window.__target, v = s.player.object.position.clone().set(T.x, T.y, T.z).project(s.game.camera)
        const w = phone ? 300 : 560, h = phone ? 360 : 350, x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight
        return { x: Math.max(0, Math.min(innerWidth - w, x - w / 2)), y: Math.max(0, Math.min(innerHeight - h, y - h * 0.6)), width: w, height: h }
      }, phone)
      for (const [i, age] of AGES.entries()) {
        await page.evaluate(dt => window.__step(dt), age - at); at = age
        await page.waitForTimeout(120)
        await page.screenshot({ path: `${out}/${size}-${weapon}-${surface}-${label}-${i}.png`, ...(FULL ? {} : { clip }) })
      }
      await page.evaluate(() => { window.__step(1.5); window.__freeze(false) })
      report.push(`${surface} (${placed.found}) ${weapon}: ${landed ? 'landed' : 'no impact seen'}`)
      await page.waitForTimeout(1500)
    }
    await page.evaluate(() => { window.__cam = null })
  }
  if (errors.length) report.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)
} finally {
  await browser.close()
}
console.log(report.join('\n'))
