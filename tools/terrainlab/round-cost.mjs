/**
 * What a round world costs to draw: draw calls and triangles per frame from the driver's
 * seat and from the air, flat against round, for one or more planet sizes.
 *
 *   node tools/terrainlab/round-cost.mjs [baseUrl] [sizes, e.g. 0,1,2]
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5191/'
const sizes = (process.argv[3] ?? '1').split(',').map(Number)
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
for (const size of sizes) {
  await page.goto(`${base}?autoplay=1&world=volcanic.7~terrain.planetSize=${size}&room=cost${Date.now().toString(36)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 90000 })
  await page.evaluate(() => {
    const g = window.syn3h.game
    const orig = g.renderer.render.bind(g.renderer)
    window.__lift = 0
    g.renderer.render = (scene, cam) => { if (window.__lift) { cam.position.y += window.__lift; cam.lookAt(cam.position.x + 1, cam.position.y - window.__lift * 0.8, cam.position.z); cam.updateMatrixWorld() } return orig(scene, cam) }
  })
  const read = async (curve, lift) => {
    await page.evaluate(([c, l]) => { window.syn3h.params.set('world.curve', c); window.__lift = l }, [curve, lift])
    await page.waitForTimeout(2500)
    return page.evaluate(() => { const i = window.syn3h.game.renderer.info.render; return `${i.drawCalls} draws, ${Math.round(i.triangles / 1000)}k triangles` })
  }
  console.log(`planet size ${size}:`)
  console.log(`  driver's seat   flat ${await read(0, 0)}   round ${await read(1, 0)}`)
  console.log(`  300 m up        flat ${await read(0, 300)}   round ${await read(1, 300)}`)
}
await browser.close()
if (errors.length) console.log('errors', errors)
