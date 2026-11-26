// Probe: does the sea's detail layer respond to its sliders? One page, build b, High.
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'
const dir = process.argv[2], out = process.argv[3]
const app = await serveStable({ dir, port: 0 }); const port = app.server.address().port
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)) })
await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=hovercraft&planet=alpine&seed=4&room=pr${Date.now().toString(36)}&daydream=0`)
await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 240000 })
const info = await page.evaluate(() => {
  const s = window.mira; s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0)
  const q = s.game.quality; q.setAuto?.(false); q.setLevel(3)
  for (const el of document.body.querySelectorAll('*')) if (el !== s.game.canvas && !el.contains(s.game.canvas)) el.style.visibility = 'hidden'
  const t = s.terrain, size = t.wrapSize, depth = (x, z) => t.liquidHeightAt(x, z) - t.heightAt(x, z)
  for (let gx = -size / 2; gx < size / 2; gx += 32) for (let gz = -size / 2; gz < size / 2; gz += 32) if (depth(gx, gz) > 25 && depth(gx + 100, gz) > 25) { window.spot = { x: gx, z: gz }; break }
  return { detail: s.params.get('water.detail')?.value, chop: s.params.get('water.chop')?.value, gusts: s.params.get('water.gusts')?.value }
})
await page.waitForTimeout(5000)
await page.evaluate(() => {
  const s = window.mira, t = s.terrain, at = window.spot, V = s.game.camera.position.constructor, y = t.liquidHeightAt(at.x, at.z)
  s.player.teleport({ x: at.x + 600, y: t.heightAt(at.x + 600, at.z) + 3, z: at.z }, 0)
  s.camera.setCinematicPose(new V(at.x, y + 3, at.z), new V(at.x + 100, y - 8, at.z + 20), 60)
})
await page.waitForTimeout(4000)
const shot = async (name, set) => { await page.evaluate((set) => { for (const [k, v] of Object.entries(set)) window.mira.params.set(k, v) }, set); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${name}.png` }) }
await shot('a-default', {})
await page.evaluate(() => {
  const s = window.mira, t = s.terrain, at = window.spot, V = s.game.camera.position.constructor, y = t.liquidHeightAt(at.x, at.z)
  s.params.set('sun.timeOfDay', 17)
  let dir = null; s.game.scene.traverse((o) => { if (!dir && o.isDirectionalLight) dir = o.position.clone().sub(o.target.position).normalize() })
  const az = Math.atan2(dir.z, dir.x)
  s.camera.setCinematicPose(new V(at.x, y + 4, at.z), new V(at.x + Math.cos(az) * 100, y - 2, at.z + Math.sin(az) * 100), 60)
})
await page.waitForTimeout(4000)
await shot('a2-glitter', {})
await page.evaluate(() => window.mira.params.set('sun.timeOfDay', 11))
if (process.argv.includes('--sliders')) {
  await shot('b-chop3', { 'water.chop': 3 })
  await shot('c-chop3-gusts0', { 'water.gusts': 0 })
  await shot('d-detail-off', { 'water.detail': false })
}
console.log(JSON.stringify({ info, errs: errs.slice(0, 10) }))
await browser.close(); app.server.close()
