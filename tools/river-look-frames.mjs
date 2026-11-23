/**
 * How rivers look. Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/river-look-frames.mjs <output directory>
 *
 * Serves dist/ from this checkout (and checks the port's listener is this process). On an alpine
 * and a desert world it finds a steep stretch, a gentle one, a fall and its foot, and a river's
 * mouth into a lake or pool, and frames each from above and upstream looking down the river, as
 * the owner saw it, at desktop size on High and at phone size on Medium and Low. The interface is
 * hidden. It also records the average frame time over three seconds at each view.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/river-look/run'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]
if (Number(listener) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []

/** In the page: interesting river spots, from the planned lines and the live liquid surface. */
function spots() {
  const t = window.mira.terrain, lava = t.data.lava, found = {}
  const wet = (p) => t.liquidKindAt(p.x, p.z) === 'water'
  const bodies = lava.lake ? [lava.lake, ...lava.pools] : lava.pools
  for (const [ri, r] of lava.rivers.entries()) {
    const pts = r.points
    for (let i = 6; i + 8 < pts.length; i++) {
      const a = pts[i], b = pts[i + 6]
      const run = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const slope = (t.liquidHeightAt(a.x, a.z) - t.liquidHeightAt(b.x, b.z)) / run
      const view = { x: a.x, z: a.z, tx: b.x, tz: b.z, river: ri, width: r.width, slope: +slope.toFixed(2) }
      if (!wet(a) || !wet(b)) continue
      if (slope > 0.35 && !found.steep) found.steep = view
      if (slope > 0 && slope < 0.04 && !found.gentle) found.gentle = view
      if (slope > 1 && !found.fall) found.fall = view
      if (r.width < 7 && slope > 0.02 && slope < 0.3 && !found.narrow) found.narrow = view
    }
    // The mouth: the last wet planned point that lies inside a lake or pool.
    for (let i = pts.length - 1; i > 4 && !found.mouth; i--) {
      if (bodies.some((b) => (pts[i].x - b.x) ** 2 + (pts[i].z - b.z) ** 2 < b.radius ** 2)) { const a = pts[Math.max(0, i - 8)]; found.mouth = { x: a.x, z: a.z, tx: pts[i].x, tz: pts[i].z, river: ri, width: r.width } }
    }
  }
  return found
}

async function open(planet, seed, viewport, quality) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=${planet}&seed=${seed}&room=rl${Date.now().toString(36)}&daydream=0`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 120000 })
  await page.evaluate((q) => {
    const s = window.mira
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', q)
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
  }, quality)
  await page.waitForTimeout(3000)
  return { ctx, page }
}

/** From above and upstream of `v`, looking down the river to its far point. */
async function frame(page, name, v, height = 9, back = 10) {
  const cost = await page.evaluate(async ({ v, height, back }) => {
    const s = window.mira, V = s.game.camera.position.constructor
    const dx = v.tx - v.x, dz = v.tz - v.z, l = Math.hypot(dx, dz) || 1
    const cx = v.x - (dx / l) * back, cz = v.z - (dz / l) * back
    const y = Math.max(s.terrain.heightAt(cx, cz), s.terrain.liquidHeightAt(cx, cz)) + height
    // The player out of the way, far off on dry ground.
    s.player.teleport({ x: cx + 300, y: s.terrain.heightAt(cx + 300, cz) + 2, z: cz }, 0)
    s.camera.setCinematicPose(new V(cx, y, cz), new V(v.tx, s.terrain.liquidHeightAt(v.tx, v.tz), v.tz), 55)
    await new Promise((r) => setTimeout(r, 2500))
    const start = s.game.frames, t0 = performance.now()
    await new Promise((r) => setTimeout(r, 3000))
    return +((performance.now() - t0) / Math.max(1, s.game.frames - start)).toFixed(2)
  }, { v, height, back })
  await page.screenshot({ path: `${out}/${name}.png` })
  notes.push({ name, frameMs: cost, ...v })
}

const DESKTOP = { width: 1280, height: 800 }, PHONE = { width: 844, height: 390 }
for (const [planet, seed] of [['alpine', 4], ['desert', 4]]) {
  const { ctx, page } = await open(planet, seed, DESKTOP, 3)
  const found = await page.evaluate(spots)
  notes.push({ planet, found: Object.keys(found) })
  for (const [kind, v] of Object.entries(found)) await frame(page, `${planet}-${kind}-desktop-high`, v, kind === 'fall' ? 14 : 9, kind === 'fall' ? 18 : 10)
  await ctx.close()
  for (const quality of [2, 1]) {
    const phone = await open(planet, seed, PHONE, quality)
    const v = found.narrow ?? found.steep ?? found.gentle
    if (v) await frame(phone.page, `${planet}-narrow-phone-q${quality}`, v, 6, 8)
    if (found.steep) await frame(phone.page, `${planet}-steep-phone-q${quality}`, found.steep)
    await phone.ctx.close()
  }
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
