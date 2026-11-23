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
await page.goto(`${base}?autoplay=1${process.env.QUERY ? `&${process.env.QUERY}` : ""}`, { waitUntil: "load" })
await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 30000 })

// Pin the camera: wrap render so the chase camera cannot move it back.
await page.evaluate(() => {
  const g = window.mira.game
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
  const s = window.mira
  const t = s.terrain
  const L = t.data.layout
  const v = L.volcano
  const road = t.data.roads.find((r) => r.kind === 'volcano')
  const mid = road.points[Math.floor(road.points.length * 0.55)]
  return {
    backend: s.game.backend, fps: Math.round(s.game.fps), genMs: +t.lastGenerateMs.toFixed(1), seed: t.data.seed,
    volcano: { h: v.height, r: v.radius, rc: v.calderaRadius, floor: v.floorHeight, gx: v.gentleX, gz: v.gentleZ },
    summit: t.summit(), pads: L.spawns.map((p) => [p.x, p.z]), mid: [mid.x, mid.y, mid.z],
    rivers: t.data.lava.rivers.map((r) => r.points[Math.floor(r.points.length / 2)]),
  }
})

async function shoot(name, eye, at) {
  await page.evaluate((v) => { window.__view = v }, { eye, at })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${name}.png` })
}

async function views(tag) {
  const i = await info()
  const gy = (px, pz) => page.evaluate(([a, b]) => window.mira.terrain.heightAt(a, b), [px, pz])
  const { gx, gz } = i.volcano
  const S = i.summit
  const eyeAt = async (x, z, up) => [x, (await gy(x, z)) + up, z]
  // From the air, looking across the whole island.
  await shoot(`${tag}-1-aerial`, [gx * 1150 + gz * 500, 620, gz * 1150 - gx * 500], [0, 90, 0])
  // Driver's eye on spawn pad 0 and pad 3, facing the volcano.
  await shoot(`${tag}-2-pad0-eye`, await eyeAt(i.pads[0][0] * 1.02, i.pads[0][1] * 1.02, 3), [0, 170, 0])
  await shoot(`${tag}-3-pad3-eye`, await eyeAt(i.pads[3][0] * 1.02, i.pads[3][1] * 1.02, 3), [0, 170, 0])
  // The volcano road half way up, looking along it toward the summit.
  await shoot(`${tag}-4-road-mid`, [i.mid[0] + gx * 30, i.mid[1] + 12, i.mid[2] + gz * 30], [0, S.rimHeight, 0])
  // On the summit ring road looking across the crater.
  await shoot(`${tag}-5-summit-eye`, await eyeAt(-gx * S.rimRadius, -gz * S.rimRadius, 4), [gx * S.rimRadius, S.rimHeight - 10, gz * S.rimRadius])
  // The summit arena from above.
  await shoot(`${tag}-6-summit-air`, [-gx * 230, S.rimHeight + 150, -gz * 230], [0, S.rimHeight - 20, 0])
  // The steep side with the lava rivers, from the coast.
  await shoot(`${tag}-7-steep-side`, await eyeAt(i.pads[4][0] * 1.02, i.pads[4][1] * 1.02, 3), [0, 170, 0])
  // Top down.
  await shoot(`${tag}-8-top`, [0, 2100, 1], [0, 0, 0])
  return i
}

const report = [await views('default')]
for (const seed of seeds) {
  await page.evaluate((s) => window.mira.params.set('world.seed', s), seed).catch((e) => errors.push(String(e)))
  await page.waitForTimeout(1500)
  report.push(await views(`seed${seed}`))
}
await browser.close()
console.log(JSON.stringify({ report, errors }, null, 2))
