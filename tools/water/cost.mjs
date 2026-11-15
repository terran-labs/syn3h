/**
 * What the Water Lab's features cost to draw, from the driver's seat over deep water.
 * For each case: draw calls and triangles per frame, and the time for the GPU to finish a
 * frame (each frame rendered alone and waited for with queue.onSubmittedWorkDone, so it is
 * GPU plus submission time, not capped by the display's refresh). Median of 40 frames.
 *
 *   node tools/water/cost.mjs [baseUrl] [world]
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'

const base = process.argv[2] ?? 'http://127.0.0.1:5191/'
const world = process.argv[3] ?? 'alpine.7'
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${base}?autoplay=1&world=${world}&room=cost${Date.now().toString(36)}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 120000 })
const set = (v) => page.evaluate(async (v) => {
  const { params } = await import('/shared/params.ts')
  for (const [id, value] of Object.entries(v)) params.set(id, value, 'local')
}, v)
await set({ 'world.seaKind': 1 })
// Park over deep water, as tools/water/shots.mjs finds it.
await page.evaluate(() => {
  const t = window.syn3h.terrain, size = t.wrapSize, sea = t.liquidHeightAt(1e6 + 0.5, 0.5)
  for (let gx = -size / 2; gx < size / 2; gx += 32) for (let gz = -size / 2; gz < size / 2; gz += 32) {
    let clear = true
    for (let k = 0; k <= 120 && clear; k += 8) clear = t.heightAt(gx + k, gz) < sea - 12
    if (clear) { window.__deep = { x: gx, z: gz }; return }
  }
})
const cases = [
  ['old water', { 'water.waves': false, 'water.sinking': false, 'water.underwater': false, 'water.ripples': false, 'water.spray': false }],
  ['waves', { 'water.waves': true }],
  ['waves + ripples + spray', { 'water.waves': true, 'water.ripples': true, 'water.spray': true }],
  ['old water again', { 'water.waves': false, 'water.ripples': false, 'water.spray': false }],
]
const results = []
for (const [name, values] of cases) {
  await set(values)
  await page.evaluate(() => {
    const d = window.__deep, b = window.syn3h.player.body
    b.setTranslation({ x: d.x, y: 1.5, z: d.z }, true)
    b.setRotation({ x: 0, y: Math.sin(-Math.PI / 4), z: 0, w: Math.cos(-Math.PI / 4) }, true)
    b.setLinvel({ x: 14, y: 0, z: 0 }, true)
  })
  await page.waitForTimeout(3000)
  results.push({ name, ...(await page.evaluate(async () => {
    const g = window.syn3h.game, r = g.renderer, device = r.backend?.device
    const times = []
    const auto = r.info.autoReset
    r.info.autoReset = false
    r.info.reset()
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now()
      r.render(g.scene, g.camera)
      if (device) await device.queue.onSubmittedWorkDone()
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const calls = Math.round((r.info.render.drawCalls ?? r.info.render.calls) / 40), triangles = Math.round(r.info.render.triangles / 40)
    r.info.autoReset = auto
    return { backend: g.backend, ms: +times[20].toFixed(2), p90: +times[36].toFixed(2), calls, triangles }
  })) })
}
await browser.close()
console.log(JSON.stringify({ load: loadavg()[0].toFixed(1), errors, results }, null, 1))
