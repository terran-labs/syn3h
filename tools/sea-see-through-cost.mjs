/**
 * GPU time per frame with the water in view, from WebGPU timestamp queries on the game's own
 * renderer (three's trackTimestamp, switched on after start when the device has the feature).
 * Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/sea-see-through-cost.mjs <out.json> [--webgl]
 *
 * Two views at High, at 1280x720 and 844x390: the lens 1.2 m over shallow open sea looking along
 * it (about half the screen is water), and 4 m up looking down (water fills the screen). For
 * each, the median and 90th percentile of the frame's summed render-pass GPU time over 120
 * frames. Run it from each build's checkout and compare; run it twice to see the noise.
 * WebGL 2 reports whether the browser exposes a timer query at all.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-see-through/cost.json', webgl = process.argv.includes('--webgl')
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error('port not ours')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const spot = { x: -145.8, z: -713.5, heading: 2.6 } // alpine 4, the frames tool's sea spot
const results = []
for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
  const page = await (await browser.newContext({ viewport })).newPage()
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=alpine&seed=4&room=sc${Date.now().toString(36)}&daydream=0${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.syn3h
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', 3)
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
  })
  await page.waitForTimeout(5000)
  const timer = await page.evaluate(() => {
    const b = window.syn3h.game.renderer.backend
    if (b.device?.features?.has('timestamp-query')) { b.trackTimestamp = true; return 'webgpu timestamp-query' }
    if (b.gl) { const ext = b.gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (ext) { b.trackTimestamp = true; b.disjoint = ext; return 'webgl EXT_disjoint_timer_query_webgl2' } }
    return null
  })
  for (const [view, height, down] of [['sea level', 1.2, 0.06], ['looking down', 4, 0.5]]) {
    await page.evaluate(({ p, height, down }) => {
      const s = window.syn3h, t = s.terrain, V = s.game.camera.position.constructor, y = t.liquidHeightAt(p.x, p.z) + height
      s.player.teleport({ x: p.x + 400, y: t.heightAt(p.x + 400, p.z) + 2, z: p.z }, 0)
      s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x - Math.sin(p.heading) * 100, y - 100 * down, p.z - Math.cos(p.heading) * 100), 60)
    }, { p: spot, height, down })
    await page.waitForFunction(() => { const s = window.syn3h, c = s.camera.cinematic, cam = s.game.camera; return !c || (Math.hypot(cam.position.x - c.position.x, cam.position.z - c.position.z) < 0.05 && c.look.distanceTo(c.target) < 0.1) }, null, { timeout: 30000, polling: 200 }).catch(() => {})
    await page.waitForTimeout(1000)
    const ms = timer ? await page.evaluate(async () => {
      const r = window.syn3h.game.renderer, ms = []
      for (let i = 0; i < 140; i++) {
        await new Promise((ok) => requestAnimationFrame(ok))
        const d = await r.resolveTimestampsAsync('render')
        if (i >= 20 && Number.isFinite(d) && d > 0) ms.push(d)
      }
      return ms
    }) : []
    const sorted = [...ms].sort((a, b) => a - b), at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
    results.push({ viewport: `${viewport.width}x${viewport.height}`, view, timer, frames: ms.length, gpuMsP50: sorted.length ? +at(0.5).toFixed(3) : null, gpuMsP90: sorted.length ? +at(0.9).toFixed(3) : null })
  }
  await page.context().close()
}
await browser.close(); await app.close()
await writeFile(out, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
process.exit(0)
