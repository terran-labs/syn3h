/**
 * Water Lab screenshots with the game's own chase camera on a round, wrapping world.
 *
 *   node tools/water/shots.mjs [baseUrl] [outDir] [world] [extra params JSON]
 *
 * Places the player at the coast facing the sea, beside a river, and in deep water, and
 * shoots each with the new water off and on.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5191/'
const out = process.argv[3] ?? '/tmp/water-shots'
const world = process.argv[4] ?? 'alpine.7'
const extra = JSON.parse(process.argv[5] ?? '{}')
const only = process.argv[6] ? process.argv[6].split(',') : null
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`${base}?autoplay=1&world=${world}&room=water${Date.now().toString(36)}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 120000 })

const setParams = (values) => page.evaluate(async (v) => {
  const { params } = await import('/shared/params.ts')
  for (const [id, value] of Object.entries(v)) params.set(id, value, 'local')
}, values)

await setParams({ 'world.seaKind': 1, ...extra })
await page.waitForTimeout(500)

const spots = await page.evaluate(() => {
  const t = window.syn3h.terrain
  const sea = t.liquidHeightAt(1e6 + 0.5, 0.5)
  const size = t.wrapSize
  // Walk out from the centre until the ground drops under the sea: the coast.
  let coast = null
  for (const a of [0, 1.3, 2.6, 3.9, 5.2]) {
    for (let r = 50; r < size / 2; r += 4) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (t.heightAt(x, z) < sea - 0.5) { coast = { x: x - Math.cos(a) * 30, z: z - Math.sin(a) * 30, heading: Math.atan2(-Math.cos(a), -Math.sin(a)), a }; break }
    }
    if (coast) break
  }
  coast.y = t.heightAt(coast.x, coast.z)
  const lava = window.syn3h.terrain.data?.lava
  let river = null
  if (lava?.rivers?.length) {
    const r = lava.rivers.reduce((a, b) => (b.drops?.length ?? 0) > (a.drops?.length ?? 0) ? b : a, lava.rivers[0])
    const i = r.drops?.length ? r.drops[0].end : Math.floor(r.points.length / 2)
    const p = r.points[Math.min(r.points.length - 1, i + 4)], q = r.points[Math.max(0, i - 6)]
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1
    // Downstream of the drop, looking back up it, a little to the side.
    river = { x: p.x - dx / len * 12 + dz / len * 6, z: p.z - dz / len * 12 - dx / len * 6, heading: Math.atan2(-dx, -dz) }
    river.y = t.heightAt(river.x, river.z)
  }
  // Deep water: anywhere on the tile with 12 m of water under a 120 m run in some direction.
  let deep = null
  for (let gx = -size / 2; gx < size / 2 && !deep; gx += 32) {
    for (let gz = -size / 2; gz < size / 2 && !deep; gz += 32) {
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        let clear = true
        for (let k = 0; k <= 120 && clear; k += 8) clear = t.heightAt(gx + Math.cos(a) * k, gz + Math.sin(a) * k) < sea - 12
        if (clear) { deep = { x: gx, z: gz, heading: Math.atan2(-Math.cos(a), -Math.sin(a)) }; break }
      }
    }
  }
  deep.y = sea + 0.3
  return { coast, river, deep, sea }
})

const place = (s) => page.evaluate((p) => {
  const pl = window.syn3h.player
  pl.body.setTranslation({ x: p.x, y: p.y + 1.5, z: p.z }, true)
  pl.body.setRotation({ x: 0, y: Math.sin(p.heading / 2), z: 0, w: Math.cos(p.heading / 2) }, true)
  pl.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  pl.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
}, s)

const report = { spots, shots: [] }
const shots = [
  ['coast-old', spots.coast, { 'water.waves': false }],
  ['coast-new', spots.coast, { 'water.waves': true, 'water.waveHeight': 1.6 }],
  ['river-new', spots.river, { 'water.waves': true }],
  ['deep-new', spots.deep, { 'water.waves': true, 'water.waveHeight': 2.4 }],
  ['deep-sink', spots.deep, { 'water.waves': true, 'water.sinking': true }],
  ['under-all', spots.deep, { 'water.waves': true, 'water.sinking': true, 'water.underwater': true, 'water.ripples': true, 'water.spray': true }],
  ['skim-all', spots.deep, { 'water.waves': true, 'water.sinking': true, 'water.underwater': true, 'water.ripples': true, 'water.spray': true }, 16],
]
for (const [name, spot, values, speed] of shots) {
  if (only && !only.includes(name)) continue
  if (!spot) continue
  await setParams(values)
  await place(spot)
  if (speed) {
    // Hold a speed along the heading for a few seconds: a skimming run.
    const end = Date.now() + 3000
    const trace = []
    while (Date.now() < end) {
      trace.push(await page.evaluate(([v, h]) => {
        const b = window.syn3h.player.body, l = b.linvel(), p = b.translation(), t = window.syn3h.terrain
        b.setLinvel({ x: -Math.sin(h) * v, y: l.y, z: -Math.cos(h) * v }, true)
        return [+(p.y - t.liquidHeightAt(p.x, p.z)).toFixed(2), +t.heightAt(p.x, p.z).toFixed(1), +l.y.toFixed(1)]
      }, [speed, spot.heading]))
      await page.waitForTimeout(100)
    }
    report.trace = trace
  } else if (name === 'under-all' || name === 'deep-sink') {
    const trace = []
    for (let i = 0; i < 30; i++) {
      trace.push(await page.evaluate(() => {
        const b = window.syn3h.player.body, l = b.linvel(), p = b.translation(), t = window.syn3h.terrain
        return [+(p.y - t.liquidHeightAt(p.x, p.z)).toFixed(2), +l.y.toFixed(2)]
      }))
      await page.waitForTimeout(500)
    }
    report[name + 'Trace'] = trace
  } else await page.waitForTimeout(3500)
  const state = await page.evaluate(() => {
    const b = window.syn3h.player.body.translation(), t = window.syn3h.terrain
    return { y: b.y, surface: t.liquidHeightAt(b.x, b.z), ground: t.heightAt(b.x, b.z) }
  })
  report.shots.push({ name, state })
  await page.screenshot({ path: `${out}/${name}.png` })
}
await browser.close()
console.log(JSON.stringify({ out, errors: errors.slice(0, 10), ...report }, null, 1))
