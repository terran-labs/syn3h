/**
 * Frame sequences of gear in motion, for a person to look through: stills cannot show
 * whether a Chaser's swarm trails and tightens, or whether a vehicle tumbles. Run through
 * tools/heavy.sh with MIRA_URL set to an isolated lane preview.
 *
 * Writes numbered PNGs to MIRA_OUT (default /tmp/syn3h-weapons/motion): chaser-NN.png, a
 * Chaser launched at a parked bot until it catches it and scatters, and thunder-NN.png,
 * Plasma Thunder fired straight down under the player's own vehicle. Each frame's game time
 * and the measured state are printed, so the sequence can be read against the numbers.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.MIRA_URL
if (!base) throw new Error('Set MIRA_URL to the isolated lane preview')
const out = process.env.MIRA_OUT ?? '/tmp/syn3h-weapons/motion'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `motion-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.game.input.suspended && window.miraNet?.connected, null, { timeout: 60000 })
  const endpoint = await page.evaluate(() => window.miraNet.conn.url)
  assert.equal(new URL(endpoint).host, new URL(base).host, 'the page reaches its room through this preview')
  await page.evaluate(() => { const p = window.mira.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1) })
  await page.waitForFunction(() => window.mira.bots.vehicles.length === 1)
  // The bot hangs `ahead` metres along the camera's view and `rise` above the player.
  const place = (ahead, rise, lift) => page.evaluate(({ ahead, rise, lift }) => {
    const s = window.mira, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
    const heading = Math.atan2(-f.x, -f.z)
    const bx = p.x + f.x * ahead, bz = p.z + f.z * ahead
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(bx, bz)) + lift
    s.player.teleport(s.player.object.position.clone().set(p.x, y, p.z), heading)
    bot.teleport(s.player.object.position.clone().set(bx, y + rise, bz), heading)
    for (const v of [s.player, bot]) { v.body.setGravityScale(lift > 2 ? 0 : 1, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true) }
  }, { ahead, rise, lift })
  const frames = async (name, count, gap, state) => {
    const log = []
    for (let i = 0; i < count; i++) {
      await page.screenshot({ path: `${out}/${name}-${String(i).padStart(2, '0')}.png` })
      log.push(await page.evaluate(state))
      await page.waitForTimeout(gap)
    }
    return log
  }
  const report = {}

  // A Chaser, from launch to the catch and the scatter.
  // Slowed to a fifth of its speed for the camera, so the swarm's shape can be followed.
  await page.evaluate(() => window.mira.params.set('pester.speed', 5))
  await place(22, 5, 8)
  await page.waitForTimeout(2500)
  await place(22, 5, 8)
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.miraNet.gear.select('pester'))
  await page.keyboard.down('KeyL')
  await page.waitForFunction(() => window.miraNet.pesters.list().length > 0)
  await page.keyboard.up('KeyL')
  report.chaser = await frames('chaser', 18, 150, () => {
    const s = window.mira, n = window.miraNet, o = n.pesters.list()[0], b = s.bots.vehicles[0].body.translation()
    return { t: Math.round(s.game.time * 100) / 100, live: n.pesters.list().length, toTarget: o ? Math.round(Math.hypot(o.pos[0] - b.x, o.pos[1] - b.y, o.pos[2] - b.z) * 10) / 10 : null, speed: o ? Math.round(Math.hypot(...o.velocity) * 10) / 10 : null }
  })
  report.chaserStats = await page.evaluate(() => window.miraNet.pesters.stats)

  await page.evaluate(() => window.mira.params.set('pester.speed', 24))
  // Plasma Thunder straight down, from rest on the ground.
  await page.evaluate(() => { const n = window.miraNet; for (const o of n.pesters.list()) n.pesters.confirmHit(o.shooter, o.id) })
  await place(30, 0, 1.5)
  await page.waitForTimeout(5000)
  const rest = await page.evaluate(() => window.mira.player.body.translation().y)
  await page.evaluate(() => window.miraNet.fire([0, -1, 0], undefined, 'red'))
  report.thunder = await frames('thunder', 14, 200, () => {
    const s = window.mira, b = s.player.body, p = b.translation(), w = b.angvel()
    return { t: Math.round(s.game.time * 100) / 100, y: Math.round(p.y * 10) / 10, spin: Math.round(Math.hypot(w.x, w.y, w.z) * 10) / 10 }
  })
  report.thunderRise = Math.max(...report.thunder.map(f => f.y)) - rest
  report.errors = errors
  console.log(JSON.stringify(report))
  assert.ok(report.chaserStats.launched >= 1, 'a Chaser launched')
  assert.ok(report.chaserStats.caught >= 1, 'the Chaser reached its target')
  assert.ok(report.chaser.some(f => f.live > 0) && report.chaser.some(f => f.live === 0), 'the sequence includes pursuit and scatter')
  assert.ok(report.thunderRise > 2, 'the vehicle left the ground')
  assert.deepEqual(errors, [])
  console.log('MOTION CAPTURE OK')
} finally { await browser.close() }
