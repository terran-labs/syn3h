// Sun beams capture. For each case: shafts off, "dark" (the sky has handed its near-sun glow to
// the shafts but they add none back) and on. The shafts' own light is on minus dark; the beam
// measure is its coefficient of variation on the sky half of circles round the sun's screen
// position: near 0 for a halo, high for beams. PHASE names the files; PHASE=base skips "dark"
// (for a checkout without the hand-off, such as feat/day-by-orbit).
//   SYN3H_URL=http://127.0.0.1:PORT/ PHASE=new [NOON=1] [OPEN=1] [PHONE=1] [QUALITY=4] node tests/ui/sun-beams-capture.mjs
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
/** The shafts' own light (on minus dark) on rings round the sun: mean and coefficient of variation. */
async function beams(darkFile, onFile, sun) {
  const a = await raw(darkFile), b = await raw(onFile)
  const rings = []
  for (const r of [0.08, 0.14, 0.2, 0.26]) {
    const vals = []
    for (let k = 0; k < 360; k++) { const t = Math.PI + k / 360 * Math.PI, x = sun.x * a.w + Math.cos(t) * r * a.h, y = sun.y * a.h + Math.sin(t) * r * a.h; if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue; vals.push(Math.max(0, lum(b, x, y) - lum(a, x, y))) }
    if (vals.length < 40) continue
    const m = vals.reduce((s, v) => s + v, 0) / vals.length, sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length)
    rings.push({ r, mean: +m.toFixed(1), cv: m > 0.5 ? +(sd / m).toFixed(2) : 0 })
  }
  return rings
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
    const lightOff = on => page.evaluate(on => { const c = window.syn3h.game.postChain; if (c && 'shaftLightOff' in c) c.shaftLightOff = on }, on)
    const shot = async (name, mode) => {
      if (mode === 'off') { await lightOff(false); await set('post.shafts', 0) }
      if (mode === 'dark') { await set('post.shafts', 1); await lightOff(true) }
      if (mode === 'on') { await lightOff(false); await set('post.shafts', 1) }
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
      const cam = s.game.camera, f = cam.getWorldDirection(new cam.position.constructor()); let best = 0, score = -Infinity
      for (let a = 0; a < 360; a++) { const d = sunDirection(hour, s.params.get('sun.tilt').value, a); const dot = (d[0] * f.x + d[2] * f.z) / Math.hypot(d[0], d[2]); if (dot > score) { score = dot; best = a } }
      s.params.set('sun.azimuth', best)
      if (pitch !== undefined) s.params.set('camera.pitch', pitch)
      await new Promise(r => setTimeout(r, 3000))
      const d = sunDirection(hour, s.params.get('sun.tilt').value, best), p = cam.position.clone().add(new cam.position.constructor(d[0], d[1], d[2]).multiplyScalar(1000)).project(cam)
      return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 }
    }, { planet, hour, quality, coverage, pitch })
    for (const [planet, hour] of cases) {
      const sun = await aim(planet, hour, 0.5)
      const name = `${planet}-${hour}-q${quality}${tag}`
      const off = await shot(name, 'off')
      const dark = phase === 'base' ? null : await shot(name, 'dark')
      const on = await shot(name, 'on')
      console.log(JSON.stringify({ case: name, phase, sun: { x: +sun.x.toFixed(3), y: +sun.y.toFixed(3) }, frameMs: { off: +off.ms.toFixed(1), on: +on.ms.toFixed(1) }, onVsOff: await diff(off.file, on.file), rings: dark ? await beams(dark.file, on.file, sun) : undefined }))
    }
    if (process.env.OPEN) {
      // An unobstructed low sun: no cloud, Archipelago's flat sea, the sun well above the horizon.
      const sun = await aim('archipelago', 17.25, 0)
      const name = `open-archipelago-17.25-q${quality}${tag}`
      const off = await shot(name, 'off'), on = await shot(name, 'on')
      console.log(JSON.stringify({ case: name, phase, sun: { x: +sun.x.toFixed(3), y: +sun.y.toFixed(3) }, onVsOff: await diff(off.file, on.file) }))
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
