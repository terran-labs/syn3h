// Aerial perspective evidence: the volcanic world from the rim looking out over the island,
// at weather.aerial 0, 1.5 and 3, at noon and in golden hour.
//   MIRA_NO_ROOM_SERVER=1 npx vite --port 5317 --strictPort
//   node tests/weather/aerial-capture.mjs [url] [outdir]
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://localhost:5317/'
const out = process.argv[3] ?? '/tmp/syn3h-weather/aerial'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ticks = (page, n) => page.evaluate((n) => new Promise((r) => { const s = window.mira, t = s.game.tick + n; const f = () => s.game.tick >= t ? r() : requestAnimationFrame(f); f() }), n)
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=buggy`)
  await page.waitForFunction(() => window.mira?.game.tick > 10, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.mira; s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0)
    s.game.remove(s.camera); s.shell?.hidePanel?.(); document.querySelectorAll('[class*=panel]').forEach((e) => { e.style.display = 'none' })
  })
  for (const [hour, levels] of [[12, [0, 1.5, 3]], [18.2, [0, 2]]]) {
    for (const a of levels) {
      await page.evaluate(([hour, a]) => {
        const s = window.mira, v = s.terrain.summit(), cam = s.game.camera
        s.params.set('sun.timeOfDay', hour); s.params.set('weather.aerial', a)
        cam.position.set(v.x, v.rimHeight + 160, v.z - v.rimRadius - 40)
        cam.lookAt(v.x, 0, v.z - 1100)
      }, [hour, a])
      await ticks(page, 40)
      await page.screenshot({ path: `${out}/rim-${hour}h-aerial${a}.png` })
    }
  }
  console.log(JSON.stringify({ errors }))
} finally { await browser.close() }
