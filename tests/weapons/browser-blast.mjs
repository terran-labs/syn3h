/**
 * Impact push in two real browsers. Run through tools/heavy.sh with MIRA_URL set to an
 * isolated lane preview.
 *
 * A (the host) rests on the ground with a parked bot and B a few metres away, and fires
 * Plasma Thunder straight down. Checked: A is thrown into the air, turning; B, on its own
 * client, is pushed too and sees A rise; the bot is shoved and comes back to rest; nothing
 * ends up with a non-finite position.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const base = process.env.MIRA_URL
if (!base) throw new Error('Set MIRA_URL to the isolated lane preview')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
const room = `blast-${Date.now()}`
try {
  async function open() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base, { waitUntil: 'load' })
    await page.waitForFunction(() => window.mira?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
    await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, room)
    await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
    await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.game.input.suspended && window.miraNet?.connected, null, { timeout: 60000 })
    return page
  }
  const A = await open(), B = await open()
  const endpoints = await Promise.all([A, B].map(p => p.evaluate(() => window.miraNet.conn.url)))
  console.log(`Room connections: ${endpoints.join(' ')}`)
  for (const e of endpoints) assert.equal(new URL(e).host, new URL(base).host, 'the page reaches its room through this preview, not another server')
  await A.evaluate(() => { const p = window.mira.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1) })
  await A.waitForFunction(() => window.mira.bots.vehicles.length === 1)
  const ids = { a: await A.evaluate(() => window.miraNet.id), b: await B.evaluate(() => window.miraNet.id) }
  await B.waitForFunction(id => window.miraNet.players.has(id), ids.a)
  // A where it stands; the bot 6 m to one side and B 6 m to the other, all dropped onto the ground.
  const spot = await A.evaluate(() => {
    const s = window.mira, p = s.player.body.translation(), bot = s.bots.vehicles[0]
    const at = (x, z) => s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 1.5, z)
    s.player.teleport(at(p.x, p.z), 0)
    bot.teleport(at(p.x + 6, p.z), 0)
    return { x: p.x - 6, z: p.z }
  })
  await B.evaluate(q => { const s = window.mira; s.player.teleport(s.player.object.position.clone().set(q.x, s.terrain.heightAt(q.x, q.z) + 1.5, q.z), 0) }, spot)
  await A.waitForTimeout(4000)
  const sample = (page, who) => page.evaluate(who => {
    const s = window.mira, n = window.miraNet
    const body = who === 'self' ? s.player.body : who === 'bot' ? s.bots.vehicles[0].body : n.vehicleOf(who)?.body
    const p = body.translation(), w = body.angvel(), v = body.linvel()
    return { y: p.y, x: p.x, z: p.z, spin: Math.hypot(w.x, w.y, w.z), speed: Math.hypot(v.x, v.y, v.z) }
  }, who)
  const before = { a: await sample(A, 'self'), bot: await sample(A, 'bot'), b: await sample(B, 'self'), aOnB: await sample(B, ids.a) }
  // Track the peaks in the page, every frame, so a slow test process misses nothing.
  const track = (page, who) => page.evaluate(who => {
    const s = window.mira, n = window.miraNet
    const body = () => (who === 'self' ? s.player.body : who === 'bot' ? s.bots.vehicles[0].body : n.vehicleOf(who)?.body)
    const peak = (window.__peak ??= {})
    const p = peak[who] = { top: -Infinity, spin: 0, speed: 0, finite: true }
    const tick = () => {
      const b = body()
      if (b) {
        const t = b.translation(), w = b.angvel(), v = b.linvel()
        p.top = Math.max(p.top, t.y); p.spin = Math.max(p.spin, Math.hypot(w.x, w.y, w.z)); p.speed = Math.max(p.speed, Math.hypot(v.x, v.y, v.z))
        if (![t.x, t.y, t.z].every(Number.isFinite)) p.finite = false
      }
      requestAnimationFrame(tick)
    }
    tick()
  }, who)
  await track(A, 'self'); await track(A, 'bot'); await track(B, 'self'); await track(B, ids.a)
  const blastsBefore = await B.evaluate(() => window.miraNet.blast.stats.blasts)
  await A.evaluate(() => window.miraNet.fire([0, -1, 0], undefined, 'red'))
  await A.waitForTimeout(7000)
  const peaks = { ...(await A.evaluate(() => window.__peak)), ...Object.fromEntries(Object.entries(await B.evaluate(() => window.__peak)).map(([k, v]) => [`B:${k}`, v])) }
  const after = { bot: await sample(A, 'bot') }
  const report = {
    aRise: peaks.self.top - before.a.y, aSpin: peaks.self.spin,
    botSpeed: peaks.bot.speed, botRestSpeed: after.bot.speed,
    bSpeed: peaks['B:self'].speed, aRiseSeenByB: peaks[`B:${ids.a}`].top - before.aOnB.y,
    blastsOnB: (await B.evaluate(() => window.miraNet.blast.stats.blasts)) - blastsBefore,
    finite: Object.values(peaks).every(p => p.finite), errors,
  }
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.aRise > 3, `the firer is thrown into the air (rose ${report.aRise.toFixed(1)} m)`)
  assert.ok(report.aSpin > 0.3, 'the firer turns')
  assert.ok(report.botSpeed > 1, 'the bot is shoved')
  assert.ok(report.botRestSpeed < 1, 'the bot comes back to rest')
  assert.ok(report.blastsOnB >= 1, 'B computed the same impact itself')
  assert.ok(report.bSpeed > 1, 'B is pushed on its own client')
  assert.ok(report.aRiseSeenByB > 2, 'B sees the firer rise')
  assert.ok(report.finite)
  assert.deepEqual(errors, [])
  console.log('BLAST BROWSER OK')
} finally { await browser.close() }
