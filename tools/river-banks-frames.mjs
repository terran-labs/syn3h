/**
 * The minimap's colours and the grass on a river's banks, against where the water really is.
 * Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/river-banks-frames.mjs <output directory>
 *
 * Serves dist/ from this checkout (and checks the port's listener is this process). On an alpine
 * and a desert world it finds a river stretch whose planned line stood well above its bed, where
 * banks the old planned slab covered are dry now. It saves the baked map colours round it as a
 * picture (terrain.mapColourAt, what the minimap draws) and a frame of the bank from the ground.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/river-banks/run'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]
if (Number(listener) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []

for (const [planet, seed] of [['alpine', 4], ['desert', 4]]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=${planet}&seed=${seed}&room=rb${Date.now().toString(36)}&daydream=0`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.mira
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', 3)
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
  })
  await page.waitForTimeout(3000)
  // A planned river point standing well over its bed, with a bank inside the planned width that
  // the water does not reach.
  const spot = await page.evaluate(() => {
    const t = window.mira.terrain
    let best = null
    for (const r of t.data.lava.rivers) for (let i = 2; i + 2 < r.points.length; i++) {
      const p = r.points[i], q = r.points[i + 1], l = Math.hypot(q.x - p.x, q.z - p.z) || 1
      const nx = -(q.z - p.z) / l, nz = (q.x - p.x) / l
      const over = p.y - t.heightAt(p.x, p.z)
      for (const side of [-1, 1]) {
        const bx = p.x + nx * side * r.width * 0.42, bz = p.z + nz * side * r.width * 0.42
        if (over > 2.5 && !t.liquidKindAt(bx, bz) && (!best || over > best.over)) best = { x: p.x, z: p.z, bx, bz, nx: nx * side, nz: nz * side, over, width: r.width }
      }
    }
    return best
  })
  if (!spot) { notes.push({ planet, spot: null }); await ctx.close(); continue }
  // The baked map colours round the spot, 160 m across, one sample per metre.
  const png = await page.evaluate((spot) => {
    const t = window.mira.terrain, n = 160, c = document.createElement('canvas'); c.width = c.height = n
    const g = c.getContext('2d'), img = g.createImageData(n, n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = t.mapColourAt(spot.x + i - n / 2, spot.z + j - n / 2), k = (j * n + i) * 4
      img.data[k] = (v >> 16) & 255; img.data[k + 1] = (v >> 8) & 255; img.data[k + 2] = v & 255; img.data[k + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/png').split(',')[1]
  }, spot)
  await writeFile(`${out}/${planet}-map.png`, Buffer.from(png, 'base64'))
  // The bank from the ground, looking across it to the river.
  await page.evaluate((spot) => {
    const s = window.mira, t = s.terrain, V = s.game.camera.position.constructor
    const cx = spot.bx + spot.nx * 9, cz = spot.bz + spot.nz * 9
    s.player.teleport({ x: cx + 300, y: t.heightAt(cx + 300, cz) + 2, z: cz }, 0)
    s.camera.setCinematicPose(new V(cx, t.heightAt(cx, cz) + 2.2, cz), new V(spot.x, t.heightAt(spot.x, spot.z) + 0.5, spot.z), 60)
  }, spot)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${out}/${planet}-bank.png` })
  notes.push({ planet, spot: { x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), plannedAboveBed: +spot.over.toFixed(1) } })
  await ctx.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
