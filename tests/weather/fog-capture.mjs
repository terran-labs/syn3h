// Fog evidence: the view from spawn pad 0 toward the volcano on each planet, with the height
// fog and with it off, at the default roundness and at noon.
//   SYN3H_NO_ROOM_SERVER=1 npx vite --port 5317 --strictPort
//   node tests/weather/fog-capture.mjs [url] [outdir] [planet,planet]
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://localhost:5317/'
const out = process.argv[3] ?? '/tmp/syn3h-weather/fog'
const only = process.argv[4]?.split(',')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ticks = (page, n) => page.evaluate((n) => new Promise((r) => { const s = window.syn3h, t = s.game.tick + n; const f = () => s.game.tick >= t ? r() : requestAnimationFrame(f); f() }), n)
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=buggy`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
  const ids = await page.evaluate(async () => (await import('/src/world/planets.ts')).PLANETS.map((p) => p.id))
  for (const id of ids.filter((i) => !only || only.includes(i))) {
    await page.evaluate(async (id) => {
      const s = window.syn3h, P = await import('/src/world/planets.ts')
      P.applyPlanet(id, 1, { source: 'preset' })
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 12); s.params.set('sun.dayLength', 0)
    }, id)
    await ticks(page, 120)
    await page.evaluate(() => {
      const s = window.syn3h, sp = s.terrain.spawnPoint(0), v = s.terrain.summit?.()
      const heading = v ? Math.atan2(-(v.x - sp.position.x), -(v.z - sp.position.z)) : sp.heading
      s.player.teleport(sp.position, heading)
    })
    await ticks(page, 150)
    const density = await page.evaluate(() => window.syn3h.params.get('weather.hazeDensity').value)
    await page.screenshot({ path: `${out}/${id}-fog.png` })
    await page.evaluate(() => window.syn3h.params.set('weather.hazeDensity', 0, 'preset'))
    await ticks(page, 20)
    await page.screenshot({ path: `${out}/${id}-nofog.png` })
    console.log(JSON.stringify({ id, density, errors: errors.splice(0) }))
  }
} finally { await browser.close() }
