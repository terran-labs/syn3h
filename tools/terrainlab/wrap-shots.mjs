/**
 * Wrapping world check: pins the camera at the edge of the tile and looks past it, then
 * teleports the player across the seam and checks it settles on the ground on both sides.
 *
 *   tools/heavy.sh node tools/terrainlab/wrap-shots.mjs [baseUrl] [outDir] [planetSize]
 *
 * Pass condition, read from the PNGs: land and sea continue past the old edge with no gap,
 * hard line or missing chunk, and the view out of the +x edge matches the view out of the
 * -x edge's image (shot 1 versus shot 1b).
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5198/'
const out = process.argv[3] ?? '/tmp/terrainlab-wrap'
const planet = process.argv[4]
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
const room = `wrap${Math.floor(Math.random() * 1e9)}`
await page.goto(`${base}?autoplay=1&room=${room}${process.env.QUERY ? `&${process.env.QUERY}` : ''}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 60000 })

if (planet !== undefined) {
  await page.evaluate((p) => window.syn3h.params.set('terrain.planetSize', p), Number(planet))
  await page.waitForTimeout(4000)
}

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

const gy = (x, z) => page.evaluate(([a, b]) => window.syn3h.terrain.heightAt(a, b), [x, z])
const size = await page.evaluate(() => window.syn3h.terrain.size)
const half = size / 2

/** Frame metrics averaged over about two seconds of the current view. */
const sample = () => page.evaluate(async () => {
  const g = window.syn3h.game
  const acc = { frameMs: 0, physicsMs: 0, drawCalls: 0, triangles: 0, n: 0 }
  const t = performance.now()
  while (performance.now() - t < 2000) {
    await new Promise((r) => requestAnimationFrame(r))
    const m = g.performance
    acc.frameMs += m.frameMs; acc.physicsMs += m.physicsMs; acc.drawCalls += m.drawCalls; acc.triangles += m.triangles; acc.n++
  }
  const stats = window.syn3h.terrain.triangleStats?.()
  const r = (v) => +(v / acc.n).toFixed(1)
  return { frameMs: r(acc.frameMs), physicsMs: r(acc.physicsMs), drawCalls: r(acc.drawCalls), triangles: Math.round(acc.triangles / acc.n), terrain: stats }
})

const shots = []
async function shoot(name, eye, at) {
  await page.evaluate((v) => { window.__view = v }, { eye, at })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${name}.png` })
  shots.push({ name, eye: eye.map((v) => +v.toFixed(1)), at: at.map((v) => +v.toFixed(1)), metrics: await sample() })
}

// A z along the +x edge where the ground just past the seam is land, if any.
let zLand = 0
let best = -Infinity
for (let z = -half; z < half; z += 16) {
  const h = Math.min(await gy(half + 60, z), await gy(half - 20, z))
  if (h > best) { best = h; zLand = z }
}
const sea = await page.evaluate(() => window.syn3h.params.get('world.lavaAltitude')?.value ?? 0)
const eyeY = (await gy(half - 20, zLand)) + 3
const eyeYSea = Math.max(eyeY, sea + 3) + 25

// 1: 20 m inside the +x edge, looking out across the seam.
await shoot('1-plusx-edge-out', [half - 20, eyeYSea, zLand], [half + 600, eyeYSea - 40, zLand])
// 1b: the same view from the image 20 m outside the -x edge (should match shot 1).
await shoot('1b-minusx-image-out', [-half - 20, eyeYSea, zLand], [-half + 600, eyeYSea - 40, zLand])
// 2: at the +x +z corner, looking out diagonally.
const cy = Math.max((await gy(half - 20, half - 20)) + 3, sea + 3)
await shoot('2-corner-out', [half - 20, cy, half - 20], [half + 400, cy - 30, half + 400])
// 3: flying 300 m above the +x edge, looking along it.
const fy = Math.max(await gy(half, -half * 0.5), sea) + 300
await shoot('3-edge-flight', [half, fy, -half * 0.5], [half, fy - 260, half * 0.3])
// 4: 600 m above the +x edge looking straight down: the seam runs down the middle of the frame.
await shoot('4-seam-topdown', [half, 600, zLand + 1], [half, 0, zLand])

// Release the camera for the teleport test.
await page.evaluate(() => { window.__view = null })

/** Teleport the player to (x, z), wait, and report how far its body sits above the ground. */
async function settle(label, x, z) {
  await page.evaluate(([a, b]) => {
    const s = window.syn3h
    const ground = s.terrain.heightAt(a, b)
    const liquid = s.terrain.liquidHeightAt?.(a, b) ?? -Infinity
    // A Vector3 without importing three: clone one the page already has.
    s.player.teleport(s.game.camera.position.clone().set(a, Math.max(ground, liquid) + 2, b), 0)
  }, [x, z])
  await page.waitForTimeout(3500)
  return page.evaluate(([l]) => {
    const s = window.syn3h
    const p = s.player.body.translation()
    const ground = s.terrain.heightAt(p.x, p.z)
    const liquid = s.terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity
    return { label: l, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), ground: +ground.toFixed(2), liquid: +liquid.toFixed(2), aboveGround: +(p.y - ground).toFixed(2) }
  }, [label])
}

// Find a fairly flat dry spot near the +x edge for the vehicle.
let tz = zLand
const flat = await page.evaluate(([h, s]) => {
  const t = window.syn3h.terrain
  const sea = window.syn3h.params.get('world.lavaAltitude')?.value ?? 0
  let bestZ = null, bestSlope = Infinity
  for (let z = -h; z < h; z += 8) {
    const a = t.heightAt(h - 15, z), b = t.heightAt(h - 25, z), c = t.heightAt(h - 15, z + 10)
    if (a < sea + 2 || (t.liquidKindAt?.(h - 15, z) ?? null)) continue
    const slope = Math.abs(a - b) + Math.abs(a - c)
    if (slope < bestSlope) { bestSlope = slope; bestZ = z }
  }
  return { bestZ, bestSlope }
}, [half, size])
if (flat.bestZ !== null) tz = flat.bestZ
const teleports = [
  await settle('inside +x edge', half - 15, tz),
  await settle('same spot minus size (past the -x edge, in the collider margin)', half - 15 - size, tz),
  await settle('inside +x edge again', half - 15, tz),
]

await browser.close()
console.log(JSON.stringify({ size, zLand, edgeGround: best, sea, flat, shots, teleports, errors }, null, 2))
