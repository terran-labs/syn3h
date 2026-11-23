/**
 * Does the round world bend about this frame's camera, or last frame's?
 *
 *   tools/heavy.sh node tools/curve-lag-check.mjs http://127.0.0.1:5186/
 *
 * The planet curve is a mapping centred under the camera. If it is refreshed before the
 * camera moves, the world is drawn bent about where the camera was, and at speed the far
 * ground shimmers. This flies the jet fast and, after every rendered frame, asks the curve
 * how far its centre is from the camera (the jet is carried at 60 m/s for the purpose): the sea surface under the camera is drawn exactly
 * at its true height only when the centre is the camera, so the drop there gives the lag.
 * Prints the speed reached and the worst and median lag in metres. Zero is right.
 */
import { chromium } from 'playwright-core'
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5186/')
url.searchParams.set('autoplay', '1'); url.searchParams.set('vehicle', 'jet'); url.searchParams.set('daydream', '0')
url.searchParams.set('room', `curve-${Date.now()}`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url.href)
  await page.waitForFunction(() => window.mira?.game?.tick > 10, null, { timeout: 90000 })
  await page.evaluate(() => { window.mira.shell?.play(); document.activeElement?.blur?.() })
  const result = await page.evaluate(async () => {
    const s = window.mira, curve = window.__miraCurve
    if (!curve) throw new Error('window.__miraCurve is not exposed by this build')
    // Carry the jet along at a steady 60 m/s, 80 m up, through its physics body. How it
    // gets its speed does not matter here: only that the camera has to keep up with it.
    const p = s.player.body.translation()
    s.player.teleport({ x: p.x, y: s.terrain.heightAt(p.x, p.z) + 80, z: p.z }, 0)
    s.game.add({ fixedUpdate() { s.player.body.setLinvel({ x: 42.4, y: 0, z: 42.4 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true) } })
    await new Promise(r => setTimeout(r, 4000))
    const R = 1 / curve.curveFactor(), lags = [], speeds = []
    await new Promise(done => {
      let frames = 0
      const sample = () => {
        const c = s.game.camera.position, v = s.player.body.linvel()
        const drop = Math.abs(curve.curveDrop(c.x, c.z))
        lags.push(Math.sqrt(2 * R * drop)); speeds.push(Math.hypot(v.x, v.y, v.z))
        if (++frames < 240) requestAnimationFrame(sample); else done()
      }
      requestAnimationFrame(sample)
    })
    lags.sort((a, b) => a - b); speeds.sort((a, b) => a - b)
    return { radius: R, frames: lags.length, speedMedian: speeds[120], speedMax: speeds.at(-1), lagMedian: lags[120], lagMax: lags.at(-1), fps: s.game.fps }
  })
  console.log(JSON.stringify({ ...result, errors }, null, 1))
} finally { await browser.close() }
