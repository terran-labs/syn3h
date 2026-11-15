/** Before and after evidence for rivers that run off a drop (Vagard III, ice seed 1).
 * node tools/water/falls-check.mjs BASE OUT LABEL   (run through the shared heavy limiter)
 * Rooms are cut off; the camera is held by a system spliced in ahead of the game's own.
 * Writes OUT/LABEL-<view>.png and OUT/LABEL-report.json with draw calls and water geometry.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const [base, out, label = 'shot'] = process.argv.slice(2)
if (!base || !out) throw new Error('Provide a dev server origin and an output directory')
mkdirSync(out, { recursive: true })
// Camera positions and look targets, world metres. River 1 meets its mouth pool over a bank;
// river 2 starts down the cliff below the summit tarn.
const VIEWS = {
  'pool-below': { cam: [22, 24, -404], look: [7.6, 31, -388] },
  'pool-side': { cam: [38, 40, -395], look: [7.5, 29, -395] },
  'cliff-front': { cam: [-215, 70, 112], look: [-176, 82, 74] },
  'cliff-side': { cam: [-215, 95, 40], look: [-180, 80, 78] },
}
const report = { label, errors: [], views: {} }
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.routeWebSocket(/\/ws/, socket => socket.close())
  const url = new URL(base)
  for (const [k, v] of Object.entries({ autoplay: '1', world: 'ice.1', vehicle: 'buggy' })) url.searchParams.set(k, v)
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.game.time > 3, null, { timeout: 180000 })
  await page.evaluate(() => {
    const s = window.syn3h
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'world.curve': 0, 'weather.storminess': 0 })) s.params.set(id, value, 'local')
    const held = { update() {
      const v = window.fallsView; if (!v) return
      const [x, y, z] = v.cam
      s.game.camera.position.set(x, Math.max(y, s.terrain.heightAt(x, z) + 4), z); s.game.camera.lookAt(...v.look)
    }, fixedUpdate() {
      const v = window.fallsView; if (!v) return
      // Park the player well away from the view.
      s.player.body.setTranslation({ x: v.cam[0] + 60, y: s.terrain.heightAt(v.cam[0] + 60, v.cam[2]) + 2, z: v.cam[2] }, true)
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } }
    s.game.systems.push(held)
  })
  for (const [name, view] of Object.entries(VIEWS)) {
    await page.evaluate(v => { window.fallsView = v }, view)
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${out}/${label}-${name}.png` })
    report.views[name] = await page.evaluate(() => {
      const s = window.syn3h, info = s.game.renderer.info
      return { calls: info.render?.drawCalls ?? info.render?.calls, triangles: info.render?.triangles, camera: s.game.camera.position.toArray() }
    })
  }
  report.water = await page.evaluate(() => {
    const v = window.syn3h.terrain.volcanics
    const by = {}
    for (const { mesh } of v.meshes) {
      const n = mesh.geometry.name || 'unnamed'
      by[n] ??= { meshes: 0, vertices: 0 }
      by[n].meshes++; by[n].vertices += mesh.geometry.getAttribute('position').count
    }
    return by
  })
} finally {
  writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
