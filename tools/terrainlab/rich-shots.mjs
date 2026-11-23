/**
 * Before and after shots of the rich ground surface (the four terrain.* client sliders),
 * from the spawn pad and part way up the summit road, plus the frame time for each.
 *
 *   node tools/terrainlab/rich-shots.mjs [baseUrl] [outDir] [ids comma separated]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/rich-shots'
const ids = (process.argv[4] ?? 'volcanic,desert,alpine').split(',')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const errors = [], report = {}
const RICH = ['terrain.detailNormal', 'terrain.surfaceResponse', 'terrain.macroColour', 'terrain.accent']
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&world=${id}.7&room=r${id}${Date.now().toString(36)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 90000 })
  const frameMs = () => page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now()
    const f = () => { if (++n === 90) res((performance.now() - t0) / 90); else requestAnimationFrame(f) }
    requestAnimationFrame(f)
  }))
  const place = (f) => page.evaluate((f) => {
    const road = window.mira.terrain.roadPaths().find((r) => r.kind === 'volcano').points
    const i = Math.floor(road.length * f), p = road[i], q = road[Math.min(road.length - 1, i + 3)]
    const h = Math.atan2(-(q.x - p.x), -(q.z - p.z)) + 0.9
    const pl = window.mira.player
    // Beside the road, so the ground and not the road fills the frame.
    pl.body.setTranslation({ x: p.x + 14 * Math.cos(h), y: p.y + 3, z: p.z + 14 * Math.sin(h) }, true)
    pl.body.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true)
    pl.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pl.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }, f)
  report[id] = {}
  for (const on of [0, 1]) {
    await page.evaluate(([ids, v]) => { for (const k of ids) window.mira.params.set(k, v) }, [RICH, on])
    await page.evaluate(() => window.mira.params.set('terrain.groundCover', 0))
    for (const [name, f] of [['pad', 0.02], ['flank', 0.5]]) {
      // A key press keeps the idle autopilot from driving off between the two shots.
      await page.keyboard.press('Shift')
      await place(f)
      await page.waitForTimeout(1800)
      await page.keyboard.press('Shift')
      await page.screenshot({ path: `${out}/${id}-${name}-${on ? 'rich' : 'plain'}.png` })
      report[id][`${name}-${on ? 'rich' : 'plain'}`] = +(await frameMs()).toFixed(2)
    }
  }
  await page.close()
}
await browser.close()
console.log(JSON.stringify({ out, errors, frameMs: report }, null, 1))
