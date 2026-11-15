/** Normal-entry gear smoke plus host-bot replication. Run through tools/heavy.sh. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL to the isolated lane preview')
const out = '/tmp/syn3h-weapons/current'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], received = [], report = {}
const room = `gear-check-${Date.now()}`
let hostPage
try {
  async function open(touch) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: touch })
    page.on('pageerror', e => errors.push(e.message))
    page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return
      try { const m = JSON.parse(payload); if (touch) received.push(m) } catch {}
    }))
    // No autoplay, feature flag, or special room URL: enter from the ordinary galaxy.
    await page.goto(base, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
    await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, room)
    await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
    await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 60000 })
    return page
  }
  const A = await open(false), B = await open(true)
  hostPage = A
  console.log('Normal entry connected')
  const expected = ['beam', 'red', 'pester', 'bungee', 'yoink']
  report.racks = await Promise.all([A, B].map(p => p.evaluate(() => window.syn3hNet.gear.list())))
  report.racks.forEach(r => assert.deepEqual(r, expected))
  for (const page of [A, B]) {
    const seen = []
    for (let i = 0; i < 5; i++) {
      seen.push(await page.evaluate(() => window.syn3hNet.gear.current))
      await page.locator('.gear-chip').click()
    }
    assert.deepEqual(seen, expected)
  }
  await A.keyboard.press('KeyT')
  assert.equal(await A.evaluate(() => window.syn3hNet.gear.current), 'red')
  await A.keyboard.press('Digit1')
  assert.equal(await A.evaluate(() => window.syn3hNet.gear.current), 'beam')
  await A.evaluate(async () => {
    const { beamAimDirection } = await import('/src/weapons/aim.ts')
    const n = window.syn3hNet, g = window.syn3h.game, old = n.lasers.spawn.bind(n.lasers)
    window.__beamChecks = []
    n.lasers.spawn = (from, shot, age) => {
      if (from === n.id && !shot.k) window.__beamChecks.push({ actual: shot.d, expected: beamAimDirection(g, window.syn3h.player.body) })
      return old(from, shot, age)
    }
  })
  await A.locator('#game').click({ position: { x: 640, y: 400 }, force: true })
  await A.waitForFunction(() => document.pointerLockElement === window.syn3h.game.canvas)
  await A.mouse.move(850, 350)
  await A.waitForTimeout(700)
  await A.evaluate(() => { window.__beamChecks = [] })
  await A.keyboard.down('KeyL'); await A.waitForTimeout(500); await A.keyboard.up('KeyL')
  const aims = await A.evaluate(() => window.__beamChecks)
  assert.ok(aims.length > 0)
  for (const aim of aims) {
    assert.ok(aim.expected)
    assert.ok(Math.hypot(...aim.actual.map((n, i) => n - aim.expected[i])) < 1e-6)
  }
  assert.ok(await A.locator('.focus-hud').evaluate(e => Number(getComputedStyle(e).opacity) > 0.5))
  await A.screenshot({ path: `${out}/camera-aim.png` })
  await A.evaluate(() => document.exitPointerLock())
  report.cameraShots = aims.length
  console.log('Gear selection and camera aim passed')
  // Position a bot and the guest above terrain to exercise gear without navigation noise.
  await A.evaluate(() => { const p = window.syn3h.params; p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1) })
  await A.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)
  const ids = await A.evaluate(() => ({ bot: window.syn3hNet.vehicleIdOfBody(window.syn3h.bots.vehicles[0].body.handle), host: window.syn3hNet.id }))
  ids.guest = await B.evaluate(() => window.syn3hNet.id)
  await B.waitForFunction(id => window.syn3hNet.players.has(id), ids.bot)
  async function place(distance) {
    const spot = await A.evaluate(d => {
      const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
      const x = p.x, z = p.z - 30, y = Math.max(s.terrain.heightAt(x, z), s.terrain.heightAt(x, z - d)) + 20
      bot.teleport(s.player.object.position.clone().set(x, y, z), 0)
      bot.body.setGravityScale(0, true); bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      return { x, y, z: z - d }
    }, distance)
    await B.evaluate(p => { const s = window.syn3h; s.player.teleport(s.player.object.position.clone().set(p.x, p.y, p.z), 0); s.player.body.setGravityScale(0, true); s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true) }, spot)
    await A.waitForTimeout(500)
  }
  const act = (gear, phase) => A.evaluate(({ gear, phase, guest }) => {
    const n = window.syn3hNet
    n.botDecisionHooks.act(window.syn3h.bots.vehicles[0], { gear, phase, target: n.vehicleOf(guest) })
  }, { gear, phase, guest: ids.guest })
  await place(18)
  await act('yoink', 'press')
  await B.waitForFunction(({ bot, guest }) => window.syn3hNet.yoink.holderOf(guest) === bot, ids)
  await A.waitForTimeout(700)
  await act('yoink', 'release')
  await B.waitForFunction(guest => window.syn3hNet.yoink.holderOf(guest) === null, ids.guest)
  assert.ok(received.some(m => m.type === 'yoink' && m.from === ids.bot && m.y.s === 'fling'))
  console.log('Bot Yoink passed')
  await place(35)
  await act('red', 'press')
  await A.waitForFunction(bot => window.syn3hNet.botGear.get(bot)?.red.ready, ids.bot)
  await act('red', 'release')
  await A.waitForTimeout(400)
  assert.ok(received.some(m => m.type === 'fire' && m.from === ids.bot && m.shot.k === 'red'))
  console.log('Bot Big Red passed')
  await place(35)
  await act('pester', 'press')
  await B.waitForFunction(bot => window.syn3hNet.pesters.list().some(o => o.shooter === bot), ids.bot)
  await B.screenshot({ path: `${out}/bot-pester.png` })
  await act('pester', 'release')
  await A.waitForTimeout(2500)
  console.log('Bot Pester passed')
  await place(18)
  await act('bungee', 'press')
  await A.waitForFunction(bot => window.syn3hNet.botGear.get(bot)?.bungee.attached, ids.bot)
  await B.waitForFunction(bot => window.syn3hNet.bungee.cords.has(bot), ids.bot)
  await act('bungee', 'cancel')
  await B.waitForFunction(bot => !window.syn3hNet.bungee.cords.has(bot), ids.bot)
  report.botRelays = received.filter(m => m.from === ids.bot && ['fire', 'cord', 'yoink'].includes(m.type)).map(m => [m.type, m.shot?.k ?? m.cord?.s ?? m.y?.s])
  assert.ok(report.botRelays.some(([type, state]) => type === 'cord' && state === 'off'))
  // The host can still opt out; the rack and guest follow its setting.
  await A.evaluate(() => { for (const id of ['bungee.allowed', 'yoink.allowed', 'bigRed.allowed', 'pester.allowed']) window.syn3h.params.set(id, false) })
  await B.waitForFunction(() => window.syn3hNet.gear.list().length === 1)
  await B.waitForFunction(() => document.querySelector('.gear-chip').hidden)
  assert.deepEqual(await B.evaluate(() => window.syn3hNet.gear.list()), ['beam'])
  // Let the real BotBrain choose and execute Yoink, with driving stopped for repeatability.
  const autoStart = received.length
  await A.evaluate(() => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = bot.body.translation()
    bot.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
    bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    s.player.teleport(s.player.object.position.clone().set(p.x, p.y, p.z - 18), 0)
    s.player.body.setGravityScale(0, true)
    s.params.set('yoink.allowed', true)
    s.params.set('bots.targetMode', 0)
    s.params.set('bots.canFire', true)
  })
  await A.waitForFunction(bot => window.syn3hNet.botGear.get(bot)?.yoink.holding === window.syn3hNet.id, ids.bot)
  await A.waitForFunction(bot => window.syn3hNet.botGear.get(bot)?.yoink.holding === null, ids.bot)
  await A.waitForTimeout(300)
  report.autonomousYoink = received.slice(autoStart).filter(m => m.type === 'yoink' && m.from === ids.bot && m.y.to === ids.host).map(m => m.y.s)
  assert.ok(report.autonomousYoink.includes('grab'))
  assert.ok(report.autonomousYoink.includes('fling'))
  assert.deepEqual(errors, [])
  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  console.log('GEAR BROWSER OK')
} catch (error) {
  console.log(JSON.stringify({ errors, relays: received.filter(m => m.from && ['fire', 'cord', 'yoink'].includes(m.type)) }, null, 2))
  if (hostPage) {
    console.log(await hostPage.evaluate(() => [...window.syn3hNet.botGear].map(([id, g]) => ({ id, stats: g.bungee.stats, mine: g.bungee.mine ? { to: g.bungee.mine.to, at: g.bungee.mine.at, hook: g.bungee.mine.hook } : null, pos: g.vehicle.body.translation(), target: g.target?.body.translation() }))))
    await hostPage.screenshot({ path: `${out}/failure.png` })
  }
  throw error
} finally { await browser.close() }
