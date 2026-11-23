/**
 * Checks the Terrain accessors other systems rely on, in the running game:
 * roadPaths(), summit() and setRenderQuality().
 *
 *   node tools/terrainlab/accessors-check.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5191/'
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
await page.goto(`${base}?autoplay=1`, { waitUntil: 'load' })
await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 40000 })
const out = await page.evaluate(() => {
  const t = window.mira.terrain
  const roads = t.roadPaths()
  const summit = t.summit()
  const rim = roads.find((r) => r.kind === 'rim')
  // Every rim road point should sit on the summit ring.
  let worst = 0
  for (const p of rim.points) worst = Math.max(worst, Math.abs(Math.hypot(p.x - summit.x, p.z - summit.z) - summit.rimRadius))
  // Road surface heights must match the ground the physics uses.
  let offGround = 0
  for (const r of roads) for (const p of r.points) offGround = Math.max(offGround, Math.abs(t.heightAt(p.x, p.z) - p.y))
  const tri = (level, drawDistance, detail) => { t.setRenderQuality({ level, drawDistance, detail }); return t.triangleStats() }
  return {
    roads: roads.map((r) => ({ kind: r.kind, closed: r.closed, width: r.width, points: r.points.length })),
    summit, rimRingError: +worst.toFixed(3), roadOffGround: +offGround.toFixed(3),
    desktop: tri(2, 3000, 1), mobile: tri(1, 1400, 0.75), safe: tri(0, 700, 0.5),
  }
})
await browser.close()
console.log(JSON.stringify({ out, errors }, null, 1))
const ok = !errors.length && out.roads.length >= 2 && out.rimRingError < 0.5 && out.roadOffGround < 1.5 &&
  out.safe.drawn < out.mobile.drawn && out.mobile.drawn < out.desktop.drawn && out.summit.lake
if (!ok) { console.error('ACCESSORS CHECK FAILED'); process.exit(1) }
console.log('ACCESSORS OK')
