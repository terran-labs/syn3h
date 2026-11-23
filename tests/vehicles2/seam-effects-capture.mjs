/**
 * Drives the player's buggy across the east seam of a wrapping world, crabbing so it skids and
 * raises dust, and captures the frame just before and just after the crossing from a camera
 * beside and behind it. Runs twice: `trunk` hides the seam announcement from the effects, which
 * is exactly the old behaviour (everything behind the vehicle is left a tile away), and `fix`.
 * Also counts tyre mark quads and dust particles within 30 m of the buggy in each frame.
 *
 *   node tests/vehicles2/seam-effects-capture.mjs [baseUrl] [outDir] [extra query, e.g. &webgl]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5207/'
const out = process.argv[3] ?? '/tmp/syn3h-vehicles2/follow'
const extra = process.argv[4] ?? ''
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const report = { base, extra, runs: {} }
for (const mode of ['trunk', 'fix']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await page.goto(`${base}?autoplay=1&world=alpine.7~terrain.planetSize=0,world.wrap=true&room=follow${mode}${Date.now().toString(36)}${extra}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 90000 })
  const site = await page.evaluate((mode) => {
    const s = window.mira, t = s.terrain, pl = s.player, game = s.game, cam = game.camera
    const half = t.size / 2
    // Dry, gentle ground across the east edge, as tools/terrainlab/seam-check.mjs finds it.
    let along = 0, best = -1
    for (let a = -half + 20; a < half - 20; a += 8) {
      let ok = 0
      for (let d = -40; d <= 40; d += 8) {
        const x = half + d, z = a, h = t.heightAt(x, z)
        if (h > t.liquidHeightAt(x, z) + 1 && Math.abs(t.heightAt(x + 4, z) - h) < 1.2 && Math.abs(t.heightAt(x, z + 4) - h) < 1.2) ok++
      }
      if (ok > best) { best = ok; along = a }
    }
    // Trunk behaviour: the effects never hear of the shift.
    if (mode === 'trunk') { const own = pl.object.dispatchEvent.bind(pl.object); pl.object.dispatchEvent = (e) => { if (e.type !== 'tileshift') own(e) } }
    const x0 = half - 45, y = t.heightAt(x0, along) + 1.2
    // Crab: the nose points 30 degrees left of the travel, so all four tyres slide.
    const heading = -Math.PI / 2 + Math.PI / 6
    const rot = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }
    pl.body.setTranslation({ x: x0, y, z: along }, true); pl.body.setRotation(rot, true)
    game.add({
      fixedUpdate() {
        const v = pl.body.linvel(), r = pl.body.rotation()
        pl.body.setLinvel({ x: 16, y: v.y, z: 0 }, true)
        // Hold the yaw, let it pitch and roll on the ground.
        const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x))
        if (Math.abs(yaw - heading) > .02) pl.body.setRotation(rot, true)
        const w = pl.body.angvel(); pl.body.setAngvel({ x: w.x, y: 0, z: w.z }, true)
      },
      update() {
        // Beside and behind, looking back along the way it came. Relative to the buggy, so it
        // crosses the seam with it.
        const p = pl.object.position
        cam.position.set(p.x + 4, p.y + 9, p.z + 14); cam.lookAt(p.x - 12, p.y, p.z); cam.updateMatrixWorld()
      },
    })
    const near = () => {
      const p = pl.object.position, e = game.scene.userData.vehicleEffects
      let marks = 0, dust = 0
      const ribbon = game.scene.children.find((o) => o.geometry?.attributes?.fxAge && o.renderOrder === 1)
      if (ribbon) { const a = ribbon.geometry.attributes.position, n = ribbon.geometry.drawRange.count / 6; for (let q = 0; q < n; q++) if (Math.hypot(a.getX(q * 4) - p.x, a.getZ(q * 4) - p.z) < 30) marks++ }
      const puffs = game.scene.children.find((o) => o.geometry?.attributes?.fxOrigin && o.renderOrder === 3)
      if (puffs) { const a = puffs.geometry.attributes.fxOrigin, c = puffs.geometry.attributes.fxSettings
        for (let i = 0; i < a.count; i++) if (c.getX(i) > -1000 && Math.hypot(a.getX(i) - p.x, a.getZ(i) - p.z) < 30) dust++ }
      return { x: +p.x.toFixed(2), marksWithin30m: marks, dustWithin30m: dust, marksTotal: e?.marks }
    }
    window.__seam = {
      near,
      pause() { game.renderer.setAnimationLoop(null) },
      resume() { game.last = performance.now(); game.renderer.setAnimationLoop(() => game.frame()) },
      // Resolve on the first rendered frame where `test` holds, with the loop stopped there.
      until(test) {
        return new Promise((done) => {
          const check = () => { if (test(pl.object.position.x)) { game.renderer.setAnimationLoop(null); done(near()) } else requestAnimationFrame(check) }
          requestAnimationFrame(check)
        })
      },
    }
    return { along, landCells: best, half }
  }, mode)
  const half = site.half
  const before = await page.evaluate((h) => window.__seam.until((x) => x > h - 1.5), half)
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${out}/${mode}-before.png` })
  await page.evaluate(() => window.__seam.resume())
  // Past the seam (the buggy is now near the west edge) and about a third of a second on.
  const after = await page.evaluate((h) => window.__seam.until((x) => x < 0 && x > -h + 9), half)
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${out}/${mode}-after.png` })
  report.runs[mode] = { site, before, after, errors }
  await page.close()
}
await browser.close()
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
