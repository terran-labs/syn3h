/**
 * Terrain Lab screenshots: loads the running game and renders fixed camera views of the
 * terrain (aerial, oblique, rim, ground) for one or more seeds.
 *
 *   node tools/terrainlab/shots.mjs [baseUrl] [outDir] [seed,seed,...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const out = process.argv[3] ?? '/tmp/terrainlab-shots'
const seeds = (process.argv[4] ?? '').split(',').filter(Boolean).map(Number)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
await page.goto(`${base}?autoplay=1`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 30000 })

// Pin the camera: wrap render so the chase camera cannot move it back.
await page.evaluate(() => {
  const g = window.syn3h.game
  const orig = g.renderer.render.bind(g.renderer)
  window.__view = null
  g.renderer.render = (scene, cam) => {
    const v = window.__view
    if (v) {
      cam.position.set(v.eye[0], v.eye[1], v.eye[2])
      cam.lookAt(v.at[0], v.at[1], v.at[2])
      cam.updateMatrixWorld()
    }
    return orig(scene, cam)
  }
})

const info = () => page.evaluate(() => {
  const s = window.syn3h
  const t = s.terrain
  const v = t.data.layout.volcano
  return {
    backend: s.game.backend, fps: Math.round(s.game.fps), genMs: +t.lastGenerateMs.toFixed(1),
    seed: t.data.seed, volcano: { x: v.x, z: v.z, h: v.height, r: v.radius, rc: v.calderaRadius, floor: v.floorHeight },
    cones: t.data.layout.cones.map((c) => [c.x | 0, c.z | 0, c.height | 0]),
    mesas: t.data.layout.mesas.map((m) => [m.x | 0, m.z | 0, m.height | 0]),
  }
})

async function shoot(name, eye, at) {
  await page.evaluate((v) => { window.__view = v }, { eye, at })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${name}.png` })
}

async function views(tag) {
  const i = await info()
  const { x, z, h, r, rc, floor } = i.volcano
  const gy = (px, pz) => page.evaluate(([a, b]) => window.syn3h.terrain.heightAt(a, b), [px, pz])
  const len = Math.hypot(x, z) || 1
  const ux = x / len, uz = z / len // spawn toward volcano
  await shoot(`${tag}-1-top`, [0, 2600, 1], [0, 0, 0])
  await shoot(`${tag}-2-oblique`, [-ux * 900, 520, -uz * 900], [x, h * 0.3, z])
  await shoot(`${tag}-3-spawn-eye`, [0, (await gy(0, 0)) + 3, 0], [x, h * 0.5, z])
  const fx = x - ux * (r * 1.15), fz = z - uz * (r * 1.15)
  await shoot(`${tag}-4-foot-eye`, [fx, (await gy(fx, fz)) + 3, fz], [x, h * 0.8, z])
  const rx = x - ux * rc, rz = z - uz * rc
  await shoot(`${tag}-5-rim-into-crater`, [rx, (await gy(rx, rz)) + 6, rz], [x, floor, z])
  await shoot(`${tag}-6-rim-outward`, [rx, (await gy(rx, rz)) + 6, rz], [0, 0, 0])
  await shoot(`${tag}-7-crater-air`, [x - ux * rc * 2.2, h + 120, z - uz * rc * 2.2], [x, floor, z])
  const m = i.mesas[0]
  if (m) await shoot(`${tag}-8-mesa-eye`, [m[0] + 260, (await gy(m[0] + 260, m[1])) + 4, m[1]], [m[0], m[2] * 0.5, m[1]])
  return i
}

const report = [await views('default')]
for (const seed of seeds) {
  await page.evaluate((s) => window.syn3h.params.set('world.seed', s), seed).catch((e) => errors.push(String(e)))
  await page.waitForTimeout(1500)
  report.push(await views(`seed${seed}`))
}
await browser.close()
console.log(JSON.stringify({ report, errors }, null, 2))
