/**
 * Drives the player's vehicle across each of the four seams of a wrapping world and fails
 * if anything jumps: the vehicle relative to the camera, its speed, or its height above
 * the ground. It also checks the vehicle ends up back inside the tile on the far side.
 *
 *   node tools/terrainlab/seam-check.mjs [baseUrl] [world, default alpine.7~terrain.planetSize=0]
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5191/'
const world = process.argv[3] ?? 'alpine.7~terrain.planetSize=0'
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${base}?autoplay=1&world=${world}&room=seam${Date.now().toString(36)}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 90000 })

const results = []
for (const [name, ax, az] of [['east', 1, 0], ['west', -1, 0], ['south', 0, 1], ['north', 0, -1]]) {
  const r = await page.evaluate(async ([ax, az]) => {
    const s = window.mira, t = s.terrain, pl = s.player, cam = s.game.camera
    const size = t.size, half = size / 2
    // A stretch of dry, gentle ground that runs across this edge, if there is one.
    let along = 0, best = -1
    for (let a = -half + 20; a < half - 20; a += 8) {
      let ok = 0
      for (let d = -40; d <= 40; d += 8) {
        const x = ax ? ax * (half + d) : a, z = az ? az * (half + d) : a
        const h = t.heightAt(x, z), liquid = t.liquidHeightAt(x, z)
        if (h > liquid + 1 && Math.abs(t.heightAt(x + 4, z) - h) < 1.2 && Math.abs(t.heightAt(x, z + 4) - h) < 1.2) ok++
      }
      if (ok > best) { best = ok; along = a }
    }
    const start = { x: ax ? ax * (half - 30) : along, z: az ? az * (half - 30) : along }
    const y = Math.max(t.heightAt(start.x, start.z), t.liquidHeightAt(start.x, start.z)) + 1.2
    const heading = Math.atan2(-ax, -az)
    pl.body.setTranslation({ x: start.x, y, z: start.z }, true)
    pl.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true)
    pl.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    pl.body.setLinvel({ x: ax * 16, y: 0, z: az * 16 }, true)
    await new Promise((r) => setTimeout(r, 600))
    // Sample every rendered frame for a few seconds while holding the speed up.
    const samples = []
    const t0 = performance.now()
    let crossed = false
    await new Promise((done) => {
      const tick = () => {
        const p = pl.body.translation(), v = pl.body.linvel()
        if (Math.hypot(v.x, v.z) < 12) pl.body.setLinvel({ x: ax * 16, y: v.y, z: az * 16 }, true)
        const o = pl.object.position
        samples.push({ rx: o.x - cam.position.x, ry: o.y - cam.position.y, rz: o.z - cam.position.z, speed: Math.hypot(v.x, v.z), above: p.y - Math.max(t.heightAt(p.x, p.z), t.liquidHeightAt(p.x, p.z)), u: ax ? p.x * ax : p.z * az })
        if (samples.length > 1 && samples[samples.length - 1].u < samples[samples.length - 2].u - half) crossed = true
        if (performance.now() - t0 > 6000) done(); else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Judge the frame of the crossing itself against the frames either side of it. Over
    // open water the vehicle bobs and skips, which is not the seam's doing.
    let at = -1
    for (let i = 1; i < samples.length; i++) if (samples[i].u < samples[i - 1].u - half) { at = i; break }
    const step = (i) => { const a = samples[i - 1], b = samples[i]; return { cam: Math.hypot(b.rx - a.rx, b.ry - a.ry, b.rz - a.rz), speed: Math.abs(b.speed - a.speed), above: Math.abs(b.above - a.above) } }
    const usual = { cam: 0, speed: 0, above: 0 }
    let n = 0
    for (let i = Math.max(1, at - 6); i <= Math.min(samples.length - 1, at + 6); i++) {
      if (i === at) continue
      const d = step(i)
      usual.cam = Math.max(usual.cam, d.cam); usual.speed = Math.max(usual.speed, d.speed); usual.above = Math.max(usual.above, d.above)
      n++
    }
    const cross = at > 0 ? step(at) : { cam: NaN, speed: NaN, above: NaN }
    const end = pl.body.translation()
    const r2 = (v) => +v.toFixed(2)
    return {
      landCells: best, frames: samples.length, crossed,
      atCrossing: { cameraJump: r2(cross.cam), speedJump: r2(cross.speed), heightJump: r2(cross.above) },
      framesAround: { cameraJump: r2(usual.cam), speedJump: r2(usual.speed), heightJump: r2(usual.above) },
      endInsideTile: Math.abs(end.x) <= half + 5 && Math.abs(end.z) <= half + 5,
    }
  }, [ax, az])
  // The crossing frame may be no rougher than its neighbours, give or take a little.
  const c = r.atCrossing, u = r.framesAround
  r.ok = r.crossed && r.endInsideTile && c.cameraJump <= u.cameraJump + 0.5 && c.speedJump <= u.speedJump + 1 && c.heightJump <= u.heightJump + 0.5
  results.push({ seam: name, ...r })
}
await page.screenshot({ path: '/tmp/seam-check.png' })
await browser.close()
console.log(JSON.stringify({ world, results, errors }, null, 1))
if (errors.length || results.some((r) => !r.ok)) { console.error('SEAM CHECK FAILED'); process.exit(1) }
console.log('SEAM CHECK OK')
