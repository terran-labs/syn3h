// Sun shafts: off, the old mask (post.shaftFloor 0) and the floored mask, with the sun behind
// terrain and broken cloud, plus a noon frame and a fully visible sun. Reports pixel changes.
// SYN3H_URL=http://127.0.0.1:PORT/ node tests/ui/shaft-beams-capture.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
const out = process.env.OUT ?? 'tests/ui/artifacts/shaft-beams'
await mkdir(out, { recursive: true })
const diff = async (a, b) => { const [x, y] = await Promise.all([a, b].map(f => sharp(f).removeAlpha().raw().toBuffer())); let sum = 0, max = 0, clipped = 0; for (let k = 0; k < x.length; k++) { const d = y[k] - x[k]; sum += Math.abs(d); if (d > max) max = d; if (y[k] >= 254 && x[k] < 254) clipped++ } return { meanAbs: +(sum / x.length).toFixed(2), maxBrighter: max, newlyClipped: clipped } }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=beams-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden' })
  await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '.world-inspector,.shell-hud,.hud-navigation,[class*=focus],[class*=gear],[class*=hint],[class*=toast],[class*=minimap]{visibility:hidden!important}'; document.head.append(st); window.syn3h.game.input.external.brakes = true })
  const shot = async (name, values) => { await page.evaluate(v => { for (const [k, x] of Object.entries(v)) window.syn3h.params.set(k, x) }, values); await page.waitForTimeout(3000); const f = `${out}/${name}.png`; await page.screenshot({ path: f }); return f }
  const aim = (hour, sun) => page.evaluate(async ({ hour, sun }) => {
    const s = window.syn3h, { sunDirection } = await import('/src/world/sky/skyMath.ts')
    s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
    const f = s.game.camera.getWorldDirection(new s.game.camera.position.constructor()); let best = 0, score = -Infinity
    for (let a = 0; a < 360; a++) { const d = sunDirection(hour, s.params.get('sun.tilt').value, a); const dot = (d[0] * f.x + d[2] * f.z) / Math.hypot(d[0], d[2]) * (sun === 'away' ? -1 : 1); if (dot > score) { score = dot; best = a } }
    s.params.set('sun.azimuth', best)
  }, { hour, sun })
  for (const planet of ['volcanic', 'archipelago', 'ice']) {
    await page.evaluate(async planet => { const s = window.syn3h; const { applyPlanet } = await import('/src/world/planets.ts'); applyPlanet(planet, 12345); s.params.set('bots.count', 0); s.params.set('gfx.auto', false); s.params.set('weather.cloudCoverage', 0.5) }, planet)
    await page.waitForTimeout(5000)
    for (const quality of [3, 4]) for (const hour of [6.25, 18]) {
      await page.evaluate(q => window.syn3h.params.set('gfx.quality', q), quality); await aim(hour, 'toward')
      const tag = `${planet}-${hour}-q${quality}`
      const off = await shot(`${tag}-off`, { 'post.shafts': 0 })
      const before = await shot(`${tag}-before`, { 'post.shafts': 1, 'post.shaftFloor': 0 })
      const after = await shot(`${tag}-after`, { 'post.shafts': 1, 'post.shaftFloor': 0.8 })
      console.log(tag, 'before vs off', JSON.stringify(await diff(off, before)), 'after vs off', JSON.stringify(await diff(off, after)))
    }
  }
  // Noon, open sky, and a fully visible mid-morning sun: before against after.
  for (const [name, hour, sun] of [['noon', 12, 'toward'], ['open-sun', 9, 'toward']]) {
    await page.evaluate(() => { window.syn3h.params.set('gfx.quality', 4); window.syn3h.params.set('weather.cloudCoverage', 0.15) }); await aim(hour, sun)
    const before = await shot(`archipelago-${name}-before`, { 'post.shafts': 1, 'post.shaftFloor': 0 })
    const after = await shot(`archipelago-${name}-after`, { 'post.shafts': 1, 'post.shaftFloor': 0.8 })
    const again = await shot(`archipelago-${name}-after2`, { 'post.shafts': 1, 'post.shaftFloor': 0.8 })
    console.log(name, 'after vs before', JSON.stringify(await diff(before, after)), 'noise (after vs after)', JSON.stringify(await diff(after, again)))
  }
  console.log('errors', JSON.stringify(errors))
} finally { await browser.close() }
