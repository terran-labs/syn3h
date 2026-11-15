// Wind voice evidence in a browser. Nobody listens: an analyser on the master bus measures the
// level that reaches the speakers while the camera is held still or flown, in four scenes:
// a still camera on the summit in a gale, still in calm air, flying at 60 m/s in calm air,
// and flying on the airless Moon. Prints the camera airspeed, the voice's gain and the RMS.
//   SYN3H_NO_ROOM_SERVER=1 npx vite --port 5317 --strictPort
//   node tests/weather/wind-voice-capture.mjs [url] [chromium|webkit]
import { chromium, webkit } from 'playwright-core'
const base = process.argv[2] ?? 'http://localhost:5317/'
const engine = process.argv[3] ?? 'chromium'
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } }), errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=buggy`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
  await page.mouse.click(480, 300)
  await page.waitForFunction(() => window.syn3h.audio.state === 'running', null, { timeout: 20000 })
  await page.evaluate(() => {
    const s = window.syn3h, a = s.audio
    s.params.set('bots.count', 0); s.params.set('audio.music', 0); s.params.set('audio.engine', 0); s.params.set('audio.dirt', 0); s.params.set('audio.world', 0)
    s.game.remove(s.camera)
    const an = a.context.createAnalyser(); an.fftSize = 2048; a.master.connect(an); window.windProbe = an
  })
  const scene = async (label, setup, speed) => {
    await page.evaluate(async ([setup, speed]) => {
      const s = window.syn3h
      if (setup.planet) { const P = await import('/src/world/planets.ts'); P.applyPlanet(setup.planet, 1, { source: 'preset' }) }
      for (const k in setup.params ?? {}) s.params.set(k, setup.params[k])
      const v = s.terrain.summit(), cam = s.game.camera
      const y = setup.summit ? v.rimHeight + 6 : s.terrain.heightAt(v.x + 500, v.z) + 6
      cam.position.set(setup.summit ? v.x + v.rimRadius : v.x + 500, y, v.z)
      window.windFly && cancelAnimationFrame(window.windFly)
      let last = performance.now()
      const fly = (now) => { cam.position.z += speed * (now - last) / 1000; last = now; window.windFly = requestAnimationFrame(fly) }
      window.windFly = requestAnimationFrame(fly)
    }, [setup, speed])
    await page.waitForTimeout(3000)
    const r = await page.evaluate(() => {
      const a = window.syn3h.audio, w = a.weatherWind, an = window.windProbe, buf = new Float32Array(an.fftSize)
      let sum = 0, n = 0
      for (let i = 0; i < 10; i++) { an.getFloatTimeDomainData(buf); for (const x of buf) { sum += x * x; n++ } }
      return { airspeed: +w.airspeed.toFixed(1), gain: +w.level.gain.value.toFixed(3), pan: +w.pan.pan.value.toFixed(2), body: Math.round(w.body.frequency.value), rmsDb: +(10 * Math.log10(sum / n + 1e-12)).toFixed(1) }
    })
    results.push({ label, ...r }); console.log(JSON.stringify(results.at(-1)))
  }
  await scene('summit gale, still camera', { summit: true, params: { 'weather.storminess': 1 } }, 0)
  await scene('summit calm, still camera', { summit: true, params: { 'weather.storminess': 0 } }, 0)
  await scene('calm, camera at 60 m/s', { params: { 'weather.storminess': 0 } }, 60)
  await scene('Moon, camera at 60 m/s', { planet: 'moon', params: { 'weather.storminess': 1 } }, 60)
  const end = await page.evaluate(() => { window.syn3h.audio.dispose(); return window.syn3h.audio.diagnostics })
  console.log(JSON.stringify({ engine, afterDispose: end, errors }))
} finally { await browser.close() }
