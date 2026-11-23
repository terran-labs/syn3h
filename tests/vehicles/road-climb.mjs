/**
 * Drive the volcano switchback road to the rim with a simple closed loop driver, for judging
 * whether the road is drivable and the vehicle controllable. Writes frames, telemetry and a
 * contact sheet.
 *
 *   node tests/vehicles/road-climb.mjs [url] [outdir] [kind] [seconds]
 *
 * The driver is pure pursuit on the road centreline (terrain.data.roads, kind 'volcano'),
 * steering and throttle through game.input.external like the touch controls. It slows for
 * hairpins by looking at the turn angle ahead. It is a test driver, not a player.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const url = new URL(process.argv[2] ?? 'http://localhost:5182/')
const out = process.argv[3] ?? '/tmp/syn3h-road'
const kind = process.argv[4] ?? 'buggy-syn3h'
const seconds = Number(process.argv[5] ?? 100)
mkdirSync(out, { recursive: true })
url.searchParams.set('autoplay', '1')
url.searchParams.set('vehicle', kind)
url.searchParams.set('room', `road-${Date.now()}-${kind}`)

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url.href)
await page.waitForFunction(() => window.mira?.game?.tick > 10, null, { timeout: 90000 })
await page.waitForTimeout(1500)

const info = await page.evaluate(() => {
  const s = window.mira
  s.params.set('bots.count', 0)
  const road = s.terrain.data.roads.find((r) => r.kind === 'volcano')
  const pts = road.points
  // Start on the road a little way along, facing along it.
  const a = pts[3], b = pts[6]
  const heading = Math.atan2(-(b.x - a.x), -(b.z - a.z))
  s.player.teleport({ x: a.x, y: a.y + 1.5, z: a.z }, heading)
  const ext = s.game.input.external
  const st = { idx: 3, done: false, offRoadMax: 0 }
  const step = () => {
    const p = s.player.body.translation(), v = s.player.body.linvel(), r = s.player.body.rotation()
    // Advance the nearest index (monotone, small window).
    let best = st.idx, bd = Infinity
    for (let i = st.idx; i < Math.min(pts.length, st.idx + 30); i++) {
      const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z)
      if (d < bd) { bd = d; best = i }
    }
    st.idx = best
    st.offRoad = bd
    st.offRoadMax = Math.max(st.offRoadMax, bd)
    if (best >= pts.length - 3) { st.done = true; ext.x = 0; ext.y = 0; ext.brakes = true; return }
    const speed = Math.hypot(v.x, v.y, v.z)
    const look = Math.min(pts.length - 1, best + Math.max(3, Math.round(speed * 0.9 / 4) + 2))
    const t = pts[look]
    // Forward of the vehicle in the ground plane: heading 0 faces -Z.
    const fx = -(2 * (r.x * r.z + r.w * r.y)), fz = -(1 - 2 * (r.x * r.x + r.y * r.y))
    const dx = t.x - p.x, dz = t.z - p.z
    const cross = fx * dz - fz * dx // >0: target to the right of forward (y-up, -Z forward)
    const dot = fx * dx + fz * dz
    const ang = Math.atan2(cross, dot)
    ext.x = Math.max(-1, Math.min(1, ang * 2.2))
    // Hairpin ahead: turn angle over the next ~40 m.
    const i2 = Math.min(pts.length - 1, best + 10), i3 = Math.min(pts.length - 1, best + 20)
    const h1 = Math.atan2(pts[i2].x - pts[best].x, pts[i2].z - pts[best].z)
    const h2 = Math.atan2(pts[i3].x - pts[i2].x, pts[i3].z - pts[i2].z)
    let turn = Math.abs(h2 - h1); if (turn > Math.PI) turn = 2 * Math.PI - turn
    const target = turn > 1.2 ? 7 : turn > 0.6 ? 11 : 18
    ext.y = speed < target ? 1 : speed > target + 3 ? -0.6 : 0.2
    ext.brakes = speed > target + 6
  }
  window.roadDriver = { st, timer: setInterval(step, 50) }
  return { points: pts.length, start: a, end: pts[pts.length - 1] }
})
console.log('road', JSON.stringify(info))

const frames = []
const t0 = Date.now()
for (let i = 0; (Date.now() - t0) / 1000 < seconds; i++) {
  await page.waitForTimeout(2000)
  const t = await page.evaluate(() => {
    const s = window.mira, b = s.player.body, p = b.translation(), v = b.linvel(), r = b.rotation()
    const st = window.roadDriver.st
    return {
      idx: st.idx, done: st.done, offRoad: +st.offRoad.toFixed(1), y: +p.y.toFixed(1),
      speed: +Math.hypot(v.x, v.y, v.z).toFixed(1), upY: +(1 - 2 * (r.x * r.x + r.z * r.z)).toFixed(3),
      wheels: s.player.wheelsGrounded,
    }
  })
  const file = `${out}/${String(i).padStart(3, '0')}.png`
  const png = await page.screenshot({ path: file })
  frames.push({ file, png: png.toString('base64'), ...t, at: ((Date.now() - t0) / 1000).toFixed(0) })
  console.log(String(frames.length).padStart(3), JSON.stringify(t))
  if (t.done) break
}
const summary = await page.evaluate(() => ({ ...window.roadDriver.st }))
const sheet = await page.evaluate(async (frames) => {
  const cols = 5, w = 288, h = 178
  const c = document.createElement('canvas'); c.width = cols * w; c.height = Math.ceil(frames.length / cols) * h
  const g = c.getContext('2d'); g.fillStyle = '#151219'; g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], img = new Image(); img.src = 'data:image/png;base64,' + f.png; await img.decode()
    const x = (i % cols) * w, y = Math.floor(i / cols) * h
    g.drawImage(img, x, y, w, 162); g.fillStyle = '#fff'; g.font = '11px monospace'
    g.fillText(`${f.at}s pt${f.idx} ${f.speed}m/s y${f.y} off${f.offRoad} up${f.upY}`, x + 4, y + 174)
  }
  return c.toDataURL('image/png').split(',')[1]
}, frames)
writeFileSync(`${out}/contact-sheet.png`, Buffer.from(sheet, 'base64'))
writeFileSync(`${out}/telemetry.json`, JSON.stringify({ info, summary, errors, frames: frames.map(({ png, ...f }) => f) }, null, 2))
console.log(JSON.stringify({ summary, errors, sheet: `${out}/contact-sheet.png` }))
await browser.close()
