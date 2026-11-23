/**
 * Captures of the Chaser cloud for review, and a check that launching one builds no
 * pipeline. Run through tools/heavy.sh with MIRA_URL set to an isolated lane preview.
 *
 * Writes PNGs to MIRA_OUT (default /tmp/syn3h-weapons/chaser): the cloud against the sky
 * and against the ground, with post effects on and off, and at the lowest graphics level.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.MIRA_URL
if (!base) throw new Error('Set MIRA_URL to the isolated lane preview')
const out = process.env.MIRA_OUT ?? '/tmp/syn3h-weapons/chaser'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `chaser-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.game.input.suspended && window.miraNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => {
    const p = window.mira.params
    p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    // Launch as often as the check likes, and keep them alive long enough to photograph.
    p.set('pester.cooldown', 0.3); p.set('pester.max', 6); p.set('pester.speed', 8)
    let made = 0
    const device = window.mira.game.renderer.backend.device
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { made++; (window.__labels ??= []).push(d.label); return real(d) }
    }
    window.__pipelines = () => made
  })
  await page.waitForFunction(() => window.mira.bots.vehicles.length === 1)
  // The bot hangs `rise` metres above the player's height, 28 m ahead; the player `lift`
  // metres above the ground. A high bot puts the Chasers against the sky.
  const place = (lift, rise) => page.evaluate(async ({ lift, rise }) => {
    const s = window.mira, bot = s.bots.vehicles[0], p = s.player.body.translation()
    // Along the way the camera already looks, so the Chasers fly into the picture.
    const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
    const heading = Math.atan2(-f.x, -f.z)
    const bx = p.x + f.x * 20, bz = p.z + f.z * 20
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(bx, bz)) + lift
    for (const [v, x, z, h] of [[s.player, p.x, p.z, y], [bot, bx, bz, y + rise]]) {
      v.teleport(s.player.object.position.clone().set(x, h, z), heading)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    return { heading, forward: [f.x, f.z] }
  }, { lift, rise })
  const clear = () => page.evaluate(() => { const n = window.miraNet; for (const o of n.pesters.list()) n.pesters.confirmHit(o.shooter, o.id) })
  const launch = async count => {
    await page.evaluate(() => window.miraNet.gear.select('pester'))
    for (let i = 0; i < count; i++) {
      await page.keyboard.down('KeyL'); await page.waitForTimeout(350); await page.keyboard.up('KeyL')
      await page.waitForTimeout(500)
    }
  }
  await page.waitForTimeout(4000)
  const report = { shots: [] }
  const before = await page.evaluate(() => window.__pipelines())
  const scene = async (name, lift, rise) => {
    await clear()
    await place(lift, rise)
    await page.waitForTimeout(2500)
    // Again once the camera has settled behind the vehicle.
    await place(lift, rise)
    await page.waitForTimeout(800)
    await launch(3)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}/${name}.png` })
    // Where the Chasers are on screen, so an empty picture is caught here and not by eye.
    const seen = await page.evaluate(async () => {
      const cam = window.mira.game.camera
      return window.miraNet.pesters.list().map(o => { const v = window.mira.player.object.position.clone().set(...o.pos).project(cam); return [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, v.z < 1] })
    })
    // A close-up around the middle Chaser, three times life size.
    const mid = seen.filter(v => v[2]).sort((a, b) => a[1] - b[1])[Math.floor(seen.length / 2)]
    if (mid) {
      const cx = (mid[0] + 1) * 640, cy = (1 - mid[1]) * 400
      await page.screenshot({ path: `${out}/${name}-close.png`, clip: { x: Math.max(0, Math.min(1280 - 360, cx - 180)), y: Math.max(0, Math.min(800 - 240, cy - 120)), width: 360, height: 240 }, scale: 'css' })
    }
    report.shots.push({ name, seen })
    assert.ok(seen.some(([x, y, front]) => front && Math.abs(x) < 0.9 && Math.abs(y) < 0.9), `${name}: a Chaser is in the picture`)
  }
  await scene('sky-post-on', 6, 14)
  report.pipelinesOnFirstLaunch = await page.evaluate(() => window.__pipelines()) - before
  report.labelsOnFirstLaunch = await page.evaluate(() => window.__labels ?? [])
  await scene('ground-post-on', 14, -10)
  await page.evaluate(() => window.mira.params.set('post.on', false))
  await page.waitForTimeout(3000)
  await scene('sky-post-off', 6, 14)
  await scene('ground-post-off', 14, -10)
  // The scatter when one ends.
  await clear()
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${out}/scatter.png` })
  await page.evaluate(() => { window.mira.params.set('post.on', true); window.mira.params.set('gfx.level', 0) })
  await page.waitForTimeout(6000)
  await scene('sky-level-0', 6, 14)
  await scene('ground-level-0', 14, -10)
  report.launched = await page.evaluate(() => window.miraNet.pesters.stats.launched)
  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.launched >= 6, 'Chasers launched')
  assert.equal(report.pipelinesOnFirstLaunch, 0, 'launching a Chaser builds no pipeline')
  assert.deepEqual(errors, [])
  console.log('CHASER CAPTURE OK')
} finally { await browser.close() }
