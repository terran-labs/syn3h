/**
 * Frames and cost of the sea surface's look, for comparing two production builds.
 *
 *   tools/heavy.sh node tools/water-look-frames.mjs <out> <name=checkout> [<name=checkout> ...]
 *       [--webgl] [--levels 1,4,5] [--sizes 1280x800,390x844] [--cost] [--frames-only]
 *
 * Each checkout is a directory holding a `dist` (npm run build). For every build, size and
 * level, four views on Alpine 4 with the interface hidden, the clock of day fixed and no bots:
 *   shore    low over the sea beside the shore, looking along it (the owner's screenshot)
 *   open     60 m up over open sea, looking out to the horizon
 *   glitter  low over open sea with the sun low ahead (the sun glitter path)
 *   shallows 10 m up looking down over shallow water and the bed
 * 390x844 is a touch phone (hasTouch, isMobile, DPR 2), so touch WebGPU runs as on a phone.
 *
 * --cost: the water's own cost in each view. The liquids are hidden and shown in alternating
 * blocks of 24 frames on the same page (toggling visibility builds nothing). For each frame,
 * the frame's own script time (game.frame wrapped) and its GPU tail (end of script to
 * queue.onSubmittedWorkDone on WebGPU, gl.finish on WebGL 2). The water's cost is the median
 * with it shown minus the median with it hidden. Shader work (node builds and pipelines) is
 * counted across the measured frames and across each quality change after settling.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const out = argv[0]
const builds = argv.slice(1).filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => { const [name, dir] = a.split('='); return { name, dir } })
const webgl = flag('--webgl'), cost = flag('--cost'), framesOnly = flag('--frames-only')
// --preview-swell L: a labelled preview of a longer physical swell (water.waveLength L). It
// changes the shared wave length for the page, physics included, so it is for frames only.
const previewSwell = Number(opt('--preview-swell', '0'))
const levels = opt('--levels', '1,3,5').split(',').map(Number)
const sizes = opt('--sizes', '1280x800,390x844').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h } })
const views = opt('--views', 'shore,open,glitter,shallows').split(',')
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const report = { backend: webgl ? 'webgl2' : 'webgpu', rows: [], errors: [] }

for (const build of builds) {
  const app = await serveStable({ dir: build.dir, port: 0 })
  const port = app.server.address().port
  if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
  for (const viewport of sizes) {
    const phone = viewport.width < viewport.height
    const ctx = await browser.newContext(phone ? { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport })
    const page = await ctx.newPage()
    if (previewSwell > 0) await page.addInitScript((l) => { window.wlPreviewSwell = l }, previewSwell)
    page.on('pageerror', (e) => report.errors.push(`${build.name} ${viewport.width}: ${e.message}`))
    await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=hovercraft&planet=alpine&seed=4&room=wl${Date.now().toString(36)}&daydream=0${webgl ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 240000 })
    const backend = await page.evaluate(() => {
      const s = window.mira
      s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0)
      if (window.wlPreviewSwell > 0) s.params.set('water.waveLength', window.wlPreviewSwell)
      const canvas = s.game.canvas ?? document.querySelector('canvas')
      for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
      // Spots, found once: a coast (water about 5 m deep with land 50 to 90 m to one side), open
      // sea (more than 25 m deep for 300 m), and shallows (1 to 4 m deep).
      // Depth at rest: with the waves held flat while searching, every build finds the same spots.
      const height = s.params.get('water.waveHeight').value
      s.params.set('water.waveHeight', 0)
      const t = s.terrain, size = t.wrapSize, sea = (x, z) => t.liquidHeightAt(x, z), depth = (x, z) => sea(x, z) - t.heightAt(x, z)
      const spots = {}
      for (let gx = -size / 2; gx < size / 2; gx += 24) for (let gz = -size / 2; gz < size / 2; gz += 24) {
        const d = depth(gx, gz)
        if (!Number.isFinite(d)) continue
        if (!spots.coast && d > 4 && d < 7) for (let a = 0; a < 8 && !spots.coast; a++) {
          const h = (a / 8) * Math.PI * 2, lx = gx + Math.cos(h) * 70, lz = gz + Math.sin(h) * 70
          if (t.heightAt(lx, lz) > sea(gx, gz) + 3 && depth(gx - Math.cos(h) * 150, gz - Math.sin(h) * 150) > 15) spots.coast = { x: gx, z: gz, land: h }
        }
        if (!spots.open && d > 25) { let ok = true; for (let k = 0; k <= 300 && ok; k += 30) ok = depth(gx + k, gz) > 25 && depth(gx, gz + k) > 25; if (ok) spots.open = { x: gx, z: gz } }
        if (!spots.shallow && d > 1 && d < 4 && depth(gx + 12, gz) > 0.5 && depth(gx - 12, gz) > 0.5 && depth(gx, gz + 12) > 0.5 && depth(gx, gz - 12) > 0.5) spots.shallow = { x: gx, z: gz }
      }
      s.params.set('water.waveHeight', height)
      window.wlSpots = spots
      // Frame timing: script per frame and the GPU tail after it.
      const g = s.game, b = g.renderer.backend
      window.wlTimes = []
      // Shader work: render pipelines and programs the backend creates (as performance-check.mjs).
      let work = 0
      for (const key of ['createRenderPipeline', 'createProgram', 'createComputePipeline']) {
        if (typeof b[key] !== 'function') continue
        const original = b[key].bind(b)
        b[key] = (...a) => { work++; return original(...a) }
      }
      window.__wlWork = () => work
      const frame = g.frame.bind(g)
      g.frame = (...a) => {
        const t0 = performance.now()
        const r = frame(...a)
        const t1 = performance.now()
        const row = { script: t1 - t0, tail: null }
        window.wlTimes.push(row)
        if (b.device) b.device.queue.onSubmittedWorkDone().then(() => { row.tail = performance.now() - t1 })
        else if (b.gl) { b.gl.finish(); row.tail = performance.now() - t1 }
        return r
      }
      return b.device ? 'webgpu' : 'webgl2'
    })
    for (const level of levels) {
      const work0 = await shaderWork(page)
      await page.evaluate((level) => { const q = window.mira.game.quality; q.setAuto?.(false); q.setLevel(level) }, level)
      await page.waitForTimeout(6000)
      const settled = await shaderWork(page)
      for (const view of views) {
        await pose(page, view)
        const name = `${previewSwell > 0 ? `PREVIEW-swell${previewSwell}m-` : ''}${build.name}-${report.backend}-${viewport.width}x${viewport.height}-L${level}-${view}`
        if (!cost || !framesOnly) await page.screenshot({ path: `${out}/${name}.png` })
        if (!cost) { report.rows.push({ name, build: build.name, backend, level, view, size: `${viewport.width}x${viewport.height}` }); continue }
        const before = await shaderWork(page)
        const blocks = await page.evaluate(async () => {
          const group = window.mira.game.scene.getObjectByName('volcanics')
          const frames = (n) => new Promise((resolve) => { const start = window.wlTimes.length; const tick = () => (window.wlTimes.length - start >= n ? resolve(window.wlTimes.slice(start)) : requestAnimationFrame(tick)); tick() })
          const on = [], off = []
          for (let k = 0; k < 6; k++) {
            group.visible = k % 2 === 0
            await frames(4) // settle
            const rows = await frames(24)
            await new Promise((r) => setTimeout(r, 200))
            ;(group.visible ? on : off).push(...rows)
          }
          group.visible = true
          return { on, off }
        })
        const after = await shaderWork(page)
        const med = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
        const row = {
          name, build: build.name, backend, level, view, size: `${viewport.width}x${viewport.height}`,
          scriptOn: med(blocks.on.map((r) => r.script)), scriptOff: med(blocks.off.map((r) => r.script)),
          tailOn: med(blocks.on.map((r) => r.tail)), tailOff: med(blocks.off.map((r) => r.tail)),
          shaderWorkDuringMeasure: after - before, shaderWorkLevelChange: settled - work0,
        }
        row.waterScript = row.scriptOn - row.scriptOff
        row.waterTail = row.tailOn - row.tailOff
        report.rows.push(row)
        console.log(JSON.stringify(row))
      }
    }
    await ctx.close()
  }
  await new Promise((r) => app.server.close(r))
}
await browser.close()
await writeFile(`${out}/report-${report.backend}.json`, JSON.stringify(report, null, 1))
console.log(`errors: ${report.errors.length}`, report.errors.slice(0, 5))

async function shaderWork(page) {
  return page.evaluate(() => window.__wlWork())
}

/** The camera for a view, through the game's own cinematic pose; the hovercraft parked aside. */
async function pose(page, view) {
  await page.evaluate(async (view) => {
    const s = window.mira, t = s.terrain, V = s.game.camera.position.constructor, spots = window.wlSpots
    const at = view === 'shore' ? spots.coast : view === 'shallows' ? spots.shallow : spots.open
    if (!at) throw new Error(`no spot for ${view}`)
    const sea = t.liquidHeightAt(at.x, at.z)
    let from, look
    if (view === 'shore') {
      // Along the coast: land to one side, open sea ahead and to the other.
      const h = at.land + Math.PI / 2 - 0.35
      from = new V(at.x, sea + 3, at.z); look = new V(at.x + Math.cos(h) * 100, sea - 6, at.z + Math.sin(h) * 100)
    } else if (view === 'open') {
      from = new V(at.x, sea + 60, at.z); look = new V(at.x + 400, sea + 5, at.z + 120)
    } else if (view === 'glitter') {
      // Toward the sun's azimuth, from the scene's directional light, with the sun put low: the
      // afternoon hour at which it first stands under 10 degrees.
      const sunDir = () => { let d = null; s.game.scene.traverse((o) => { if (!d && o.isDirectionalLight) { o.updateMatrixWorld(); o.target.updateMatrixWorld(); d = o.getWorldPosition(o.position.clone()).sub(o.target.getWorldPosition(o.position.clone())).normalize() } }); return d }
      let dir = null
      // Several frames per step: the light follows the hour a frame or two late, and a search that
      // reads it too early overshoots into dusk.
      const frame = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r)) }
      for (let h = 14; h <= 19; h += 0.1) { s.params.set('sun.timeOfDay', h); await frame(); dir = sunDir(); if (dir && dir.y < Math.sin((10 * Math.PI) / 180)) { window.wlSunHour = h; break } }
      const az = dir ? Math.atan2(dir.z, dir.x) : 0
      from = new V(at.x, sea + 4, at.z); look = new V(at.x + Math.cos(az) * 100, sea - 2, at.z + Math.sin(az) * 100)
    } else {
      from = new V(at.x - 8, sea + 10, at.z - 8); look = new V(at.x + 10, sea - 3, at.z + 10)
    }
    if (view !== 'glitter') s.params.set('sun.timeOfDay', 11)
    s.player.teleport({ x: at.x + 600, y: t.heightAt(at.x + 600, at.z) + 3, z: at.z }, 0)
    s.camera.setCinematicPose(from, look, 60)
  }, view)
  await page.waitForFunction(() => { const s = window.mira, c = s.camera.cinematic, cam = s.game.camera; return !c || (Math.hypot(cam.position.x - c.position.x, cam.position.z - c.position.z) < 0.05 && c.look.distanceTo(c.target) < 0.1) }, null, { timeout: 60000, polling: 250 }).catch(() => {})
  await page.waitForTimeout(2500)
}
