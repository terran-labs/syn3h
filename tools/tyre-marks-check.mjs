/**
 * Tyre marks and wheel dust, captured and measured. Run through tools/heavy.sh:
 *
 *   node tools/tyre-marks-check.mjs <baseUrl> <outDir> <label> [shots|perf|all]
 *
 * shots: the buggy (and the tank on grass and ice) driven straight and then slid round a hard
 * turn on grass, sand and ice by day, grass by night, and across a boundary between two
 * surfaces, from the chase camera, at desktop (1280x720) and phone (390x844) size.
 *
 * perf: the buggy circles on grass until the mark ring is full (a long session's worth), then
 * holds still with the marks in view while frame time, draw calls and triangles are sampled
 * for three seconds, at desktop size and at phone size with the CPU throttled four times.
 * Prints one JSON line per measurement.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5393/'
const out = process.argv[3] ?? '/tmp/tyre-marks'
const label = process.argv[4] ?? 'run'
const what = process.argv[5] ?? 'all'
mkdirSync(out, { recursive: true })
const DESKTOP = { width: 1280, height: 720 }, PHONE = { width: 390, height: 844 }

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const results = []

async function open(world, vehicle, viewport, hour = 11) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=${vehicle}&world=${world}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.mira.shell.play())
  await page.waitForFunction(() => window.mira.game.tick > 60, null, { timeout: 120000 })
  // Only the world in the pictures.
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
  await page.evaluate((hour) => {
    const s = window.mira
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', hour); s.params.set('sun.dayLength', 0)
    // Steady weather, so wind does not move the dust differently between runs.
    try { s.params.set('weather.storminess', 0) } catch { /* absent */ }
  }, hour)
  return { page, errors }
}

/** Drive: [steer, 50 ms steps] legs at up to `cap` m/s, counting the surfaces under the wheels. */
function drive(page, legs, cap = 14) {
  return page.evaluate(async ({ legs, cap }) => {
    const s = window.mira, kinds = {}
    for (const [steer, steps] of legs) {
      s.game.input.external.y = 1; s.game.input.external.x = steer
      for (let i = 0; i < steps; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const raw = s.player.body.linvel(), speed = Math.hypot(raw.x, raw.z)
        if (speed > cap) s.player.body.setLinvel({ x: raw.x * cap / speed, y: raw.y, z: raw.z * cap / speed }, true)
        const p = s.player.object.position
        const k = s.terrain.surfaceAt?.(p.x, p.z)
        if (k) kinds[k] = (kinds[k] ?? 0) + 1
      }
    }
    s.game.input.external.y = 0; s.game.input.external.x = 0
    return kinds
  }, { legs, cap })
}

/** Move the player to a flat spot where the ground under it changes kind within a few metres ahead. */
function toBoundary(page, want) {
  return page.evaluate((want) => {
    const s = window.mira, t = s.terrain, sp = t.spawnPoint(0).position
    const n = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this } }
    for (let r = 10; r < 600; r += 6) {
      for (let a = 0; a < 64; a++) {
        const ang = (a / 64) * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
        const k0 = t.surfaceAt(x, z)
        if (want && k0 !== want[0]) continue
        for (let h = 0; h < 8; h++) {
          const hd = (h / 8) * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
          const k1 = t.surfaceAt(x + dx * 14, z + dz * 14)
          if (k1 === k0 || (want && k1 !== want[1])) continue
          if (t.normalAt(x, z, n).y < 0.95 || t.normalAt(x + dx * 14, z + dz * 14, n).y < 0.95) continue
          if ((t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z) - 0.5) continue
          s.player.teleport(s.player.object.position.clone().set(x, t.heightAt(x, z) + 1.2, z), hd)
          return { from: k0, to: k1, x, z, heading: hd }
        }
      }
    }
    return null
  }, want)
}

/** Move the player to a flat open patch of `kind`, facing 40 m more of it. */
function toSurface(page, kind) {
  return page.evaluate((kind) => {
    const s = window.mira, t = s.terrain, sp = t.spawnPoint(0).position
    const n = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this } }
    const good = (x, z) => t.surfaceAt(x, z) === kind && t.normalAt(x, z, n).y > 0.96 && (t.liquidHeightAt?.(x, z) ?? -Infinity) < t.heightAt(x, z) - 0.5
    for (let r = 0; r < 900; r += 8) {
      for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
        if (!good(x, z)) continue
        for (let h = 0; h < 8; h++) {
          const hd = (h / 8) * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
          let ok = true
          for (let d = 8; d <= 48 && ok; d += 8) ok = good(x + dx * d, z + dz * d) && good(x + dx * d + dz * 12, z + dz * d - dx * 12)
          if (!ok) continue
          s.player.teleport(s.player.object.position.clone().set(x, t.heightAt(x, z) + 1.2, z), hd)
          return { kind, x, z, heading: hd }
        }
      }
    }
    return null
  }, kind)
}

async function shot(page, name) { await page.screenshot({ path: `${out}/${label}-${name}.png` }) }

