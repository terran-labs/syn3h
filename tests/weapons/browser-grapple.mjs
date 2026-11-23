/**
 * What must stay true of the Grapple in a real browser, on WebGPU and on WebGL 2:
 *  - aiming at open ground shows the landing marker;
 *  - the cord catches the ground and a vehicle;
 *  - after the covered world entry, nothing the Grapple does builds a shader in play (no node
 *    build, no render pipeline): first use, a cord caught on the ground and on a bot, let go,
 *    severed, a missed hook, and the same again after a graphics level change and with post
 *    effects off, once the warm-up has rebuilt (src/weapons/warm.ts). The owner's rule: a
 *    freeze in play is worse than a longer load.
 *
 * Builds are read from the renderer's own counter (src/core/longFrameRenderer.ts, totals in
 * diagnosticShaders.ts), which covers every object in the scene on either backend. Where the
 * camera stands and what a picture shows are not checked here: the look has its own strips.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/browser-grapple.mjs
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5433/').replace(/\/+$/, '') + '/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  for (const webgl of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const url = new URL(base)
    url.searchParams.set('world', 'alpine.7~sun.dayLength=0,sun.timeOfDay=14')
    url.searchParams.set('autoplay', '1')
    url.searchParams.set('room', `grapple-check-${webgl ? 'webgl' : 'webgpu'}-${Date.now()}`)
    if (webgl) url.searchParams.set('webgl', '1')
    await page.goto(url.href)
    await page.waitForFunction(() => window.mira?.shell?.playing && !window.mira.game.input.suspended && window.miraNet?.bungee && window.mira.game.tick > 60, null, { timeout: 180000 })
    const backend = await page.evaluate(() => window.mira.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')
    await page.evaluate(() => { const p = window.mira.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1); p.set('daydream.seconds', 0); p.set('bungee.cooldown', 0); p.set('bungee.hookSpeed', 60) })
    await page.waitForFunction(() => window.mira.bots.vehicles.length === 1, null, { timeout: 60000 })
    await page.waitForTimeout(3000)
    // The renderer's running totals of node builds and render pipelines, the whole scene.
    const totals = () => page.evaluate(async () => {
      const line = (await import('/src/core/diagnosticShaders.ts')).shaderReportLines().find(l => l.startsWith('Whole session')) ?? ''
      const n = kind => Number(line.match(new RegExp(`${kind} ×(\\d+)`))?.[1] ?? NaN)
      return { builds: n('Node build'), pipelines: n('Render pipeline') }
    })
    const B = 'const s = window.mira, n = window.miraNet, b = n.bungee, [fx, fz] = window.__f;'
    const act = fn => page.evaluate(fn => new Function(fn)(), fn)
    // The player and the bot held still, the bot 20 m ahead and 6 m up.
    const place = () => act(`
      const s = window.mira, bot = s.bots.vehicles[0], p = s.player.body.translation()
      const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
      window.__f ??= [f.x, f.z]
      const [fx, fz] = window.__f, y = s.terrain.heightAt(p.x, p.z) + 1.5, bx = p.x + fx * 20, bz = p.z + fz * 20
      for (const [v, x, z, h] of [[s.player, p.x, p.z, y], [bot, bx, bz, Math.max(y, s.terrain.heightAt(bx, bz) + 1.5) + 6]]) {
        v.teleport(s.player.object.position.clone().set(x, h, z), Math.atan2(-fx, -fz))
        v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }
      window.miraNet.gear.select('bungee')`)
    const attached = () => page.waitForFunction(() => window.miraNet.bungee.attached, null, { timeout: 5000 })
    // One round of use: every window counted, labelled for the report.
    const round = async tag => {
      const windows = {}
      const counted = async (name, run) => { const a = await totals(); await run(); const b = await totals(); windows[`${tag} ${name}`] = { builds: b.builds - a.builds, pipelines: b.pipelines - a.pipelines } }
      await place(); await page.waitForTimeout(800)
      await counted('ground cord', async () => {
        assert.ok(await act(`${B} return b.launch([fx, -0.35, fz])`), `${tag}: the hook launched`)
        await attached(); await page.waitForTimeout(1200)
      })
      await counted('let go', async () => { await act(`${B} b.letGo('released')`); await page.waitForTimeout(1500) })
      await counted('bot cord', async () => {
        assert.ok(await act(`${B} const a = s.player.body.translation(), t = s.bots.vehicles[0].body.translation(); return b.launch([t.x - a.x, t.y - a.y - 1.1, t.z - a.z])`), `${tag}: the hook launched at the bot`)
        await attached(); await page.waitForTimeout(1200)
      })
      await counted('severed', async () => { await act(`${B} b.letGo('severed')`); await page.waitForTimeout(1500) })
      await counted('miss', async () => { await act(`${B} s.params.set('bungee.length', 25); b.launch([fz, 0.12, -fx])`); await page.waitForTimeout(2500); await act("window.mira.params.set('bungee.length', 120)") })
      // The landing marker while aiming: the aim follows the chase camera (as it does with the
      // cursor captured, or the touch aim stick held), which looks down past the car at the
      // ground; the marker must show where the hook would land.
      await counted('aiming', async () => {
        await page.evaluate(async () => (await import('/src/core/touchAim.ts')).setTouchAiming(true))
        await page.waitForFunction(() => window.miraNet.bungee.look.markerShown.some(Boolean), null, { timeout: 10000 })
        await page.evaluate(async () => (await import('/src/core/touchAim.ts')).setTouchAiming(false))
      })
      return windows
    }
    const warmed = () => page.waitForFunction(async () => (await import('/src/weapons/warm.ts')).warmStats(window.mira.game)?.left === 0, null, { timeout: 120000, polling: 500 })
    const windows = { ...(await round('first use')) }
    await page.evaluate(() => window.mira.params.set('post.on', false)); await warmed(); await page.waitForTimeout(1500)
    Object.assign(windows, await round('post effects off'))
    // The counter is live: the warm-up after a graphics level change builds, and it counts that.
    const beforeLevel = await totals()
    await page.evaluate(() => { window.mira.params.set('post.on', true); window.mira.params.set('gfx.level', 0) }); await warmed(); await page.waitForTimeout(3000)
    const afterLevel = await totals()
    const levelWarm = { builds: afterLevel.builds - beforeLevel.builds, pipelines: afterLevel.pipelines - beforeLevel.pipelines }
    Object.assign(windows, await round('level 0'))
    const stats = await page.evaluate(() => window.miraNet.bungee.stats)
    report.push({ backend, windows, levelWarm, stats, errors })
    await page.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(report, null, 1))
for (const r of report) {
  assert.ok(r.levelWarm.builds + r.levelWarm.pipelines > 0, `${r.backend}: the counter saw the level change's warm-up (${JSON.stringify(r.levelWarm)})`)
  assert.ok(r.stats.attachedGround >= 3 && r.stats.attachedVehicle >= 3, `${r.backend}: cords caught the ground and the bot (${JSON.stringify(r.stats)})`)
  for (const [name, w] of Object.entries(r.windows)) assert.deepEqual(w, { builds: 0, pipelines: 0 }, `${r.backend}: ${name} built nothing in play`)
  assert.deepEqual(r.errors, [], `${r.backend}: no page errors`)
}
console.log('GRAPPLE CHECK OK')
