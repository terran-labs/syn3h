// Sun beams capture. For each case: shafts off and on, at 1440x900 by default. Per ring round
// the sun's screen position (radius in screen heights, sky half only):
//   added   mean of on minus off (signed, /255): the burst moves light both ways
//   swing   standard deviation of on minus off (/255): how strongly the streaks differ
//   cvFixed swing over a fixed reference of 25.5 (10% of full scale), so a tiny mean cannot
//           flatter it; well above 1 is a strong burst
//   cvOn, cvOff  coefficient of variation of the final frame's luminance on the ring, on and off
// PHASE names the files (base for a checkout without the burst). TURN=1 adds the world-anchoring
// check: two frames with the camera turned 30 degrees between them, compared by the streak
// profile round the sun.
//   SYN3H_URL=http://127.0.0.1:PORT/ PHASE=new [NOON=1] [OPEN=1] [PHONE=1] [TURN=1] [QUALITY=4] [COVER=0.5] node tests/ui/sun-beams-capture.mjs
import { chromium, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
const out = process.env.OUT ?? 'tests/ui/artifacts/sun-beams', phase = process.env.PHASE ?? 'new'
await mkdir(out, { recursive: true })
const CASES = (process.env.CASES ?? 'volcanic:6.25,archipelago:17.5,ice:6.5').split(',').map(c => { const [p, h] = c.split(':'); return [p, Number(h)] })
const raw = async f => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height } }
const lum = (img, x, y) => { const i = (Math.round(y) * img.w + Math.round(x)) * 3; return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2] }
/** Mean and largest absolute per-channel difference between two frames, 0..255. */
async function diff(fa, fb) {
  const a = await raw(fa), b = await raw(fb)
  let sum = 0, max = 0
  for (let k = 0; k < a.data.length; k++) { const d = Math.abs(b.data[k] - a.data[k]); sum += d; if (d > max) max = d }
  return { meanAbs: +(sum / a.data.length).toFixed(2), max }
}
const ringAt = (img, sun, r, k, n, full) => { const t = full ? k / n * 2 * Math.PI : Math.PI + k / n * Math.PI; return [sun.x * img.w + Math.cos(t) * r * img.h, sun.y * img.h + Math.sin(t) * r * img.h] }
const inside = (img, [x, y]) => x >= 0 && y >= 0 && x < img.w && y < img.h
const stats = v => { const m = v.reduce((s, x) => s + x, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) } }
async function beams(offFile, onFile, sun) {
  const a = await raw(offFile), b = await raw(onFile)
  const rings = []
  for (const r of [0.08, 0.14, 0.2, 0.26]) {
    const d = [], on = [], off = []
    for (let k = 0; k < 360; k++) { const p = ringAt(a, sun, r, k, 360, false); if (!inside(a, p)) continue; const lo = lum(a, ...p), lb = lum(b, ...p); d.push(lb - lo); on.push(lb); off.push(lo) }
    if (d.length < 40) continue
    const sd = stats(d), so = stats(on), sf = stats(off)
    rings.push({ r, added: +sd.m.toFixed(1), swing: +sd.sd.toFixed(1), cvFixed: +(sd.sd / 25.5).toFixed(2), cvOn: +(so.sd / Math.max(so.m, 1)).toFixed(3), cvOff: +(sf.sd / Math.max(sf.m, 1)).toFixed(3) })
  }
  return rings
}
/** On minus off round a full circle, for comparing two camera headings. */
async function profile(offFile, onFile, sun, r) {
  const a = await raw(offFile), b = await raw(onFile), v = []
  for (let k = 0; k < 360; k++) { const p = ringAt(a, sun, r, k, 360, true); v.push(inside(a, p) ? lum(b, ...p) - lum(a, ...p) : NaN) }
  return v
}
function correlate(x, y, shift = 0) {
  const pairs = []
  for (let k = 0; k < x.length; k++) { const a = x[k], b = y[(k + shift) % y.length]; if (Number.isFinite(a) && Number.isFinite(b)) pairs.push([a, b]) }
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length
  let sxy = 0, sxx = 0, syy = 0
  for (const [a, b] of pairs) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2 }
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(2)
}
const settle = ms => new Promise(r => setTimeout(r, ms))
async function run(device, quality, cases, tag) {
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true })
  try {
    const page = await browser.newPage(device ?? { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=beams-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 180000 })
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '.world-inspector,.shell-hud,.hud-navigation,[class*=focus],[class*=gear],[class*=hint],[class*=toast],[class*=minimap],[class*=touch],[class*=zorb],[class*=nameplate],[class*=reload],[class*=build-notice],[class*=update]{visibility:hidden!important}[class*=update-banner]{display:none!important}'; document.head.append(st); window.syn3h.game.input.external.brakes = true })
    const frames = async () => page.evaluate(() => new Promise(res => { const t = []; let last = performance.now(); const step = now => { t.push(now - last); last = now; if (t.length < 90) requestAnimationFrame(step); else res(t.sort((a, b) => a - b)[45]) }; requestAnimationFrame(step) }))
    const set = (id, v) => page.evaluate(([id, v]) => window.syn3h.params.set(id, v), [id, v])
    const shot = async (name, mode) => {
      await set('post.shafts', mode === 'off' ? 0 : 1)
      await page.waitForTimeout(2000)
      const ms = await frames(), file = `${out}/${name}-${mode === 'on' ? phase : mode}.png`
      await page.screenshot({ path: file })
      return { file, ms }
    }
    const aim = (planet, hour, coverage, pitch) => page.evaluate(async ({ planet, hour, quality, coverage, pitch }) => {
      const s = window.syn3h, { applyPlanet } = await import('/src/world/planets.ts'), { sunDirection } = await import('/src/world/sky/skyMath.ts')
      applyPlanet(planet, 12345); s.params.set('bots.count', 0); s.params.set('gfx.auto', false); s.params.set('gfx.quality', quality)
      s.params.set('weather.cloudCoverage', coverage); s.params.set('weather.cloudSpeed', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
      await new Promise(r => setTimeout(r, 5000))
      // Applying a planet resets the day clock a moment later: set the hour again once it has.
      s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
      await new Promise(r => setTimeout(r, 1500))
      s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
      const cam = s.game.camera, f = cam.getWorldDirection(new cam.position.constructor()); let best = 0, score = -Infinity
      for (let a = 0; a < 360; a++) { const d = sunDirection(hour, s.params.get('sun.tilt').value, a); const dot = (d[0] * f.x + d[2] * f.z) / Math.hypot(d[0], d[2]); if (dot > score) { score = dot; best = a } }
      s.params.set('sun.azimuth', best)
      if (pitch !== undefined) s.params.set('camera.pitch', pitch)
      await new Promise(r => setTimeout(r, 3000))
      const d = sunDirection(hour, s.params.get('sun.tilt').value, best), p = cam.position.clone().add(new cam.position.constructor(d[0], d[1], d[2]).multiplyScalar(1000)).project(cam)
      const { currentHour } = await import('/src/world/sky/dayCycle.ts')
      return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5, hour: currentHour() }
    }, { planet, hour, quality, coverage, pitch })
    for (const [planet, hour] of cases) {
      const sun = await aim(planet, hour, Number(process.env.COVER ?? 0.5))
      const name = `${planet}-${hour}-q${quality}${tag}`
      const off = await shot(name, 'off')
      const on = await shot(name, 'on')
      const hourNow = await page.evaluate(async () => (await import('/src/world/sky/dayCycle.ts')).currentHour())
      console.log(JSON.stringify({ case: name, phase, hourSet: +sun.hour.toFixed(2), hourAfter: +hourNow.toFixed(2), sun: { x: +sun.x.toFixed(3), y: +sun.y.toFixed(3) }, frameMs: { off: +off.ms.toFixed(1), on: +on.ms.toFixed(1) }, onVsOff: await diff(off.file, on.file), rings: await beams(off.file, on.file, sun) }))
    }
    if (process.env.TURN) {
      // The burst stays put in the world: turn the chase camera 30 degrees and compare the streak
      // profile round the sun. Correlation near 1 at the matching angle, lower when shifted.
      // Open sky, so the comparison is the burst itself, not different occluders.
      const [planet, hour] = ['archipelago', 17.25]
      await aim(planet, hour, 0)
      await set('camera.autoDelay', 10)
      const sunNow = () => page.evaluate(async ({ hour }) => {
        const s = window.syn3h, { sunDirection } = await import('/src/world/sky/skyMath.ts'), cam = s.game.camera
        const d = sunDirection(hour, s.params.get('sun.tilt').value, s.params.get('sun.azimuth').value), p = cam.position.clone().add(new cam.position.constructor(d[0], d[1], d[2]).multiplyScalar(1000)).project(cam)
        return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5, heading: Math.atan2(cam.getWorldDirection(new cam.position.constructor()).x, cam.getWorldDirection(new cam.position.constructor()).z) * 180 / Math.PI }
      }, { hour })
      const turn = async dx => { await page.evaluate(dx => { for (let i = 0; i < 10; i++) window.dispatchEvent(new CustomEvent('syn3h:look', { detail: { dx: dx / 10, dy: 0 } })) }, dx); await page.waitForTimeout(600) }
      const name = `turn-${planet}-${hour}-q${quality}${tag}`
      await turn(-90); const sunA = await sunNow()
      const offA = await shot(`${name}-a`, 'off'), onA = await shot(`${name}-a`, 'on')
      // Find the look travel that turns the view 30 degrees, then turn back the other way.
      await turn(180); const probe = await sunNow(); const perPx = Math.abs(probe.heading - sunA.heading) / 180
      await turn(30 / Math.max(perPx, 1e-3) - 180); const sunB = await sunNow()
      const offB = await shot(`${name}-b`, 'off'), onB = await shot(`${name}-b`, 'on')
      const pa = await profile(offA.file, onA.file, sunA, 0.1), pb = await profile(offB.file, onB.file, sunB, 0.1)
      console.log(JSON.stringify({ case: name, phase, headingChange: +Math.abs(sunB.heading - sunA.heading).toFixed(1), sunA: { x: +sunA.x.toFixed(3), y: +sunA.y.toFixed(3) }, sunB: { x: +sunB.x.toFixed(3), y: +sunB.y.toFixed(3) }, correlation: correlate(pa, pb), shifted20deg: correlate(pa, pb, 20), shifted90deg: correlate(pa, pb, 90) }))
    }
    if (process.env.OPEN) {
      // An unobstructed low sun: no cloud, Archipelago's flat sea, the sun well above the horizon.
      const sun = await aim('archipelago', 17.25, 0)
      const name = `open-archipelago-17.25-q${quality}${tag}`
      const off = await shot(name, 'off'), on = await shot(name, 'on')
      // Stability: the same view 1.5 s later (drift and temporal noise only).
      const later = `${out}/${name}-${phase}-later.png`; await page.waitForTimeout(1500); await page.screenshot({ path: later })
      console.log(JSON.stringify({ case: name, phase, sun: { x: +sun.x.toFixed(3), y: +sun.y.toFixed(3) }, onVsOff: await diff(off.file, on.file), onVsLater: await diff(on.file, later), rings: await beams(off.file, on.file, sun) }))
    }
    if (process.env.NOON) {
      await set('sun.timeOfDay', 12); await set('weather.cloudCoverage', 0.15); await page.waitForTimeout(4000)
      const a = await shot(`noon-q${quality}${tag}`, 'off'), a2 = `${out}/noon-q${quality}${tag}-off2.png`
      await page.waitForTimeout(1500); await page.screenshot({ path: a2 })
      const b = await shot(`noon-q${quality}${tag}`, 'on')
      console.log(JSON.stringify({ case: 'noon', phase, noise: await diff(a.file, a2), onVsOff: await diff(a.file, b.file) }))
    }
    if (errors.length) console.log('errors', JSON.stringify(errors))
  } finally { await browser.close() }
}
const quality = Number(process.env.QUALITY ?? 4)
if (!process.env.PHONE_ONLY) await run(null, quality, CASES, '')
if (process.env.PHONE || process.env.PHONE_ONLY) await run(devices['iPhone 14'], 2, [CASES[0]], '-phone')
