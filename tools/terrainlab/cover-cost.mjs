/**
 * What the grass and flowers cost: triangles, draw calls and frame times from the driver's
 * seat on each kind of world, with ground cover on and then off. Frame times are the
 * intervals between animation frames over a few seconds, so they are capped by the
 * display's refresh in a headed browser; a headless one usually runs uncapped.
 *
 *   node tools/terrainlab/cover-cost.mjs [baseUrl] [world,world,...] [graphics level]
 *
 * The graphics level (0 safe, 1 phones and tablets, 2 desktop) is forced with ?gfx=, to
 * compare what each level draws on the same machine. It does not stand in for a phone.
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5191/'
const worlds = (process.argv[3] ?? 'alpine.7,desert.7,volcanic.1').split(',')
const gfx = process.argv[4] ? `&gfx=${process.argv[4]}` : ''
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const rows = []
for (const world of worlds) {
  await page.goto(`${base}?autoplay=1&world=${world}&room=cost${Date.now().toString(36)}${gfx}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game?.tick > 90, null, { timeout: 90000 })
  await page.evaluate(() => {
    const s = window.mira, t = s.terrain, pad = t.data.layout.spawns[2]
    s.params.set('daydream.seconds', 0)
    const x = pad.x - pad.dirZ * 45, z = pad.z + pad.dirX * 45
    s.player.body.setTranslation({ x, y: t.heightAt(x, z) + 1.2, z }, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  })
  for (const cover of [1, 0]) {
    await page.evaluate((c) => window.mira.params.set('terrain.groundCover', c), cover)
    await page.waitForTimeout(2500)
    const r = await page.evaluate(() => new Promise((done) => {
      const times = []
      let last = performance.now()
      const step = () => {
        const now = performance.now()
        times.push(now - last); last = now
        if (times.length < 240) requestAnimationFrame(step)
        else {
          times.sort((a, b) => a - b)
          const i = window.mira.game.renderer.info.render
          done({ median: times[120], p95: times[228], draws: i.drawCalls, tris: i.triangles })
        }
      }
      requestAnimationFrame(step)
    }))
    rows.push({ world, cover, medianMs: +r.median.toFixed(2), p95Ms: +r.p95.toFixed(2), draws: r.draws, ktris: Math.round(r.tris / 1000) })
  }
}
await browser.close()
console.table(rows)
console.log(JSON.stringify({ errors }))
