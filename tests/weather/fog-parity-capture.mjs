// Fog parity evidence: fixed views of the volcanic world with everything that moves held
// still (clock, clouds, bots), for comparing the picture before and after a fog shader change.
//   SYN3H_NO_ROOM_SERVER=1 npx vite --port 5317 --strictPort
//   node tests/weather/fog-parity-capture.mjs [url] [outdir]
// Run once on each build into two folders, then compare the PNGs pixel by pixel.
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://localhost:5317/'
const out = process.argv[3] ?? '/tmp/syn3h-weather/parity'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ticks = (page, n) => page.evaluate((n) => new Promise((r) => { const s = window.syn3h, t = s.game.tick + n; const f = () => s.game.tick >= t ? r() : requestAnimationFrame(f); f() }), n)
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=buggy`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.syn3h
    for (const [id, v] of [['bots.count', 0], ['sun.dayLength', 0], ['weather.cloudSpeed', 0], ['weather.cloudCoverage', 0], ['weather.storminess', 0], ['fx.particleBudget', 0]]) { try { s.params.set(id, v) } catch { /* not on this build */ } }
    s.game.remove(s.camera); s.shell?.hidePanel?.()
    const style = document.createElement('style'); style.textContent = 'body > *:not(canvas) { display: none !important }'; document.head.append(style)
  })
  // Views: from above the rim looking out, low over the shore looking at the cone, and from
  // high altitude looking down, at noon and in golden hour (the sun lobe).
  const views = { rim: [0, 160, -40, 0, -1100], shore: [900, -1, 0, 0, 0], high: [0, 700, -600, -0.9, 400] }
  for (const hour of [12, 18.2]) {
    for (const [name, [dx, up, dz, lookUp, lookDz]] of Object.entries(views)) {
      await page.evaluate(([hour, dx, up, dz, lookUp, lookDz]) => {
        const s = window.syn3h, v = s.terrain.summit(), cam = s.game.camera
        s.params.set('sun.timeOfDay', hour); s.params.set('weather.aerial', 1.5)
        const x = v.x + dx, z = v.z - v.rimRadius + dz
        const y = up < 0 ? Math.max(s.terrain.heightAt(x, z), s.params.get('world.lavaAltitude')?.value ?? 0) + 30 : v.rimHeight + up
        cam.position.set(x, y, z)
        if (lookUp < 0) cam.lookAt(v.x, 0, v.z + lookDz); else if (dx) cam.lookAt(v.x, v.rimHeight * 0.6, v.z); else cam.lookAt(v.x, 0, v.z + lookDz)
      }, [hour, dx, up, dz, lookUp, lookDz])
      // Long enough for the auto exposure to settle after the hour changes.
      await ticks(page, 300)
      await page.screenshot({ path: `${out}/${name}-${hour}h.png` })
    }
  }
  console.log(JSON.stringify({ errors }))
} finally { await browser.close() }
