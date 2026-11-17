// Sun beams: for each case, shafts off and on, the change shafts make, and a beam measure: the
// coefficient of variation of the shafts' own brightness (on minus off) on circles round the
// sun's screen position. Near 0 for a halo, high for beams. PHASE names the output files.
// SYN3H_URL=http://127.0.0.1:PORT/ PHASE=after node tests/ui/sun-beams-capture.mjs
import { chromium, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
const out = process.env.OUT ?? 'tests/ui/artifacts/sun-beams', phase = process.env.PHASE ?? 'after'
await mkdir(out, { recursive: true })
const CASES = [['volcanic', 6.25], ['archipelago', 17.5], ['ice', 6.5]]
const raw = async f => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height } }
async function measure(offFile, onFile, sun) {
  const a = await raw(offFile), b = await raw(onFile)
  let sum = 0, max = 0
  for (let k = 0; k < a.data.length; k++) { const d = b.data[k] - a.data[k]; sum += Math.abs(d); if (d > max) max = d }
  const lum = (img, x, y) => { const i = (Math.round(y) * img.w + Math.round(x)) * 3; return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2] }
  const rings = []
  for (const r of [0.1, 0.18, 0.26]) {
    const vals = []
    for (let k = 0; k < 360; k++) { const t = Math.PI + k / 360 * Math.PI, x = sun.x * a.w + Math.cos(t) * r * a.h, y = sun.y * a.h + Math.sin(t) * r * a.h; if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue; vals.push(Math.max(0, lum(b, x, y) - lum(a, x, y))) }
    if (vals.length < 40) continue
    const m = vals.reduce((s, v) => s + v, 0) / vals.length, sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length)
    rings.push({ r, mean: +m.toFixed(1), cv: m > 0.5 ? +(sd / m).toFixed(2) : 0 })
  }
  return { meanAbs: +(sum / a.data.length).toFixed(2), maxBrighter: max, rings }
}
async function run(device, quality, cases, tag) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage(device ?? { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=beams-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '.world-inspector,.shell-hud,.hud-navigation,[class*=focus],[class*=gear],[class*=hint],[class*=toast],[class*=minimap],[class*=touch],[class*=zorb]{visibility:hidden!important}'; document.head.append(st); window.syn3h.game.input.external.brakes = true })
    for (const [planet, hour] of cases) {
      const sun = await page.evaluate(async ({ planet, hour, quality }) => {
        const s = window.syn3h, { applyPlanet } = await import('/src/world/planets.ts'), { sunDirection } = await import('/src/world/sky/skyMath.ts')
        applyPlanet(planet, 12345); s.params.set('bots.count', 0); s.params.set('gfx.auto', false); s.params.set('gfx.quality', quality)
        s.params.set('weather.cloudCoverage', 0.5); s.params.set('weather.cloudSpeed', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
        await new Promise(r => setTimeout(r, 5000))
        const cam = s.game.camera, f = cam.getWorldDirection(new cam.position.constructor()); let best = 0, score = -Infinity
        for (let a = 0; a < 360; a++) { const d = sunDirection(hour, s.params.get('sun.tilt').value, a); const dot = (d[0] * f.x + d[2] * f.z) / Math.hypot(d[0], d[2]); if (dot > score) { score = dot; best = a } }
        s.params.set('sun.azimuth', best)
        await new Promise(r => setTimeout(r, 3000))
        const d = sunDirection(hour, s.params.get('sun.tilt').value, best), p = cam.position.clone().add(new cam.position.constructor(d[0], d[1], d[2]).multiplyScalar(1000)).project(cam)
        return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 }
      }, { planet, hour, quality })
      const frames = async () => page.evaluate(() => new Promise(res => { const t = []; let last = performance.now(); const step = now => { t.push(now - last); last = now; if (t.length < 90) requestAnimationFrame(step); else res(t.sort((a, b) => a - b)[45]) }; requestAnimationFrame(step) }))
      const name = `${planet}-${hour}-q${quality}${tag}`
      await page.evaluate(() => window.syn3h.params.set('post.shafts', 0)); await page.waitForTimeout(2500)
      const offMs = await frames(); const off = `${out}/${name}-off.png`; await page.screenshot({ path: off })
      await page.evaluate(() => window.syn3h.params.set('post.shafts', 1)); await page.waitForTimeout(2500)
      const onMs = await frames(); const on = `${out}/${name}-${phase}.png`; await page.screenshot({ path: on })
      console.log(JSON.stringify({ case: name, phase, sun: { x: +sun.x.toFixed(3), y: +sun.y.toFixed(3) }, frameMs: { off: +offMs.toFixed(1), on: +onMs.toFixed(1) }, ...(await measure(off, on, sun)) }))
    }
    if (process.env.NOON) {
      await page.evaluate(() => { const s = window.syn3h; s.params.set('sun.timeOfDay', 12); s.params.set('weather.cloudCoverage', 0.15) }); await page.waitForTimeout(4000)
      const a = `${out}/noon-${phase}-a.png`, b = `${out}/noon-${phase}-b.png`; await page.screenshot({ path: a }); await page.waitForTimeout(1500); await page.screenshot({ path: b })
      console.log(JSON.stringify({ case: 'noon', phase, files: [a, b] }))
    }
    if (errors.length) console.log('errors', JSON.stringify(errors))
  } finally { await browser.close() }
}
await run(null, 4, CASES, '')
if (process.env.PHONE) await run(devices['iPhone 14'], 2, [CASES[0]], '-phone')
