/**
 * Frames of the gear and splash effects as a player sees them: the real chase camera, behind the
 * car, at noon and at night (evidence for judging the look, not a test). Each moment is a short
 * run of screenshots stamped with the time since its trigger.
 *
 *   alpine: the Chaser after a bot 20 m ahead (flight and arrival), the Grapple onto the bot (bite
 *           and cord), the Yoink gust, Plasma Tag and Plasma Thunder in flight;
 *   archipelago and volcanic: a Tag and a Thunder hit on the water or lava, and the car dropping
 *           into it from 4 m.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/effects-audit.mjs [out dir] [hours, e.g. 12,22]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const out = process.argv[2] ?? '/tmp/weapons-beauty/audit'
const HOURS = (process.argv[3] ?? '12,22').split(',').map(Number)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
const stamp = (page, text) => page.evaluate(text => { let s = document.getElementById('fx-stamp'); if (!s) { s = document.createElement('div'); s.id = 'fx-stamp'; s.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;font:600 15px/1.3 ui-monospace,monospace;color:#fff;background:rgb(0 0 0 / .6);padding:5px 8px;border-radius:6px;white-space:pre;visibility:visible'; document.documentElement.append(s) } s.textContent = text }, text)

async function open(planet, hour, bot) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=${planet}&seed=7&autoplay=1&room=audit-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet && window.syn3h.game.tick > 60, null, { timeout: 180000 })
  await page.evaluate(([hour, bot]) => {
    document.exitPointerLock?.()
    const s = window.syn3h, p = s.params
    p.set('gfx.auto', false); p.set('gfx.level', 2); p.set('daydream.seconds', 0)
    s.bots.remote = false
    p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', bot ? 1 : 0)
    p.set('bigRed.cooldown', 0.3); p.set('yoink.cooldown', 0); p.set('bungee.cooldown', 0)
    p.set('sun.dayLength', 0); p.set('sun.timeOfDay', hour)
    for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
  }, [hour, bot])
  if (bot) await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 60000 })
  await page.waitForTimeout(3000)
  return { context, page, errors }
}

/** Run `trigger` in the page, then take stills as fast as the browser allows for `ms`, keeping `keep`. */
async function moment(page, name, trigger, ms, keep = 6, arg) {
  const t0 = Date.now()
  const ok = await page.evaluate(trigger, arg)
  const shots = []
  while (Date.now() - t0 < ms) { const t = Date.now() - t0; await stamp(page, `${name}\nt = ${t} ms`); shots.push({ t, buf: await page.screenshot() }) }
  const pick = shots.length <= keep ? shots : Array.from({ length: keep }, (_, i) => shots[Math.round(i * (shots.length - 1) / (keep - 1))])
  for (const s of pick) await writeFile(`${out}/${name}-${String(s.t).padStart(4, '0')}ms.png`, s.buf)
  report.push(`${name}: ${ok === false ? 'TRIGGER FAILED, ' : ''}${shots.length} stills, kept ${pick.length}`)
}

/** The player still on the ground, facing along -z of its own heading; the bot `ahead` m in front, 1.5 m up. */
const park = (page, ahead) => page.evaluate(ahead => {
  const s = window.syn3h, v = s.player, a = v.body.translation()
  const f = s.game.camera.getWorldDirection(v.object.position.clone()); f.y = 0; f.normalize()
  window.__f = [f.x, f.z]
  const y = s.terrain.heightAt(a.x, a.z) + 1
  v.teleport(v.object.position.clone().set(a.x, y, a.z), Math.atan2(-f.x, -f.z))
  v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  const bot = s.bots.vehicles[0]
  if (bot) {
    const bx = a.x + f.x * ahead, bz = a.z + f.z * ahead
    bot.teleport(v.object.position.clone().set(bx, s.terrain.heightAt(bx, bz) + 1.5, bz), Math.atan2(-f.x, -f.z))
    bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true); bot.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }
}, ahead)

