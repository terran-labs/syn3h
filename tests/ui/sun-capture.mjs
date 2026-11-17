// The sky at chosen hours on chosen planets, camera toward and away from the sun, at Ultra.
// SYN3H_URL=http://127.0.0.1:PORT/ OUT=dir PLANETS=ice,volcanic HOURS=6,18 node tests/ui/sun-capture.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
// Foreground level: mean sRGB of the lower middle of the frame, 0 to 1.
const foreground = async file => { const { width, height } = await sharp(file).metadata(); const s = await sharp(file).extract({ left: Math.round(width * 0.2), top: Math.round(height * 0.58), width: Math.round(width * 0.6), height: Math.round(height * 0.4) }).stats(); return +(s.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3 / 255).toFixed(3) }
const out = process.env.OUT ?? 'tests/ui/artifacts/sun'
const planets = (process.env.PLANETS ?? 'ice,volcanic,archipelago,desert').split(',')
const hours = (process.env.HOURS ?? '5.5,6,6.5,12,17.5,18,18.5,0').split(',').map(Number)
const dirs = (process.env.DIRS ?? 'toward,away').split(',')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=sun-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden' })
  await page.evaluate(async () => {
    const s = window.syn3h; s.params.set('bots.count', 0); s.params.set('gfx.auto', false); s.params.set('gfx.quality', 4)
    try { (await import('/src/ui/quality/ladder.ts')).setQualityChoice('full') } catch {}
    s.game.input.external.brakes = true
    const style = document.createElement('style'); style.textContent = '.world-inspector,.shell-hud,.hud-navigation,.focus-hud,.gear-rail,.minimap,[class*=hint],[class*=toast]{visibility:hidden!important}'; document.head.append(style)
  })
  for (const planet of planets) {
    await page.evaluate(async planet => { const { applyPlanet } = await import('/src/world/planets.ts'); applyPlanet(planet, 12345); window.syn3h.params.set('bots.count', 0) }, planet)
    await page.waitForTimeout(5000)
    for (const hour of hours) for (const dir of dirs) {
      const info = await page.evaluate(async ({ hour, dir }) => {
        const s = window.syn3h, { sunDirection } = await import('/src/world/sky/skyMath.ts')
        s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', hour)
        const f = s.game.camera.getWorldDirection(new s.game.camera.position.constructor())
        const tilt = s.params.get('sun.tilt').value
        let best = 0, score = -Infinity
        for (let a = 0; a < 360; a += 1) { const d = sunDirection(Math.abs(hour - 12) < 0.01 ? 9 : hour, tilt, a); const h = Math.hypot(d[0], d[2]) || 1; const dot = (d[0] * f.x + d[2] * f.z) / h * (dir === 'toward' ? 1 : -1); if (dot > score) { score = dot; best = a } }
        s.params.set('sun.azimuth', best)
        return { azimuth: best, quality: s.params.get('gfx.quality').value }
      }, { hour, dir })
      await page.waitForTimeout(Number(process.env.WAIT ?? 2500))
      const name = `${planet}-${String(hour).replace('.', '_').padStart(2, '0')}h-${dir}.png`
      await page.screenshot({ path: `${out}/${name}` })
      console.log(name, JSON.stringify({ ...info, foreground: await foreground(`${out}/${name}`) }))
    }
  }
  console.log('errors', JSON.stringify(errors))
} finally { await browser.close() }
