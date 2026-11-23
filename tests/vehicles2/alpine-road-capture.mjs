/**
 * Instrumented copy of Terrain Lab's keyboard driver for an independent road assessment.
 * Keep its steering and speed choices unchanged so a failure remains reproducible.
 * Drives the player's vehicle up the volcano road with a simple keyboard autopilot and
 * reports whether it reached the summit: the check that the road is climbable in the real
 * game, with the real vehicle physics.
 *
 *   node tools/terrainlab/drive-road.mjs [baseUrl] [seed] [screenshotDir]
 *
 * Steering: aim at a point on the centreline a few points ahead, tap A or D toward it,
 * hold W below a target speed. Exits non zero if the vehicle does not reach the summit.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const seed = process.argv[3] ?? ''
const cruise = Number(process.env.ROAD_SPEED ?? 13)
const shots = process.argv[4] ?? '/tmp/drive-road'
mkdirSync(shots, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
await page.goto(`${base}?autoplay=1${seed ? `&seed=${seed}` : ""}${process.env.QUERY ? `&${process.env.QUERY}` : ""}`, { waitUntil: "load" })
await page.waitForFunction(() => window.mira?.game?.tick > 40, null, { timeout: 60000 })
await page.keyboard.press('KeyH').catch(() => {}) // dismiss the controls card if it is up

const read = () => page.evaluate(() => {
  const s = window.mira
  const t = s.terrain
  const road = t.roadPaths().find((r) => r.kind === 'volcano')
  const b = s.player.body
  const p = b.translation()
  const q = b.rotation()
  const v = b.linvel()
  // Forward is -Z rotated by the body's quaternion.
  const fx = -(2 * (q.x * q.z + q.w * q.y))
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
  window.__idx ??= 0
  // Nearest road point, searching forward from the last one so switchbacks cannot confuse it.
  let best = window.__idx, bd = Infinity
  for (let i = window.__idx; i < Math.min(road.points.length, window.__idx + 40); i++) {
    const r = road.points[i]
    const d = (r.x - p.x) ** 2 + (r.z - p.z) ** 2
    if (d < bd) { bd = d; best = i }
  }
  window.__idx = best
  const tgt = road.points[Math.min(road.points.length - 1, best + 5)]
  return {
    input: {...s.player.input}, wheels: s.player.wheelsGrounded, idx: best, n: road.points.length, off: Math.sqrt(bd), x: p.x, y: p.y, z: p.z, fx, fz,
    tx: tgt.x - p.x, tz: tgt.z - p.z, speed: Math.hypot(v.x, v.z), ground: t.heightAt(p.x, p.z),
    summit: t.summit(), up: 1 - 2 * (q.x * q.x + q.z * q.z),
  }
})

const trace = []
const held = new Set()
const hold = async (key, on) => {
  if (on && !held.has(key)) { held.add(key); await page.keyboard.down(key) }
  if (!on && held.has(key)) { held.delete(key); await page.keyboard.up(key) }
}

const start = Date.now()
let worstOff = 0, last = null, stuckSince = Date.now(), lastIdx = 0, shot = 0
while (Date.now() - start < 420000) {
  const s = await read()
  trace.push({ms: Date.now()-start, ...s})
  last = s
  worstOff = Math.max(worstOff, s.off)
  if (s.idx > lastIdx) { lastIdx = s.idx; stuckSince = Date.now() }
  if (s.idx >= s.n - 3) break
  if (Date.now() - stuckSince > 40000) break
  const fl = Math.hypot(s.fx, s.fz) || 1, tl = Math.hypot(s.tx, s.tz) || 1
  const cross = (s.fx * s.tz - s.fz * s.tx) / (fl * tl)
  const dot = (s.fx * s.tx + s.fz * s.tz) / (fl * tl)
  await hold('KeyD', cross > 0.06)
  await hold('KeyA', cross < -0.06)
  // Slow for sharp turns, otherwise hold a steady climb speed.
  const want = dot < 0.9 ? Math.min(7, cruise * 0.55) : cruise
  await hold('KeyW', s.speed < want)
  await hold('ShiftLeft', s.speed > want + (process.env.ROAD_SPEED ? 1 : 5))
  if (s.idx > (shot + 1) * (s.n / 5)) { shot++; await page.screenshot({ path: `${shots}/drive-${shot}.png` }) }
  await page.waitForTimeout(60)
}
for (const k of [...held]) await page.keyboard.up(k)
await page.waitForTimeout(1500)
await page.screenshot({ path: `${shots}/drive-end.png` })
const end = await read()
writeFileSync(`${shots}/trace.json`, JSON.stringify({trace,end,errors},null,2))
await browser.close()
const reached = end.idx >= end.n - 3 && Math.abs(end.y - end.summit.rimHeight) < 8
console.log(JSON.stringify({
  seed: seed || 'default', reached, seconds: Math.round((Date.now() - start) / 1000), roadPoints: end.n, atPoint: end.idx,
  worstOffCentre: +worstOff.toFixed(1), endHeight: +end.y.toFixed(1), summitHeight: +end.summit.rimHeight.toFixed(1),
  upright: +end.up.toFixed(2), errors,
}, null, 1))
if (!reached) { console.error('DRIVE FAILED'); process.exit(1) }
console.log('DRIVE OK')
