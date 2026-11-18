/**
 * Before and after frames for the water surface. Production build, phone landscape, Medium:
 *
 *   tools/heavy.sh node tools/water-surface-frames.mjs <output directory>
 *
 * A buggy and a hovercraft afloat on a desert river, seen from the side at the waterline; then
 * the lens going down through the surface of the river, a lake and the sea, and once behind a
 * moving buggy driving into the lake. The waterline exists only for the moment the glass is
 * in the surface, so the game is paused on the frame the line crosses the middle of the view.
 * The interface is hidden for the frames.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-surface/frames'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]
if (Number(listener) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = {}

async function open(planet, seed) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=${planet}&seed=${seed}&room=wf${Date.now().toString(36)}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.syn3h
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', 2)
    // Only the game's own canvas in the frames.
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
    // Pause on the frame the waterline crosses the middle of the view (see waterline.ts).
    const fx = s.game.systems?.find?.((x) => x.waterline) ?? null
    window.waterlineHold = false
    s.game.add({ update() {
      if (!window.waterlineHold || !fx) return
      // The build before the fix had a stretched line at -height / 0.8 of the view: mid view at height 0.
      const m = fx.waterline.mesh, p = fx.waterline.plane?.value, h = fx.waterline.height?.value
      const mid = p ? Math.abs(p.x) < 0.9 * Math.hypot(p.y, p.z) : Math.abs(h) < 0.3
      const c = s.game.camera.position
      ;(window.waterlineTrace ??= []).push({ visible: m.visible, plane: p ? [p.x, p.y, p.z].map((v) => +v.toFixed(3)) : null, height: h ?? null, lens: +(c.y - s.terrain.liquidHeightAt(c.x, c.z)).toFixed(3), wash: +(fx.lens?.t ?? -9).toFixed(2) })
      if (window.waterlineTrace.length > 600) window.waterlineTrace.shift()
      if (m.visible && mid) { window.waterlineHold = false; window.waterlineHeld = true; s.game.pause() }
    } })
    window.hasWaterline = Boolean(fx)
  })
  await page.waitForTimeout(2500)
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })

/** Lens down through the surface at p, paused where the line crosses mid view; or a timed sequence. */
async function crossing(page, name, p, look) {
  await page.evaluate(({ p, look }) => {
    const s = window.syn3h, V = s.game.camera.position.constructor, y0 = s.terrain.liquidHeightAt(p.x, p.z), start = performance.now()
    window.waterlineHeld = false; window.waterlineHold = true
    const move = () => { const t = Math.min(1, (performance.now() - start) / 4000); const y = y0 + 1 - 2 * t; s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x + look.x, y - 0.4, p.z + look.z), 60); if (t < 1 && !window.waterlineHeld) requestAnimationFrame(move) }
    move()
  }, { p, look })
  const held = await page.waitForFunction(() => window.waterlineHeld, null, { timeout: 6000 }).then(() => true, () => false)
  await shot(page, `${name}-mid`)
  notes[name] = await page.evaluate(() => { const s = window.syn3h, c = s.game.camera.position; return { held: window.waterlineHeld, lensAboveSurface: +(c.y - s.terrain.liquidHeightAt(c.x, c.z)).toFixed(3), hasWaterline: window.hasWaterline } })
  notes[name].held = held
  notes[name].trace = await page.evaluate(() => (window.waterlineTrace ?? []).filter((r, i, a) => r.visible || (a[i + 1]?.visible) || Math.abs(r.lens) < 0.4).slice(-12))
  await page.evaluate(() => { window.waterlineTrace = [] })
  await page.evaluate(() => { const s = window.syn3h; s.game.resume(); s.camera.clearCinematicPose() })
  await page.waitForTimeout(800)
}

// River and lake on the desert world, at the stretch where the build before the fix floated
// things 0.4 m above the drawn river.
{
  const { ctx, page } = await open('desert', 4)
  const spot = { x: 100.8, z: -177.3 }
  for (const kind of ['buggy', 'hovercraft']) {
    await page.evaluate(({ p, kind }) => {
      const s = window.syn3h
      if (s.player.kind !== kind) s.swapVehicle(kind)
      s.player.teleport({ x: p.x, y: s.terrain.liquidHeightAt(p.x, p.z) + 0.8, z: p.z }, 0)
      s.game.input.external.y = kind === 'buggy' ? 1 : 0
    }, { p: spot, kind })
    await page.waitForTimeout(2500)
    await page.evaluate(() => {
      const s = window.syn3h, V = s.game.camera.position.constructor
      const follow = () => { const b = s.player.body.translation(), y = s.terrain.liquidHeightAt(b.x, b.z) + 0.5; s.camera.setCinematicPose(new V(b.x + 6, y, b.z + 2), new V(b.x, b.y, b.z), 45); window.followId = requestAnimationFrame(follow) }
      follow()
    })
    await page.waitForTimeout(1500)
    await shot(page, `river-${kind}`)
    notes[`river-${kind}`] = await page.evaluate(() => { const s = window.syn3h, b = s.player.body.translation(); return { bodyAboveSurface: +(b.y - s.terrain.liquidHeightAt(b.x, b.z)).toFixed(2), depth: +(s.terrain.liquidHeightAt(b.x, b.z) - s.terrain.heightAt(b.x, b.z)).toFixed(2) } })
    await page.evaluate(() => { cancelAnimationFrame(window.followId); window.syn3h.camera.clearCinematicPose(); window.syn3h.game.input.external.y = 0 })
  }
  await page.evaluate(() => window.syn3h.swapVehicle('buggy'))
  await crossing(page, 'lens-river', spot, { x: 0, z: -10 })
  const lake = await page.evaluate(() => { const l = window.syn3h.terrain.data.lava; const b = l.lake ?? l.pools[0]; return b ? { x: b.x, z: b.z } : null })
  if (lake) {
    await crossing(page, 'lens-lake', lake, { x: 10, z: 4 })
    // Behind a moving buggy, driving in with the chase camera low.
    await page.evaluate((p) => {
      const s = window.syn3h
      s.player.teleport({ x: p.x + 30, y: s.terrain.heightAt(p.x + 30, p.z) + 1.5, z: p.z }, Math.PI / 2)
      s.game.input.external.y = 1
      window.waterlineHeld = false; window.waterlineHold = true
    }, lake)
    const held = await page.waitForFunction(() => window.waterlineHeld, null, { timeout: 15000 }).then(() => true, () => false)
    await shot(page, 'lens-moving-mid')
    notes['lens-moving'] = { held }
    await page.evaluate(() => { const s = window.syn3h; s.game.resume(); s.game.input.external.y = 0 })
  }
  await ctx.close()
}
{
  const { ctx, page } = await open('archipelago', 4)
  const sea = await page.evaluate(() => { const t = window.syn3h.terrain; for (let k = 0; k < 400; k++) { const x = Math.sin(k * 12.9) * 0.4 * t.size, z = Math.cos(k * 7.3) * 0.4 * t.size; if (t.liquidKindAt(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 8) return { x, z } } return null })
  if (sea) await crossing(page, 'lens-sea', sea, { x: 10, z: 4 })
  await ctx.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
