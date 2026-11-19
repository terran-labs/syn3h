/**
 * Can land be seen through the sea? Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/sea-see-through-frames.mjs <output directory> [--webgl] [--quick]
 *
 * Serves dist/ from this checkout (and checks the port's listener is this process). The owner's
 * case on v26.11.1801: a Zorb afloat on the open sea of an alpine world, the lens just above the
 * surface looking along it, distant hills showing as a pale shape inside the water. On worlds
 * and roundnesses where the planet is drawn tightly curved, the lens is put 1.2 m over shallow
 * open sea off a coast and turned to eight headings, then the same from 40 m up (a jet's view);
 * plus a shallow shore and a river mouth seen from just above, which must stay clear. At
 * Low, Medium and High, phone and desktop sizes. The interface is hidden.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-see-through/run'
const webgl = process.argv.includes('--webgl'), quick = process.argv.includes('--quick')
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]
if (Number(listener) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []

/**
 * In the page: the owner's geometry. Shallow open sea (1 to 3.5 m, and no deeper than 4 m for
 * the first 60 m along the view) with high ground 250 to 700 m away along that view: a sight
 * line dipping just under the horizon crosses only a short chord of clear water on a small
 * planet, comes out of the curving surface and runs on to the hills.
 */
function seaSpot() {
  const t = window.syn3h.terrain, sea = window.syn3h.params.get('world.lavaAltitude').value, size = t.size
  let best = null
  for (let k = 0; k < 20000; k++) {
    const x = (Math.sin(k * 12.9898) * 0.5) * size * 0.95, z = (Math.cos(k * 78.233) * 0.5) * size * 0.95
    const depth = sea - t.heightAt(x, z)
    if (depth < 1 || depth > 3.5 || t.liquidKindAt(x, z) !== 'water') continue
    for (let a = 0; a < 24; a++) {
      const h = (a / 24) * Math.PI * 2, dx = -Math.sin(h), dz = -Math.cos(h)
      let shallow = true
      for (let r = 5; r <= 30 && shallow; r += 5) { const d = sea - t.heightAt(x + dx * r, z + dz * r); shallow = d > 0.3 && d < 3 }
      if (!shallow) continue
      let land = null
      for (let r = 120; r <= 350 && !land; r += 10) if (t.heightAt(x + dx * r, z + dz * r) > sea + 12) land = r
      if (land && (!best || land < best.r)) best = { x, z, heading: h, r: land, depth }
    }
  }
  return best
}
function shoreSpot() {
  const t = window.syn3h.terrain, sea = window.syn3h.params.get('world.lavaAltitude').value, size = t.size
  for (let k = 0; k < 4000; k++) {
    const x = (Math.sin(k * 3.17) * 0.5) * size * 0.9, z = (Math.cos(k * 9.41) * 0.5) * size * 0.9
    const depth = sea - t.heightAt(x, z)
    if (depth > 0.3 && depth < 1.2 && t.liquidKindAt(x, z) === 'water') return { x, z }
  }
  return null
}
function mouthSpot() {
  const t = window.syn3h.terrain, lava = t.data.lava
  for (const r of lava.rivers) { const p = r.points.at(-1), q = r.points.at(-6); if (p && q) return { x: q.x, z: q.z, tx: p.x, tz: p.z } }
  return null
}

