/**
 * The waterline invariant: where the lens is at the sea's surface, the line the game computes and
 * the edge where the drawn water stops agree within MAX_PX pixels across the screen.
 *
 *   tools/heavy.sh node tools/waterline-agreement.mjs <out> <checkout> [--webgl] [--sizes 1280x800,390x844]
 *
 * For each sea (calm, waves), pose (level; pitched 15 degrees down; rolled 20 degrees) and ten lens
 * heights from +0.10 to -0.10 m about the physical surface, two frames with the waterline probe
 * (water/drawnSurface.ts waterlineProbe): mode 1, the sheet paints pixels whose near-plane point
 * is under the drawn sea red, so the computed line is the red region's edge; mode 2, the sea paints
 * its fragments at the near plane green, which is where the near plane cuts the mesh: the drawn
 * edge. Per screen column, the distance from the green band's centre to the nearest red edge.
 * Columns where either is missing (the line is off screen, or the cut is hidden) are skipped and
 * counted. Fails if any frame's 95th percentile exceeds MAX_PX.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const MAX_PX = 3
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const [out, dir] = argv
const webgl = argv.includes('--webgl')
const sizes = opt('--sizes', '1280x800,390x844').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h } })
const HEIGHTS = [0.1, 0.07, 0.05, 0.03, 0.01, -0.01, -0.03, -0.05, -0.07, -0.1]
const POSES = { level: { pitch: 0, roll: 0 }, pitched: { pitch: -15, roll: 0 }, rolled: { pitch: -4, roll: 20 } }
const SEAS = { calm: 0, waves: null }
await mkdir(out, { recursive: true })
const app = await serveStable({ dir, port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error('port not ours')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const report = { backend: webgl ? 'webgl2' : 'webgpu', maxPx: MAX_PX, frames: [], errors: [], builds: {} }

for (const viewport of sizes) {
  const phone = viewport.width < viewport.height
  const ctx = await browser.newContext(phone ? { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=alpine&seed=4&room=wla${Date.now().toString(36)}&daydream=0${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 240000 })
  await page.evaluate(() => {
    const s = window.mira
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0)
    const q = s.game.quality; q.setAuto?.(false); q.setLevel(3)
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
    const t = s.terrain, size = t.wrapSize, depth = (x, z) => t.liquidHeightAt(x, z) - t.heightAt(x, z)
    outer: for (let gx = -size / 2; gx < size / 2; gx += 32) for (let gz = -size / 2; gz < size / 2; gz += 32) {
      let ok = depth(gx, gz) > 25
      for (let k = -200; k <= 200 && ok; k += 50) ok = depth(gx + k, gz) > 25 && depth(gx, gz + k) > 25
      if (ok) { window.wlaSpot = { x: gx, z: gz }; break outer }
    }
    // Shader work, to show the probe builds nothing during the run after the first switch.
    const b = s.game.renderer.backend
    let work = 0
    for (const key of ['createRenderPipeline', 'createProgram']) { if (typeof b[key] !== 'function') continue; const o = b[key].bind(b); b[key] = (...a) => { work++; return o(...a) } }
    window.wlaWork = () => work
  })
  await page.waitForTimeout(6000)
  // Edge rows per column from a screenshot, decoded in the page.
  const analyse = (png, kind) => page.evaluate(async ({ b64, kind }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, rows = []
    for (let x = 0; x < c.width; x++) {
      const hits = []
      for (let y = 1; y < c.height; y++) {
        const i = (y * c.width + x) * 4, j = ((y - 1) * c.width + x) * 4
        if (kind === 'red') { const a = d[i] > 128 && d[i + 1] < 64, b = d[j] > 128 && d[j + 1] < 64; if (a !== b) hits.push(y) }
        else if (d[i + 1] > 200 && d[i] < 120 && d[i + 2] < 120) hits.push(y)
      }
      rows.push(kind === 'red' ? hits : hits.length ? [hits.reduce((s, v) => s + v, 0) / hits.length] : [])
    }
    return { width: c.width, rows }
  }, { b64: png.toString('base64'), kind })
  for (const [seaName, height] of Object.entries(SEAS)) {
    await page.evaluate((h) => { const p = window.mira.params; p.set('water.waveHeight', h ?? p.get('water.waveHeight').def.default) }, height)
    for (const [poseName, pose] of Object.entries(POSES)) {
      for (const h of HEIGHTS) {
        await page.evaluate(({ h, pose }) => {
          const s = window.mira, t = s.terrain, at = window.wlaSpot, V = s.game.camera.position.constructor
          const y = t.liquidHeightAt(at.x, at.z) + h, pitch = (pose.pitch * Math.PI) / 180, roll = (pose.roll * Math.PI) / 180
          s.player.teleport({ x: at.x + 300, y: t.heightAt(at.x + 300, at.z) + 3, z: at.z }, 0)
          s.game.camera.up.set(Math.sin(roll), Math.cos(roll), 0)
          s.camera.setCinematicPose(new V(at.x, y, at.z), new V(at.x, y + Math.tan(pitch) * 50, at.z - 50), 60)
        }, { h, pose })
        await page.waitForTimeout(1200)
        const shots = {}
        for (const mode of [1, 2]) {
          await page.evaluate((m) => window.__miraWaterlineProbe(m), mode)
          await page.waitForTimeout(300)
          shots[mode] = await page.screenshot()
        }
        await page.evaluate(() => window.__miraWaterlineProbe(0))
        const red = await analyse(shots[1], 'red'), green = await analyse(shots[2], 'green')
        const gaps = []
        let skipped = 0
        for (let x = 0; x < red.width; x++) {
          const g = green.rows[x][0], r = red.rows[x]
          if (g === undefined || !r.length) { skipped++; continue }
          gaps.push(Math.min(...r.map((y) => Math.abs(y - g))))
        }
        gaps.sort((a, b) => a - b)
        const at = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : null)
        const name = `${report.backend}-${viewport.width}x${viewport.height}-${seaName}-${poseName}-${h >= 0 ? '+' : ''}${h.toFixed(2)}m`
        const row = { name, columns: gaps.length, skipped, p50: at(0.5), p95: at(0.95), max: gaps.at(-1) ?? null }
        row.pass = row.p95 === null || row.p95 <= MAX_PX
        if (!row.pass) { await writeFile(`${out}/${name}-red.png`, shots[1]); await writeFile(`${out}/${name}-green.png`, shots[2]) }
        report.frames.push(row)
        console.log(JSON.stringify(row))
      }
    }
  }
  report.builds[`${viewport.width}x${viewport.height}`] = await page.evaluate(() => window.wlaWork())
  await ctx.close()
}
await browser.close()
await new Promise((r) => app.server.close(r))
const measured = report.frames.filter((f) => f.p95 !== null)
report.summary = { frames: report.frames.length, measured: measured.length, failed: report.frames.filter((f) => !f.pass).length, worstP95: Math.max(0, ...measured.map((f) => f.p95)) }
await writeFile(`${out}/report-${report.backend}.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report.summary), 'errors', report.errors.length)
process.exit(report.summary.failed ? 1 : 0)
