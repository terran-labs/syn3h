/**
 * Screenshots of a round world taken with the game's own chase camera, by moving the
 * player: so the sphere mapping and horizon culling see the camera the player would have.
 * (shots.mjs pins the camera after those have run, which is wrong for a round world.)
 *
 *   node tools/terrainlab/round-shots.mjs [baseUrl] [outDir] [query]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const out = process.argv[3] ?? '/tmp/terrainlab-round'
const query = process.argv[4] ?? 'world=volcanic.7'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${base}?autoplay=1&${query}&room=round${Date.now().toString(36)}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 90000 })
const spots = await page.evaluate(() => {
  const t = window.syn3h.terrain
  const road = t.roadPaths().find((r) => r.kind === 'volcano').points
  const at = (f) => { const i = Math.floor(road.length * f), p = road[i], q = road[Math.min(road.length - 1, i + 3)]; return { x: p.x, y: p.y, z: p.z, heading: Math.atan2(-(q.x - p.x), -(q.z - p.z)) } }
  return { 'road-quarter': at(0.25), 'road-half': at(0.5), 'road-top': at(0.9), summit: at(0.995) }
})
for (const [name, s] of Object.entries(spots)) {
  await page.evaluate((p) => {
    const pl = window.syn3h.player
    pl.body.setTranslation({ x: p.x, y: p.y + 1.5, z: p.z }, true)
    pl.body.setRotation({ x: 0, y: Math.sin(p.heading / 2), z: 0, w: Math.cos(p.heading / 2) }, true)
    pl.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    pl.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }, s)
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${out}/${name}.png` })
}
await browser.close()
console.log(JSON.stringify({ out, errors }))