async function open(planet, seed, planetSize, curve, viewport, quality) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=${planet}&seed=${seed}&room=st${Date.now().toString(36)}&daydream=0${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
  await page.evaluate(({ planetSize, curve, quality }) => {
    const s = window.syn3h
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', quality)
    if (planetSize !== null) s.params.set('terrain.planetSize', planetSize)
    s.params.set('world.curve', curve)
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
  }, { planetSize, curve, quality })
  await page.waitForTimeout(5000)
  return { ctx, page }
}
/** Lens at (x, z), `height` over the sea surface, looking along `heading`, a touch down. */
const pose = (page, p, heading, height, down = 0.02) => page.evaluate(({ p, heading, height, down }) => {
  const s = window.syn3h, t = s.terrain, V = s.game.camera.position.constructor
  const y = t.liquidHeightAt(p.x, p.z) + height
  s.player.teleport({ x: p.x + 400, y: t.heightAt(p.x + 400, p.z) + 2, z: p.z }, 0)
  s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x - Math.sin(heading) * 100, y - 100 * down, p.z - Math.cos(heading) * 100), 60)
}, { p, heading, height, down }).then(() => settle(page))
/**
 * The cinematic pose eases in (ChaseCamera, rate 2 per second, dt clamped), so a slow headless
 * frame rate can leave the camera short of it. Wait until the camera is within 5 cm of the pose across the ground
 * and its aim within 10 cm of the target, then a moment more for the water's own state.
 */
const settle = (page) => page.waitForFunction(() => {
  const s = window.syn3h, c = s.camera.cinematic, cam = s.game.camera
  // Height is compared loosely: the camera keeps itself clear of high ground.
  return !c || (Math.hypot(cam.position.x - c.position.x, cam.position.z - c.position.z) < 0.05 && c.look.distanceTo(c.target) < 0.1)
}, null, { timeout: 30000, polling: 200 }).catch(() => notes.push({ unsettled: true })).then(() => page.waitForTimeout(800))

const cases = quick
  ? [['alpine', 4, 0, 1.5], ['alpine', 4, 0, 1.8], ['archipelago', 4, 0, 1.8]]
  : [['alpine', 4, null, 0.75], ['alpine', 4, 0, 1.0], ['alpine', 4, 0, 1.5], ['archipelago', 4, 0, 1.0]]
const configs = quick ? [[{ width: 1280, height: 800 }, 3]] : [[{ width: 1280, height: 800 }, 3], [{ width: 844, height: 390 }, 2], [{ width: 844, height: 390 }, 1]]
for (const [planet, seed, planetSize, curve] of cases) for (const [viewport, quality] of configs) {
  const tag = `${planet}${planetSize === null ? '' : `-size${planetSize}`}-curve${curve}-q${quality}-${viewport.width}${webgl ? '-webgl' : ''}`
  const { ctx, page } = await open(planet, seed, planetSize, curve, viewport, quality)
  const spot = await page.evaluate(seaSpot)
  notes.push({ tag, spot })
  if (spot) {
    for (let a = 0; a < (quick ? 3 : 8); a++) {
      const h = spot.heading + (a - 1) * (Math.PI / 16)
      await pose(page, spot, h, 1.2, 0.06)
      await page.screenshot({ path: `${out}/${tag}-sea-h${a}.png` })
    }
    // From altitude, as a jet would see it.
    await pose(page, spot, spot.heading, 40, 0.2)
    await page.screenshot({ path: `${out}/${tag}-altitude.png` })
  }
  const shore = await page.evaluate(shoreSpot)
  if (shore) {
    await pose(page, shore, 0, 1.5, 0.3); await page.screenshot({ path: `${out}/${tag}-shore.png` })
    // A far shallow beach at a grazing angle: 120 m out to sea from it, 1.5 m up, looking at it.
    const far = await page.evaluate((b) => { const t = window.syn3h.terrain; for (let a = 0; a < 16; a++) { const h = (a / 16) * Math.PI * 2, x = b.x + Math.sin(h) * 120, z = b.z + Math.cos(h) * 120; if (t.liquidKindAt(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 2) return { x, z, heading: h } } return null }, shore)
    if (far) { await pose(page, far, far.heading, 1.5, 0.01); await page.screenshot({ path: `${out}/${tag}-far-beach.png` }) }
  }
  const mouth = await page.evaluate(mouthSpot)
  if (mouth) { await pose(page, mouth, Math.atan2(-(mouth.tx - mouth.x), -(mouth.tz - mouth.z)), 3, 0.15); await page.screenshot({ path: `${out}/${tag}-mouth.png` }) }
  await ctx.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
