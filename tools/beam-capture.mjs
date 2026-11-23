/**
 * Captures a tag beam at noon and at 23:00, to confirm it stays green when the sky's auto
 * exposure rises at night. Writes /tmp/syn3h-beam-12.png and /tmp/syn3h-beam-23.png and
 * prints the exposure, the dim factor applied, and the core colour as displayed
 * (material colour times exposure): the displayed green should be about the same at both
 * hours instead of several times brighter at night.
 *
 *   node tools/beam-capture.mjs [http://localhost:5183/]
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5183/'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
  await page.goto(`${base}?room=beam${Date.now() % 100000}&name=Beam&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.shell && window.miraNet, null, { timeout: 60000 })
  await page.evaluate(() => { window.mira.shell.play(); window.mira.params.set('laser.speed', 20) })
  for (const hour of [12, 23]) {
    await page.evaluate((hour) => window.mira.params.set('sun.timeOfDay', hour), hour)
    await wait(4000) // the exposure eases toward its new value
    // Send the beams diagonally across the view: straight ahead they hide behind the car.
    await page.evaluate(() => {
      const q = window.mira.player.body.rotation()
      const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      // Right of forward (-Z) is +X: rotate forward a quarter turn about +Y.
      const rx = -fz, rz = fx
      for (let i = 0; i < 4; i++) setTimeout(() => window.miraNet.fire([fx * 0.75 + rx * 0.65, 0.12, fz * 0.75 + rz * 0.65]), i * 150)
    })
    await wait(800)
    await page.screenshot({ path: `/tmp/syn3h-beam-${hour}.png` })
    const info = await page.evaluate(() => {
      const exposure = window.mira.game.renderer.toneMappingExposure
      const c = window.miraNet.lasers.coreMat.color
      return { exposure: +exposure.toFixed(3), core: [c.r, c.g, c.b].map((n) => +n.toFixed(3)), displayed: [c.r, c.g, c.b].map((n) => +(n * exposure).toFixed(3)), shots: window.miraNet.lasers.count }
    })
    console.log(JSON.stringify({ hour, ...info, dim: +(info.core[1] / 4).toFixed(3) }))
  }
} finally {
  await browser.close()
}
