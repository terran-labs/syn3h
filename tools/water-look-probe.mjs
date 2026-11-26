/**
 * Probe the sea's look: one page, one build, one pose, a frame per named set of sliders. For
 * finding which setting produces what in the frames tool's views.
 *
 *   tools/heavy.sh node tools/water-look-probe.mjs <checkout> <out> [--level 3] [--pose shore|open|low]
 *       [--size 1280x800] [--set name:id=value,id=value] ...
 *
 * Poses as tools/water-look-frames.mjs finds them on Alpine 4 (spots searched at rest).
 * Each set is applied on top of the defaults, shot, then undone.
 */
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const argv = process.argv.slice(2)
const [dir, out] = argv
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const level = Number(opt('--level', '3')), pose = opt('--pose', 'shore')
const [w, h] = opt('--size', '1280x800').split('x').map(Number)
const sets = [['default', {}]]
/** --eval name:js runs a line of script in the page (with `s` the game handle) and shoots it, last. */
const evals = []
argv.forEach((a, i) => {
  if (a === '--eval') { const k = argv[i + 1].indexOf(':'); evals.push([argv[i + 1].slice(0, k), argv[i + 1].slice(k + 1)]) }
  if (a !== '--set') return
  const [name, list] = argv[i + 1].split(':')
  sets.push([name, Object.fromEntries(list.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, v === 'true' ? true : v === 'false' ? false : Number(v)] }))])
})
const app = await serveStable({ dir, port: 0 }); const port = app.server.address().port
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=hovercraft&planet=alpine&seed=4&room=pr${Date.now().toString(36)}&daydream=0`)
await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 240000 })
await page.evaluate(async ({ level, pose }) => {
  const s = window.mira; s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0)
  const q = s.game.quality; q.setAuto?.(false); q.setLevel(level)
  for (const el of document.body.querySelectorAll('*')) if (el !== s.game.canvas && !el.contains(s.game.canvas)) el.style.visibility = 'hidden'
  const height = s.params.get('water.waveHeight').value
  s.params.set('water.waveHeight', 0)
  const t = s.terrain, size = t.wrapSize, sea = (x, z) => t.liquidHeightAt(x, z), depth = (x, z) => sea(x, z) - t.heightAt(x, z)
  let spot = null
  for (let gx = -size / 2; gx < size / 2 && !spot; gx += 24) for (let gz = -size / 2; gz < size / 2 && !spot; gz += 24) {
    const d = depth(gx, gz)
    if (pose === 'shore') {
      if (d > 4 && d < 7) for (let a = 0; a < 8 && !spot; a++) {
        const hd = (a / 8) * Math.PI * 2, lx = gx + Math.cos(hd) * 70, lz = gz + Math.sin(hd) * 70
        if (t.heightAt(lx, lz) > sea(gx, gz) + 3 && depth(gx - Math.cos(hd) * 150, gz - Math.sin(hd) * 150) > 15) spot = { x: gx, z: gz, land: hd }
      }
    } else if (d > 25) { let ok = true; for (let k = 0; k <= 300 && ok; k += 30) ok = depth(gx + k, gz) > 25 && depth(gx, gz + k) > 25; if (ok) spot = { x: gx, z: gz } }
  }
  s.params.set('water.waveHeight', height)
  const V = s.game.camera.position.constructor, y = sea(spot.x, spot.z)
  s.player.teleport({ x: spot.x + 600, y: t.heightAt(spot.x + 600, spot.z) + 3, z: spot.z }, 0)
  if (pose === 'shore') { const hd = spot.land + Math.PI / 2 - 0.35; s.camera.setCinematicPose(new V(spot.x, y + 3, spot.z), new V(spot.x + Math.cos(hd) * 100, y - 6, spot.z + Math.sin(hd) * 100), 60) }
  else if (pose === 'open') s.camera.setCinematicPose(new V(spot.x, y + 60, spot.z), new V(spot.x + 400, y + 5, spot.z + 120), 60)
  else if (pose === 'glitter') {
    // Low sun ahead: the afternoon hour at which it first stands under 10 degrees.
    const sunDir = () => { let d = null; s.game.scene.traverse((o) => { if (!d && o.isDirectionalLight) { o.updateMatrixWorld(); o.target.updateMatrixWorld(); d = o.getWorldPosition(o.position.clone()).sub(o.target.getWorldPosition(o.position.clone())).normalize() } }); return d }
    const frame = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r)) }
    let dir = null
    for (let hr = 14; hr <= 19; hr += 0.1) { s.params.set('sun.timeOfDay', hr); await frame(); dir = sunDir(); if (dir && dir.y < Math.sin((10 * Math.PI) / 180)) break }
    const az = Math.atan2(dir.z, dir.x)
    s.camera.setCinematicPose(new V(spot.x, y + 4, spot.z), new V(spot.x + Math.cos(az) * 100, y - 2, spot.z + Math.sin(az) * 100), 60)
  }
  else s.camera.setCinematicPose(new V(spot.x, y + 3, spot.z), new V(spot.x + 100, y - 8, spot.z + 20), 60)
}, { level, pose })
await page.waitForTimeout(8000)

for (const [name, set] of sets) {
  const saved = await page.evaluate((set) => { const p = window.mira.params, old = {}; for (const [k, v] of Object.entries(set)) { old[k] = p.get(k).value; p.set(k, v) } return old }, set)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/${pose}-L${level}-${name}.png` })
  await page.evaluate((old) => { for (const [k, v] of Object.entries(old)) window.mira.params.set(k, v) }, saved)
}
for (const [name, js] of evals) {
  await page.evaluate((js) => { const s = window.mira; new Function('s', js)(s) }, js)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${out}/${pose}-L${level}-${name}.png` })
}
console.log(JSON.stringify({ errs: errs.slice(0, 5) }))
await browser.close(); app.server.close()
