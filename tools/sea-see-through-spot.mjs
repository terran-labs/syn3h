// One frame at a spot the scan found (tools/sea-see-through-scan.ts): lens 1.2 m over the sea.
//   tools/heavy.sh node tools/sea-see-through-spot.mjs <out.png> <planet> <seed> <planetSize> <roundness> <x> <z> <heading> <pitchDeg>
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { serveStable } from './serve-stable.mjs'
const [outPng, planet, seed, planetSize, roundness, x, z, heading, pitch] = process.argv.slice(2)
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error('port not ours')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await page.goto(`http://127.0.0.1:${port}/?autoplay=1&planet=${planet}&seed=${seed}&room=sp${Date.now().toString(36)}&daydream=0`)
await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
await page.evaluate(({ planetSize, roundness }) => { const s = window.mira; s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', 3); s.params.set('terrain.planetSize', planetSize); s.params.set('world.curve', roundness); for (const el of document.body.querySelectorAll('*')) if (!el.contains(document.querySelector('canvas')) && el !== document.querySelector('canvas')) el.style.visibility = 'hidden' }, { planetSize: Number(planetSize), roundness: Number(roundness) })
await page.waitForTimeout(5000)
await page.evaluate(({ x, z, h, p }) => {
  const s = window.mira, t = s.terrain, V = s.game.camera.position.constructor, y = t.liquidHeightAt(x, z) + 1.2
  s.player.teleport({ x: x + 400, y: t.heightAt(x + 400, z) + 2, z }, 0)
  // Looking a third of the way between level and the pitch the scan found, so both show.
  const down = Math.tan((p * Math.PI) / 180) * 0.6
  s.camera.setCinematicPose(new V(x, y, z), new V(x - Math.sin(h) * 100, y - 100 * down, z - Math.cos(h) * 100), 60)
}, { x: Number(x), z: Number(z), h: Number(heading), p: Number(pitch) })
// The pose eases in; wait until the camera has arrived (see sea-see-through-frames.mjs).
await page.waitForFunction(() => { const s = window.mira, c = s.camera.cinematic, cam = s.game.camera; return !c || (Math.hypot(cam.position.x - c.position.x, cam.position.z - c.position.z) < 0.05 && c.look.distanceTo(c.target) < 0.1) }, null, { timeout: 30000, polling: 200 }).catch(() => console.log('unsettled'))
await page.waitForTimeout(800)
await page.screenshot({ path: outPng })
await browser.close(); await app.close(); process.exit(0)
