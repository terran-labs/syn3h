/**
 * Captures of the Chaser cloud for review, and a check that launching one builds no
 * pipeline. Run through tools/heavy.sh with SYN3H_URL set to an isolated lane preview.
 *
 * Writes PNGs to SYN3H_OUT (default /tmp/syn3h-weapons/chaser): the cloud against the sky
 * and against the ground, with post effects on and off, and at the lowest graphics level.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL to the isolated lane preview')
const out = process.env.SYN3H_OUT ?? '/tmp/syn3h-weapons/chaser'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `chaser-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => {
    const p = window.syn3h.params
    p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1)
    // Launch as often as the check likes, and keep them alive long enough to photograph.
    p.set('pester.cooldown', 0.3); p.set('pester.max', 6); p.set('pester.speed', 8)
    let made = 0
    const device = window.syn3h.game.renderer.backend.device
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { made++; (window.__labels ??= []).push(d.label); return real(d) }
    }
    window.__pipelines = () => made
  })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)
  // The bot hangs `rise` metres above the player's height, 28 m ahead; the player `lift`
  // metres above the ground. A high bot puts the Chasers against the sky.
  const place = (lift, rise) => page.evaluate(({ lift, rise }) => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(p.x, p.z - 28)) + lift
    for (const [v, z, h] of [[s.player, p.z, y], [bot, p.z - 28, y + rise]]) {
      v.teleport(s.player.object.position.clone().set(p.x, h, z), 0)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }, { lift, rise })
  const clear = () => page.evaluate(() => { const n = window.syn3hNet; for (const o of n.pesters.list()) n.pesters.confirmHit(o.shooter, o.id) })
  const launch = async count => {
    await page.evaluate(() => window.syn3hNet.gear.select('pester'))
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
    await page.waitForTimeout(800)
    await launch(3)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}/${name}.png` })
    report.shots.push(name)
  }
  await scene('sky-post-on', 6, 22)
  report.pipelinesOnFirstLaunch = await page.evaluate(() => window.__pipelines()) - before
  report.labelsOnFirstLaunch = await page.evaluate(() => window.__labels ?? [])
  await scene('ground-post-on', 14, -10)
  await page.evaluate(() => window.syn3h.params.set('post.on', false))
  await page.waitForTimeout(3000)
  await scene('sky-post-off', 6, 22)
  await scene('ground-post-off', 14, -10)
  // The scatter when one ends.
  await clear()
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${out}/scatter.png` })
  await page.evaluate(() => { window.syn3h.params.set('post.on', true); window.syn3h.params.set('gfx.level', 0) })
  await page.waitForTimeout(6000)
  await scene('sky-level-0', 6, 22)
  await scene('ground-level-0', 14, -10)
  report.launched = await page.evaluate(() => window.syn3hNet.pesters.stats.launched)
  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.launched >= 6, 'Chasers launched')
  assert.equal(report.pipelinesOnFirstLaunch, 0, 'launching a Chaser builds no pipeline')
  assert.deepEqual(errors, [])
  console.log('CHASER CAPTURE OK')
} finally { await browser.close() }
