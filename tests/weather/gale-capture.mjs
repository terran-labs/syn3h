// Wind evidence in a browser: a zorb ball and a plain buggy left alone on the volcano's upper
// slope, in still air and in a gale, with the weather system added to the running game the
// way main.ts will add it. Writes screenshots and prints the drift.
//   SYN3H_NO_ROOM_SERVER=1 npx vite --port 5317 --strictPort
//   node tests/weather/gale-capture.mjs [url] [outdir]
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://localhost:5317/'
const out = process.argv[3] ?? '/tmp/syn3h-weather/gale'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ticks = (page, n) => page.evaluate((n) => new Promise((r) => { const s = window.syn3h, t = s.game.tick + n; const f = () => s.game.tick >= t ? r() : requestAnimationFrame(f); f() }), n)
const results = []
try {
  for (const [label, zorb, storm] of [['zorb-still', true, 0], ['zorb-gale', true, 1], ['buggy-gale', false, 1]]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } }), errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&seed=3`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
    await page.evaluate(async () => {
      const s = window.syn3h
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 12); s.params.set('sun.dayLength', 0)
      const w = await import('/src/world/weather/index.ts')
      window.weather = w
      s.game.add(new w.WeatherSystem(() => s.terrain, () => [s.player]))
    })
    // Two thirds of the way up the volcano road: steep, high, open.
    const spot = await page.evaluate(() => {
      const s = window.syn3h, road = s.terrain.data.roads.find((r) => r.kind === 'volcano'), p = road.points[Math.floor(road.points.length * 0.8)]
      s.player.teleport({ x: p.x, y: p.y + 2, z: p.z }, 0); return { x: p.x, y: p.y, z: p.z }
    })
    await ticks(page, 60)
    if (zorb) { await page.keyboard.press('KeyX'); await ticks(page, 250) }
    const start = await page.evaluate((storm) => { const s = window.syn3h; s.params.set('weather.storminess', storm); const p = s.player.body.translation(); return { x: p.x, y: p.y, z: p.z } }, storm)
    let maxAccel = 0
    for (let i = 0; i < 8; i++) {
      await ticks(page, 25)
      maxAccel = Math.max(maxAccel, await page.evaluate(() => window.syn3h.player.wind.length()))
      if (i === 5) await page.screenshot({ path: `${out}/${label}.png` })
    }
    const end = await page.evaluate((start) => {
      const s = window.syn3h, w = window.weather, p = s.player.body.translation()
      const f = w.currentWindFrame(s.terrain), v = w.windAt(f, p.x, p.y, p.z, w.weatherTime(), { x: 0, y: 0, z: 0 })
      const n = Math.hypot(v.x, v.z) || 1, dx = p.x - start.x, dz = p.z - start.z
      return { moved: Math.hypot(dx, dz), downwind: (dx * v.x + dz * v.z) / n, wind: Math.hypot(v.x, v.z), climb: p.y - start.y, radius: s.player.zorb.radius }
    }, start)
    results.push({ label, spot, ...end, maxAccel, errors })
    console.log(JSON.stringify(results.at(-1)))
    await page.close()
  }
} finally { await browser.close() }
