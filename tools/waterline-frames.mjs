/**
 * Frame sequences of the lens going slowly down through the sea's surface and back up, for the
 * waterline (waterline.ts) against the water's drawn edge, and the lens clearing afterwards.
 *
 *   tools/heavy.sh node tools/waterline-frames.mjs <out> <name=checkout> [<name=checkout> ...]
 *       [--webgl] [--sizes 1280x800,390x844] [--level 4]
 *
 * Each checkout holds a `dist` (npm run build). Alpine 4, open sea, noon, no bots, interface
 * hidden. For each pose (level; pitched 15 degrees down; rolled 20 degrees) and sea (calm, with
 * water.waveHeight 0; and the default waves), the lens is set at heights from 0.5 m above the
 * physical surface under it to 0.5 m below and back, held at each long enough for the underwater
 * look to settle. The waterline sheet is forced on (as mid crossing) so its line always draws, and
 * the line it computes is marked in magenta over the frame, so where the drawn water's edge sits
 * against it can be seen. After the rise, frames of the lens clearing every 0.15 s.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const out = argv[0]
const builds = argv.slice(1).filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => { const [name, dir] = a.split('='); return { name, dir } })
const webgl = argv.includes('--webgl')
const level = Number(opt('--level', '4'))
const sizes = opt('--sizes', '1280x800,390x844').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h } })
const HEIGHTS = [0.5, 0.25, 0.12, 0.06, 0.02, -0.02, -0.06, -0.12, -0.25, -0.5]
const POSES = { level: { pitch: 0, roll: 0 }, pitched: { pitch: -15, roll: 0 }, rolled: { pitch: -4, roll: 20 } }
const SEAS = { calm: 0, waves: null }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const report = { errors: [], frames: [] }

for (const build of builds) {
  const app = await serveStable({ dir: build.dir, port: 0 })
  const port = app.server.address().port
  if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
  for (const viewport of sizes) {
    const phone = viewport.width < viewport.height
    const ctx = await browser.newContext(phone ? { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => report.errors.push(`${build.name}: ${e.message}`))
    await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=alpine&seed=4&room=wlf${Date.now().toString(36)}&daydream=0${webgl ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 240000 })
    await page.evaluate((level) => {
      const s = window.mira
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0)
      const q = s.game.quality; q.setAuto?.(false); q.setLevel(level)
      const canvas = s.game.canvas ?? document.querySelector('canvas')
      for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
      // Open sea: more than 25 m deep for 200 m round.
      const t = s.terrain, size = t.wrapSize, depth = (x, z) => t.liquidHeightAt(x, z) - t.heightAt(x, z)
      outer: for (let gx = -size / 2; gx < size / 2; gx += 32) for (let gz = -size / 2; gz < size / 2; gz += 32) {
        let ok = depth(gx, gz) > 25
        for (let k = -200; k <= 200 && ok; k += 50) ok = depth(gx + k, gz) > 25 && depth(gx, gz + k) > 25
        if (ok) { window.wlfSpot = { x: gx, z: gz }; break outer }
      }
      // The waterline sheet always on, as mid crossing, so its line draws at every height.
      const fx = s.game.systems?.find?.((x) => x.waterline)
      const update = fx.waterline.update.bind(fx.waterline)
      fx.waterline.update = (cam, surf, kind, tint, dt, _crossing, sx, sz) => update(cam, surf, kind, tint, dt, window.wlfForce ?? 1, sx, sz)
      window.wlfFx = fx
      // An overlay for the computed line.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;visibility:visible')
      svg.innerHTML = '<line id="wlf-line" stroke="magenta" stroke-width="2" stroke-dasharray="8 6" x1="0" y1="0" x2="0" y2="0"/>'
      document.body.appendChild(svg)
    }, level)
    await page.waitForTimeout(6000)
    for (const [seaName, height] of Object.entries(SEAS)) {
      await page.evaluate((h) => { const p = window.mira.params; p.set('water.waveHeight', h ?? p.get('water.waveHeight').def.default) }, height)
      for (const [poseName, pose] of Object.entries(POSES)) {
        const sequence = [...HEIGHTS, ...HEIGHTS.slice().reverse()]
        for (let i = 0; i < sequence.length; i++) {
          const h = sequence[i], phase = i < HEIGHTS.length ? 'down' : 'up'
          await page.evaluate(({ h, pose }) => {
            const s = window.mira, t = s.terrain, at = window.wlfSpot, V = s.game.camera.position.constructor
            const y = t.liquidHeightAt(at.x, at.z) + h
            const pitch = (pose.pitch * Math.PI) / 180, roll = (pose.roll * Math.PI) / 180
            s.player.teleport({ x: at.x + 300, y: t.heightAt(at.x + 300, at.z) + 3, z: at.z }, 0)
            s.game.camera.up.set(Math.sin(roll), Math.cos(roll), 0)
            s.camera.setCinematicPose(new V(at.x, y, at.z), new V(at.x, y + Math.tan(pitch) * 50, at.z - 50), 60)
          }, { h, pose })
          await page.waitForTimeout(phase === 'up' && h > 0 ? 400 : 1500)
          // The computed line in screen pixels: h(s) = x + y sx + z sy = 0 on the sheet (s in -1..1,
          // the sheet 1.05 times the view), as waterline.ts draws it.
          const line = await page.evaluate(() => {
            const fx = window.wlfFx, p = fx.waterline.plane?.value ?? fx.waterline['plane'].value
            const w = innerWidth, hgt = innerHeight, k = 1.05
            const toPx = (sx, sy) => [((sx / k) * 0.5 + 0.5) * w, (0.5 - (sy / k) * 0.5) * hgt]
            let a, b
            if (Math.abs(p.z) > Math.abs(p.y)) { a = toPx(-k, (-p.x + p.y * k) / p.z); b = toPx(k, (-p.x - p.y * k) / p.z) }
            else { a = toPx((-p.x + p.z * k) / p.y, -k); b = toPx((-p.x - p.z * k) / p.y, k) }
            const el = document.getElementById('wlf-line')
            el.setAttribute('x1', a[0]); el.setAttribute('y1', a[1]); el.setAttribute('x2', b[0]); el.setAttribute('y2', b[1])
            const cam = window.mira.game.camera
            return { plane: [p.x, p.y, p.z], a, b, near: cam.near, lens: cam.position.y - window.mira.terrain.liquidHeightAt(cam.position.x, cam.position.z) }
          })
          const name = `${build.name}-${webgl ? 'webgl2' : 'webgpu'}-${viewport.width}x${viewport.height}-${seaName}-${poseName}-${String(i).padStart(2, '0')}-${phase}${h >= 0 ? '+' : ''}${h.toFixed(2)}m`
          await page.screenshot({ path: `${out}/${name}.png` })
          report.frames.push({ name, ...line })
        }
        // The lens clearing after a rise from a long dive: under for 4 s at 1.5 m, then up 1 m.
        if (poseName === 'level') {
          await page.evaluate(() => { window.wlfForce = 0; document.getElementById('wlf-line').setAttribute('x2', document.getElementById('wlf-line').getAttribute('x1')) })
          const pose = (h) => page.evaluate((h) => {
            const s = window.mira, t = s.terrain, at = window.wlfSpot, V = s.game.camera.position.constructor, y = t.liquidHeightAt(at.x, at.z) + h
            s.game.camera.up.set(0, 1, 0)
            s.camera.setCinematicPose(new V(at.x, y, at.z), new V(at.x, y - 2, at.z - 50), 60)
          }, h)
          await pose(-1.5); await page.waitForTimeout(4000); await pose(1)
          for (let k = 0; k < 12; k++) {
            await page.waitForTimeout(150)
            await page.screenshot({ path: `${out}/${build.name}-${webgl ? 'webgl2' : 'webgpu'}-${viewport.width}x${viewport.height}-${seaName}-clearing-${String(k).padStart(2, '0')}.png` })
          }
          await page.evaluate(() => { window.wlfForce = 1 })
        }
      }
    }
    await ctx.close()
  }
  await new Promise((r) => app.server.close(r))
}
await browser.close()
await writeFile(`${out}/report-${webgl ? 'webgl2' : 'webgpu'}.json`, JSON.stringify(report, null, 1))
console.log(`frames: ${report.frames.length}; errors: ${report.errors.length}`, report.errors.slice(0, 5))
