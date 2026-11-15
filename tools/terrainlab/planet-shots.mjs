/**
 * Screenshots of each planet with the game's own chase camera: the view from the spawn pad,
 * then from three places up the summit road. One page per planet.
 *
 *   node tools/terrainlab/planet-shots.mjs [baseUrl] [outDir] [ids comma separated] [seed]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/planet-shots'
const ids = (process.argv[4] ?? 'archipelago,ice,obsidian,badlands,moon,swamp').split(',')
const seed = process.argv[5] ?? '7'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const errors = []
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&world=${id}.${seed}&room=p${id}${Date.now().toString(36)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 90000 })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${out}/${id}-0-pad.png` })
  const spots = await page.evaluate(() => {
    const t = window.syn3h.terrain
    const road = t.roadPaths().find((r) => r.kind === 'volcano').points
    const at = (f, back) => {
      const i = Math.floor(road.length * f), p = road[i], q = road[Math.min(road.length - 1, i + 3)]
      const h = Math.atan2(-(q.x - p.x), -(q.z - p.z))
      return { x: p.x, y: p.y, z: p.z, heading: back ? h + Math.PI : h }
    }
    // Looking back down the road shows the plains and the sea; looking up shows the centre.
    return { '1-low-back': at(0.3, true), '2-half': at(0.55, false), '3-top-back': at(0.93, true) }
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
    await page.screenshot({ path: `${out}/${id}-${name}.png` })
  }
  await page.close()
}
await browser.close()
console.log(JSON.stringify({ out, errors }))