if (what === 'shots' || what === 'all') {
  const cases = [
    ['alpine.7', 'buggy', 'grass', 11, DESKTOP, 'grass'],
    ['alpine.7', 'buggy', 'grass-phone', 11, PHONE, 'grass'],
    ['desert.7', 'buggy', 'sand', 11, DESKTOP, 'sand'],
    ['desert.7', 'buggy', 'sand-phone', 11, PHONE, 'sand'],
    ['ice.7', 'buggy', 'ice', 11, DESKTOP, 'ice'],
    ['alpine.7', 'buggy', 'grass-night', 23, DESKTOP, 'grass'],
    ['alpine.7', 'tank', 'tank-grass', 11, DESKTOP, 'grass'],
    ['ice.7', 'tank', 'tank-ice', 11, DESKTOP, 'ice'],
    ['volcanic.1', 'buggy', 'volcanic', 11, DESKTOP, 'dust'],
    ['moon.7', 'buggy', 'moon', 11, DESKTOP, 'regolith'],
  ]
  for (const [world, vehicle, name, hour, vp, kind] of cases) {
    const { page, errors } = await open(world, vehicle, vp, hour)
    try {
      await toSurface(page, kind)
      await page.waitForTimeout(1200)
      const kinds = await drive(page, [[0, 40], [0.9, 30], [-0.6, 14]])
      // Mid-slide: dust in the air and fresh marks.
      await shot(page, `${name}-slide`)
      await drive(page, [[0, 10]])
      await page.waitForTimeout(700)
      await shot(page, name)
      const marks = await page.evaluate(() => window.mira.game.scene.userData.vehicleEffects?.marks ?? 0)
      results.push({ shot: name, world, vehicle, kinds, marks, errors })
      console.log(JSON.stringify(results.at(-1)))
    } finally { await page.close() }
  }
  // A boundary between two surfaces, by day.
  for (const [world, want] of [['alpine.7', ['grass', 'sand']], ['desert.7', null]]) {
    const { page, errors } = await open(world, 'buggy', DESKTOP)
    try {
      const at = await toBoundary(page, want)
      await page.waitForTimeout(800)
      const kinds = at ? await drive(page, [[0, 30], [0.8, 20]], 12) : {}
      await page.waitForTimeout(500)
      await shot(page, `boundary-${world}`)
      results.push({ shot: `boundary-${world}`, at, kinds, errors })
      console.log(JSON.stringify(results.at(-1)))
    } finally { await page.close() }
  }
}

if (what === 'look') {
  // One grass circle with an optional strength, for tuning by eye.
  const strength = process.argv[6]
  const [world, kind] = (process.argv[7] ?? 'alpine.7:grass').split(':')
  const { page } = await open(world, 'buggy', DESKTOP)
  await toSurface(page, kind)
  await page.waitForTimeout(1200)
  if (strength) await page.evaluate((v) => window.mira.params.set('gfx.tyreMarks.strength', Number(v)), strength)
  await drive(page, [[0.85, 160]], 16)
  await page.waitForTimeout(800)
  console.log(JSON.stringify(await page.evaluate(() => ({ quality: window.mira.params.get('gfx.quality').value, strength: window.mira.params.get('gfx.tyreMarks.strength')?.value, life: window.mira.params.get('gfx.tyreMarks.life')?.value, marks: window.mira.game.scene.userData.vehicleEffects?.marks }))))
  await shot(page, `look-${kind}-${strength ?? 'default'}`)
  await page.close()
}

if (what === 'perf' || what === 'all') {
  for (const [name, vp, throttle] of [['desktop', DESKTOP, 1], ['phone-4x', PHONE, 4]]) {
    const { page, errors } = await open('alpine.7', 'buggy', vp)
    try {
      await toSurface(page, 'grass')
      await page.waitForTimeout(1200)
      // Circle until the 1,024 quad ring is full: a long session's marks, all near the camera.
      await drive(page, [[0.85, 700]], 16)
      await page.waitForTimeout(1500)
      const cdp = await page.context().newCDPSession(page)
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
      const m = await page.evaluate(async () => {
        const g = window.mira.game, fx = g.scene.userData.vehicleEffects
        const frames = []
        let last = performance.now(), dc = 0, tri = 0, n = 0
        await new Promise((resolve) => {
          const t0 = performance.now()
          const tick = () => {
            const now = performance.now(); frames.push(now - last); last = now
            dc += g.performance.drawCalls; tri += g.performance.triangles; n++
            if (now - t0 < 3000) requestAnimationFrame(tick); else resolve()
          }
          requestAnimationFrame(tick)
        })
        frames.sort((a, b) => a - b)
        const mean = frames.reduce((a, b) => a + b, 0) / frames.length
        return {
          frames: frames.length, meanMs: +mean.toFixed(2), p50: +frames[frames.length >> 1].toFixed(2), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(2),
          drawCalls: Math.round(dc / n), triangles: Math.round(tri / n), marks: fx?.marks ?? null, markVertices: (fx?.marks ?? 0) * 4,
          fxUpdateMs: +(fx?.updateMs ?? 0).toFixed(3),
        }
      })
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      await shot(page, `perf-${name}`)
      results.push({ perf: name, ...m, errors })
      console.log(JSON.stringify(results.at(-1)))
    } finally { await page.close() }
  }
}
await browser.close()
writeFileSync(`${out}/${label}-report.json`, JSON.stringify(results, null, 2))