try {
  for (const hour of HOURS) {
    // Gear, on alpine grass.
    {
      const { context, page, errors } = await open('alpine', hour, true)
      const at = `${hour}`
      await park(page, 20); await page.waitForTimeout(2500)
      await moment(page, `chaser-${at}`, () => window.syn3hNet.launchPester(0xff00), 2400, 8)
      await page.waitForTimeout(2500); await park(page, 20); await page.waitForTimeout(2000)
      await moment(page, `grapple-bot-${at}`, () => { const s = window.syn3h, n = window.syn3hNet; n.gear.select?.('bungee'); const a = s.player.body.translation(), t = s.bots.vehicles[0].body.translation(); return n.bungee.launch([t.x - a.x, t.y - a.y - 1.1, t.z - a.z]) }, 1800, 6)
      await page.evaluate(() => window.syn3hNet.bungee.letGo?.('released'))
      await page.waitForTimeout(2000); await park(page, 20); await page.waitForTimeout(2000)
      await moment(page, `grapple-ground-${at}`, () => { const n = window.syn3hNet, [fx, fz] = window.__f; n.gear.select?.('bungee'); return n.bungee.launch([fx, -0.35, fz]) }, 1500, 5)
      await page.evaluate(() => window.syn3hNet.bungee.letGo?.('released'))
      await page.waitForTimeout(2000)
      // The Yoink gust: the bot out of the cone first.
      await page.evaluate(() => { const b = window.syn3h.bots.vehicles[0]; b.teleport(b.object.position.clone().setX(b.object.position.x + 60), 0) })
      await park(page, 0); await page.waitForTimeout(2000)
      await moment(page, `yoink-gust-${at}`, () => { const n = window.syn3hNet; n.gear.select?.('yoink'); return n.yoink.press() !== null }, 900, 6)
      await page.waitForTimeout(1500); await park(page, 0); await page.waitForTimeout(1500)
      await moment(page, `tag-flight-${at}`, () => { const [fx, fz] = window.__f; window.syn3hNet.gear.select?.('beam'); window.syn3hNet.fire([fx, 0.03, fz]) }, 400, 6)
      await page.waitForTimeout(1500)
      await moment(page, `thunder-flight-${at}`, () => { const [fx, fz] = window.__f; window.syn3hNet.fire([fx, 0.05, fz], undefined, 'red') }, 900, 6)
      if (errors.length) report.push(`alpine ${at} page errors: ${errors.slice(0, 2).join(' | ')}`)
      await context.close()
    }
    // Splashes: a hit on the liquid and the car dropping in.
    for (const [planet, kind] of [['archipelago', 'water'], ['volcanic', 'lava']]) {
      const { context, page, errors } = await open(planet, hour, false)
      const at = `${hour}`
      // The nearest patch of this liquid at least 3 m deep, and a dry spot 14 m back from it towards the player.
      const found = await page.evaluate(kind => {
        const s = window.syn3h, t = s.terrain, p = s.player.body.translation()
        let best = null
        for (let r = 20; r < 1500 && !best; r += 20) for (let k = 0; k < 48; k++) {
          const a = k / 48 * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
          if (t.liquidKindAt?.(x, z) === kind && (t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z) + 3) { best = { x, z, a }; break }
        }
        if (!best) return null
        // Back towards the player until dry, then 14 m more.
        let x = best.x, z = best.z
        for (let i = 0; i < 400; i++) { x -= Math.cos(best.a) * 0.5; z -= Math.sin(best.a) * 0.5; if ((t.liquidHeightAt?.(x, z) ?? -Infinity) < t.heightAt(x, z)) break }
        const sx = x - Math.cos(best.a) * 14, sz = z - Math.sin(best.a) * 14
        const v = s.player
        v.teleport(v.object.position.clone().set(sx, t.heightAt(sx, sz) + 1, sz), Math.atan2(-Math.cos(best.a), -Math.sin(best.a)))
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        // The liquid 8 m beyond the shore.
        const tx = x + Math.cos(best.a) * 8, tz = z + Math.sin(best.a) * 8
        window.__splash = { x: tx, z: tz, y: t.liquidHeightAt(tx, tz), a: best.a }
        return { x: tx, z: tz }
      }, kind)
      if (!found) { report.push(`${planet} ${at}: no ${kind} found`); await context.close(); continue }
      await page.waitForTimeout(3000)
      for (const red of [false, true]) {
        await moment(page, `${kind}-${red ? 'thunder' : 'tag'}-hit-${at}`, red => {
          const s = window.syn3h, o = s.player.object.position, T = window.__splash
          const from = o.clone().setY(o.y + 1), d = o.clone().set(T.x, T.y, T.z).sub(from).normalize()
          window.syn3hNet.fire([d.x, d.y, d.z], undefined, red ? 'red' : undefined)
        }, red ? 1500 : 1200, 6, red)
        await page.waitForTimeout(2500)
      }
      await moment(page, `${kind}-drop-${at}`, () => {
        const s = window.syn3h, v = s.player, T = window.__splash
        v.teleport(v.object.position.clone().set(T.x - Math.cos(T.a) * 4, T.y + 4, T.z - Math.sin(T.a) * 4), Math.atan2(-Math.cos(T.a), -Math.sin(T.a)))
        v.body.setLinvel({ x: Math.cos(T.a) * 6, y: 0, z: Math.sin(T.a) * 6 }, true)
      }, 1800, 6)
      if (errors.length) report.push(`${planet} ${at} page errors: ${errors.slice(0, 2).join(' | ')}`)
      await context.close()
    }
  }
} finally { await browser.close() }
console.log(report.join('\n'))
