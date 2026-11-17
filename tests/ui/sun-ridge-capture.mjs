// Sun rays at a ridge: the low sun behind a hill's ridge line must not fringe it with colour.
// Badlands seed 7, High, the day clock stopped, own buggy facing the hill (the setup the
// v26.11.1701 fault was found in), then one sunrise and one sunset elsewhere for the rays' look.
// For each frame, shafts off and on, and a fringe count: pixels where turning the shafts on
// pushes one colour channel up and another down by more than 20 of 255 (complementary fringes),
// counted over the scene and not the interface panels.
//   SYN3H_URL=http://127.0.0.1:PORT/ PHASE=after OUT=dir [VIEWPORT=phone] node tests/ui/sun-ridge-capture.mjs
import { chromium, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
const out = process.env.OUT ?? 'tests/ui/artifacts/sun-ridge', phase = process.env.PHASE ?? 'after'
await mkdir(out, { recursive: true })
const phone = process.env.VIEWPORT === 'phone'
const raw = async f => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height } }
async function fringe(offFile, onFile) {
  const a = await raw(offFile), b = await raw(onFile)
  let fringed = 0, sum = 0
  for (let i = 0; i < a.data.length; i += 3) {
    // The scene only: the panels at the right and the banners at the bottom change on their own.
    const p = i / 3, x = p % a.w, y = Math.floor(p / a.w)
    if (x >= a.w * 0.69 || y >= a.h * 0.87) continue
    const d = [b.data[i] - a.data[i], b.data[i + 1] - a.data[i + 1], b.data[i + 2] - a.data[i + 2]]
    if (Math.max(...d) > 20 && Math.min(...d) < -20) fringed++
    sum += Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2])
  }
  return { fringed, meanAbs: +(sum / a.data.length).toFixed(2) }
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const ctx = await browser.newContext(phone ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(level => localStorage.setItem('syn3h.quality.v2', JSON.stringify({ level, auto: false, pinned: true, overrides: {} })), phone ? 2 : 3)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const set = (id, v) => page.evaluate(([id, v]) => window.syn3h.params.set(id, v), [id, v])
  const shoot = async name => {
    const files = {}
    for (const mode of ['off', 'on']) {
      await set('post.shafts', mode === 'off' ? 0 : 1); await page.waitForTimeout(2500)
      files[mode] = `${out}/${name}-${mode === 'on' ? phase : 'off'}.png`; await page.screenshot({ path: files[mode] })
    }
    console.log(JSON.stringify({ frame: name, phase, ...(await fringe(files.off, files.on)) }))
  }
  const enter = async (planet, seed) => {
    await page.goto(`${process.env.SYN3H_URL}?${process.env.WEBGL ? "webgl=1&" : ""}room=ridge-${Date.now().toString(36)}&autoplay=1&planet=${planet}&seed=${seed}`)
    await page.waitForFunction(() => window.syn3h?.player?.wheelsGrounded > 0, null, { timeout: 180000 })
    await page.evaluate(() => { const s = window.syn3h.params; s.set('daydream.seconds', 0); s.set('bots.count', 0); s.set('sun.dayLength', 0); s.set('weather.cloudSpeed', 0) })
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '[class*=update-banner]{display:none!important}'; document.head.append(st) })
  }
  const tag = (phone ? 'phone' : 'desktop') + (process.env.WEBGL ? '-webgl2' : '')
  await enter('badlands', 7)
  for (const h of [16.43, 16.63]) { await set('sun.timeOfDay', h); await page.waitForTimeout(3000); await shoot(`badlands7-${tag}-${h}`) }
  if (!phone) {
    // The approved look elsewhere: a sunrise and a sunset, facing the sun.
    for (const [planet, hour] of [['archipelago', 17.25], ['ice', 6.4]]) {
      await enter(planet, 12345); await set('sun.timeOfDay', hour); await page.waitForTimeout(2000)
      await page.evaluate(async hour => {
        const s = window.syn3h, { sunDirection } = await import('/src/world/sky/skyMath.ts'), cam = s.game.camera, f = cam.getWorldDirection(new cam.position.constructor())
        let best = 0, score = -Infinity
        for (let a = 0; a < 360; a++) { const d = sunDirection(hour, s.params.get('sun.tilt').value, a); const dot = (d[0] * f.x + d[2] * f.z) / Math.hypot(d[0], d[2]); if (dot > score) { score = dot; best = a } }
        s.params.set('sun.azimuth', best); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
      }, hour)
      await page.waitForTimeout(3000); await shoot(`${planet}-${tag}-${hour}`)
    }
  }
  if (errors.length) console.log('errors', JSON.stringify(errors))
} finally { await browser.close() }
