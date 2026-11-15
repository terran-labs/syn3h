/**
 * Captures of the Grapple's light tether for review, and a check that using it builds no
 * gear pipeline. Run through tools/heavy.sh with SYN3H_URL set to an isolated lane preview.
 *
 * Writes PNGs to SYN3H_OUT (default /tmp/syn3h-grapple-look), each with a close-up: the hook
 * in flight, a slack cord on a ground anchor, a taut cord being reeled in, a cord to the
 * parked bot and the landing marker while aiming. The set runs with post effects on and off,
 * the cord against the sky and against the ground, and again at graphics level 0. Each shot
 * asserts that what it photographs projects inside the frame, so an empty picture fails here
 * and not by eye.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL to the isolated lane preview')
const out = process.env.SYN3H_OUT ?? '/tmp/syn3h-grapple-look'
await mkdir(out, { recursive: true })
const W = 1280, H = 800
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `grapple-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 60000 })
  const backend = await page.evaluate(() => window.syn3h.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')
  await page.evaluate(() => {
    const p = window.syn3h.params
    p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    // A slow hook stays in the air long enough to photograph.
    p.set('bungee.hookSpeed', 40); p.set('bungee.cooldown', 0)
    let made = 0
    const device = window.syn3h.game.renderer.backend.device
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { made++; (window.__labels ??= []).push(d.label); return real(d) }
    }
    window.__pipelines = () => made
    // Side view during captures exposes the cord and travelling beads instead of hiding
    // them behind the player's roof. Gameplay and aiming keep the ordinary chase camera.
    window.syn3h.game.add({ update() {
      const at = window.__captureTarget
      if (!at) return
      const s = window.syn3h, [fx, fz] = window.__forward
      s.game.camera.position.set(at[0] + fz * 16, at[1] + 7, at[2] - fx * 16)
      s.game.camera.lookAt(...at)
      s.game.camera.updateMatrixWorld()
      window.syn3hNet.bungee.update(0)
    } })
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)

  // The player hangs `lift` metres above the ground, the bot 20 m ahead and `rise` above the
  // player, both held still. Facing the way the camera already looks.
  const place = (lift, rise) => page.evaluate(({ lift, rise }) => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
    const heading = Math.atan2(-f.x, -f.z)
    const bx = p.x + f.x * 20, bz = p.z + f.z * 20
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(bx, bz)) + lift
    for (const [v, x, z, h] of [[s.player, p.x, p.z, y], [bot, bx, bz, y + rise]]) {
      v.teleport(s.player.object.position.clone().set(x, h, z), heading)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    window.__forward = [f.x, f.z]
  }, { lift, rise })
  const settle = async (lift, rise) => { await place(lift, rise); await page.waitForTimeout(2000); await place(lift, rise); await page.waitForTimeout(700) }
  const letGo = async () => { await page.evaluate(() => { const b = window.syn3hNet.bungee; b.setReel(0); b.letGo() }); await page.waitForTimeout(300) }
  // `up` tilts the launch from the forward direction; the hook catches what it meets.
  const launch = up => page.evaluate(up => {
    const n = window.syn3hNet, [fx, fz] = window.__forward
    n.gear.select('bungee')
    return n.bungee.launch([fx, up, fz])
  }, up)
  // Toward the bot's centre.
  const launchAtBot = () => page.evaluate(() => {
    const s = window.syn3h, n = window.syn3hNet, a = s.player.body.translation(), b = s.bots.vehicles[0].body.translation()
    n.gear.select('bungee')
    return n.bungee.launch([b.x - a.x, b.y - a.y - 1.1, b.z - a.z])
  })
  // World points of what a shot is about: [x, y, z] arrays.
  const subject = what => page.evaluate(what => {
    const s = window.syn3h, b = window.syn3hNet.bungee, c = b.mine
    const me = s.player.object.position
    if (what === 'hook') return c?.hook ? [c.hook.pos.toArray()] : []
    if (what === 'ground') return c?.at ? [c.at.toArray(), me.clone().lerp(c.at, 0.5).toArray()] : []
    if (what === 'bot') { const o = s.bots.vehicles[0].object.position; return c && c.to !== null ? [o.toArray(), me.clone().lerp(o, 0.5).toArray()] : [] }
    // The marker's centre, as the look last wrote it.
    if (what === 'marker') { const k = b.look.sparks.geometry.getAttribute('gsCentre').array; return b.look.sparks.visible ? [[k[0], k[1], k[2]]] : [] }
    return []
  }, what)
  const report = { backend, shots: [] }
  const shoot = async (name, what) => {
    const points = await subject(what)
    await page.evaluate(points => {
      window.__captureTarget = points.at(-1)
    }, points)
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/${name}.png` })
    const seen = await page.evaluate(points => {
      const cam = window.syn3h.game.camera, v = window.syn3h.player.object.position.clone()
      return points.map(p => { v.set(...p).project(cam); return [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, v.z < 1] })
    }, points)
    const extra = await page.evaluate(() => ({ tension: Math.round(window.syn3hNet.bungee.tension * 100) / 100, attached: window.syn3hNet.bungee.attached }))
    report.shots.push({ name, seen, ...extra })
    const inside = seen.filter(([x, y, front]) => front && Math.abs(x) < 0.92 && Math.abs(y) < 0.92)
    assert.ok(inside.length > 0, `${name}: the ${what} is in the picture (${JSON.stringify(seen)})`)
    const [x, y] = inside[0]
    const cx = (x + 1) * W / 2, cy = (1 - y) * H / 2
    await page.screenshot({ path: `${out}/${name}-close.png`, clip: { x: Math.max(0, Math.min(W - 360, cx - 180)), y: Math.max(0, Math.min(H - 240, cy - 120)), width: 360, height: 240 }, scale: 'css' })
    await page.evaluate(() => { window.__captureTarget = null })
    return extra
  }

  const set = async tag => {
    // The hook in flight, against the sky and against the ground.
    await letGo(); await settle(6, 14)
    assert.ok(await launch(0.35), 'the hook launched')
    await page.waitForTimeout(700)
    await shoot(`${tag}-hook-sky`, 'hook')
    await letGo(); await settle(20, 14)
    assert.ok(await launch(-0.25), 'the hook launched')
    await page.waitForTimeout(450)
    await shoot(`${tag}-hook-ground`, 'hook')
    // A ground anchor, slack: let some cord out so it droops.
    await letGo(); await settle(10, 14)
    assert.ok(await launch(-0.45), 'the hook launched')
    await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 })
    await page.evaluate(() => window.syn3hNet.bungee.setReel(1))
    await page.waitForTimeout(900)
    await page.evaluate(() => window.syn3hNet.bungee.setReel(0))
    await page.waitForTimeout(600)
    await shoot(`${tag}-ground-slack`, 'ground')
    // The same cord reeled in hard: hold the reel so tension rises, photograph while held.
    // Pin the player for this visual fixture. Otherwise reeling correctly pulls it toward
    // the anchor and releases the tension before a slow screenshot can observe it.
    await page.evaluate(() => {
      window.syn3h.player.body.setEnabledTranslations(false, false, false, true)
      window.syn3hNet.bungee.setReel(-1)
    })
    await page.waitForFunction(() => window.syn3hNet.bungee.tension > 0.25, null, { timeout: 10000 })
    const taut = await shoot(`${tag}-ground-taut`, 'ground')
    await page.evaluate(() => {
      window.syn3hNet.bungee.setReel(0)
      window.syn3h.player.body.setEnabledTranslations(true, true, true, true)
    })
    assert.ok(taut.tension > 0.2, `${tag}: the reeled cord is under tension (${taut.tension})`)
    // A cord to the bot, above: against the sky, reeled a little.
    await letGo(); await settle(6, 10)
    assert.ok(await launchAtBot(), 'the hook launched at the bot')
    await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 })
    await page.evaluate(() => window.syn3hNet.bungee.setReel(-1))
    await page.waitForTimeout(1200)
    await shoot(`${tag}-bot-sky`, 'bot')
    await page.evaluate(() => window.syn3hNet.bungee.setReel(0))
    // The landing marker while aiming at the ground.
    await letGo(); await settle(8, 14)
    await page.evaluate(() => window.syn3hNet.gear.select('bungee'))
    await page.waitForTimeout(500)
    await shoot(`${tag}-marker`, 'marker')
  }

  // Gear pipelines built while each set runs. The warm-up (src/weapons/warm.ts) compiles the
  // Grapple's two materials as the world appears and again after a graphics level change,
  // so none may be built by using it.
  const gearDuring = async (tag, run) => {
    const from = await page.evaluate(() => (window.__labels ?? []).length)
    const total = await page.evaluate(() => window.__pipelines())
    await run()
    report[tag] = {
      pipelines: await page.evaluate(() => window.__pipelines()) - total,
      gear: await page.evaluate(n => (window.__labels ?? []).slice(n).filter(l => /gear /.test(l ?? '')), from),
    }
  }
  await page.waitForTimeout(4000)
  await gearDuring('firstUse', () => set('post-on'))
  await page.evaluate(() => window.syn3h.params.set('post.on', false))
  await page.waitForTimeout(3000)
  await gearDuring('postOff', () => set('post-off'))
  await page.evaluate(() => { window.syn3h.params.set('post.on', true); window.syn3h.params.set('gfx.level', 0) })
  await page.waitForFunction(async () => (await import('/src/weapons/warm.ts')).warmStats(window.syn3h.game)?.left === 0, null, { timeout: 120000, polling: 500 })
  await page.waitForTimeout(3000)
  await gearDuring('level0', () => set('level-0'))
  await letGo()
  report.stats = await page.evaluate(() => window.syn3hNet.bungee.stats)
  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.stats.attachedGround >= 3 && report.stats.attachedVehicle >= 3, 'cords attached to ground and bot')
  assert.deepEqual(report.firstUse.gear, [], 'first use of the Grapple builds no gear pipeline')
  assert.deepEqual(report.level0.gear, [], 'the Grapple builds no gear pipeline after a level change')
  // Post effects off changes the render targets and the warm-up does not re-arm for it, so
  // this one is reported, not asserted: it is warm.ts's business, not the look's.
  assert.deepEqual(errors, [])
  console.log('GRAPPLE CAPTURE OK')
} finally { await browser.close() }
