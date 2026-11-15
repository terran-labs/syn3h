/** In-use captures of Tag, Yoink and Thunder. Transient rings pause only for the camera. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const base = process.env.SYN3H_URL, out = process.env.SYN3H_OUT ?? '/tmp/syn3h-gear-polish'
assert.ok(base, 'SYN3H_URL is required')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base)
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `polish-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 60000 })
  // This fixture arranges vehicles along their heading; use the matching unlocked aim.
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.pointerLockElement)
  await page.evaluate(() => {
    const s = window.syn3h, n = window.syn3hNet, p = s.params
    p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    p.set('yoink.cooldown', 0); p.set('yoink.holdTime', 0)
    // Capture a ring made by a real collision, holding its visual age once it has expanded.
    const pulses = n.lasers.pulses, update = pulses.update.bind(pulses)
    pulses.update = dt => {
      if (window.__holdRing && pulses.entries.some(e => e.age > e.seconds * .35 && e.age < e.seconds)) {
        window.__ring = pulses.entries.find(e => e.age < e.seconds).at.toArray()
        update(0)
      } else update(dt)
    }
    window.__labels = []
    const device = s.game.renderer.backend.device
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { window.__labels.push(d.label ?? ''); return real(d) }
    }
    s.game.add({ update() {
      const target = window.__view
      if (!target) return
      const v = s.player.object.position.clone().set(...target)
      s.game.camera.position.copy(v).add(s.player.object.position.clone().set(13, 8, 13))
      s.game.camera.lookAt(v)
      s.game.camera.updateMatrixWorld()
    } })
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)
  const warm = () => page.waitForFunction(async () => (await import('/src/weapons/warm.ts')).warmStats(window.syn3h.game)?.left === 0, null, { timeout: 120000, polling: 500 })
  const place = () => page.evaluate(() => {
    const s = window.syn3h, n = window.syn3hNet, a = s.player.body.translation()
    n.yoink.reset(); n.bigRed.reset(); n.lasers.reset()
    window.__view = null; window.__holdRing = false; window.__ring = null
    const z = a.z, x = a.x, y = Math.max(s.terrain.heightAt(x, z), s.terrain.heightAt(x, z - 8)) + 6
    for (const [v, zz] of [[s.player, z], [s.bots.vehicles[0], z - 8]]) {
      v.teleport(s.player.object.position.clone().set(x, y, zz), 0)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    return [x, y, z - 4]
  })
  const shot = async (name, target) => {
    await page.evaluate(target => { window.__view = target }, target)
    await page.waitForTimeout(250)
    const seen = await page.evaluate(target => {
      const s = window.syn3h, p = s.player.object.position.clone().set(...target).project(s.game.camera)
      return Math.abs(p.x) < .95 && Math.abs(p.y) < .95 && p.z > -1 && p.z < 1
    }, target)
    assert.ok(seen, `${name} subject in frame`)
    await page.screenshot({ path: `${out}/${name}.png` })
    report.push(name)
    await page.evaluate(() => { window.__view = null })
  }
  for (const [tag, level, post] of [['high', 2, true], ['low', 0, false]]) {
    await page.evaluate(({ level, post }) => { window.syn3h.params.set('gfx.level', level); window.syn3h.params.set('post.on', post) }, { level, post })
    await warm()
    // Let asynchronous render-chain replacement settle before measuring first use.
    await page.waitForTimeout(3000)
    await warm()
    console.log(JSON.stringify({ tag, warm: await page.evaluate(async () => (await import('/src/weapons/warm.ts')).warmStats(window.syn3h.game)), warmPipelines: await page.evaluate(() => window.__labels) }))
    await page.evaluate(() => { window.__labels = [] })
    const centre = await place()
    await page.waitForTimeout(1000)
    // The player faces -Z, with the parked bot directly ahead inside the grab cone.
    await page.evaluate(() => { window.syn3hNet.gear.select('yoink'); window.syn3hNet.yoink.press() })
    await page.waitForFunction(() => window.syn3hNet.yoink.holding !== null, null, { timeout: 10000 })
    await page.waitForTimeout(1000)
    const load = await page.evaluate(() => window.syn3h.bots.vehicles[0].object.position.toArray())
    await shot(`${tag}-yoink-field`, load)
    await page.evaluate(() => window.syn3hNet.yoink.drop())
    await place(); await page.waitForTimeout(500)
    await page.evaluate(() => window.syn3hNet.gear.select('red'))
    await page.keyboard.down('KeyL')
    await page.waitForFunction(() => window.syn3hNet.bigRed.charge > .65, null, { timeout: 10000 })
    const muzzle = await page.evaluate(() => window.syn3hNet.bigRed.glow.position.toArray())
    await shot(`${tag}-thunder-charge`, muzzle)
    await page.keyboard.up('KeyL')
    await place(); await page.waitForTimeout(500)
    await page.evaluate(() => {
      window.syn3h.params.set('laser.speed', 20)
      window.syn3hNet.fire([1, .1, 0])
    })
    await page.waitForFunction(() => window.syn3hNet.lasers.shots.length > 0)
    await shot(`${tag}-tag-thread`, await page.evaluate(() => window.syn3hNet.lasers.shots.at(-1).pos.toArray()))
    await page.evaluate(() => window.syn3h.params.set('laser.speed', 180))
    for (const red of [false, true]) {
      await place(); await page.waitForTimeout(500)
      await page.evaluate(red => { window.__holdRing = true; window.syn3hNet.fire([.7, -1, 0], undefined, red ? 'red' : undefined) }, red)
      await page.waitForFunction(() => Boolean(window.__ring), null, { timeout: 15000 })
      await shot(`${tag}-${red ? 'thunder' : 'tag'}-impact`, await page.evaluate(() => window.__ring))
      await page.evaluate(() => { window.__holdRing = false; window.syn3hNet.lasers.pulses.reset() })
    }
    const gearPipelines = await page.evaluate(() => window.__labels.filter(label => /gear /.test(label)))
    console.log(JSON.stringify({ tag, gearPipelines }))
    assert.deepEqual(gearPipelines, [], `${tag} gear builds no pipeline on use`)
  }
  console.log(JSON.stringify({ shots: report, errors }))
  assert.deepEqual(errors, [])
  console.log('GEAR POLISH CAPTURE OK')
} finally { await browser.close() }
