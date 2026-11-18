/**
 * How strongly tyre marks show against the ground, from the chase camera. Run with the dev
 * server already up (start it directly), the browser through tools/heavy.sh:
 *
 *   node tools/tyre-contrast.mjs <baseUrl> <outDir> <label> [world:kind,...] [hour,...] [tyreSize]
 *
 * For each planet and surface it drives the buggy on that ground in four ways: straight, a
 * gentle turn, a hard slide and braking from speed, at up to 18 m/s. It records where each rear
 * wheel touched, then holds the loop on a drawn frame, projects those points (3 to 18 m behind
 * the car) to the screen with the frame's own camera, and compares the picture there with the
 * ground 1.3 m outside the same wheel. Contrast is (ground - track) / ground luminance, in per
 * cent: positive darker, negative lighter, with the fade-in of new track turned off so the
 * held frame shows settled marks. It saves the frame it measured. Prints one JSON line
 * per measurement and writes <label>-contrast.json.
 */
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5591/'
const out = process.argv[3] ?? '/tmp/tyre-contrast'
const label = process.argv[4] ?? 'run'
const places = (process.argv[5] ?? 'volcanic.1:dust,alpine.7:grass,desert.7:sand,ice.7:ice').split(',').map((s) => s.split(':'))
const hours = (process.argv[6] ?? '12').split(',').map(Number)
const tyre = process.argv[7] ? Number(process.argv[7]) : null
const phone = process.argv[8] === 'phone'
mkdirSync(out, { recursive: true })

const MOVES = {
  straight: { legs: [[0, 0, 60]] },
  gentle: { legs: [[0, 0, 30], [0.25, 0, 40]] },
  slide: { legs: [[0, 0, 30], [0.95, 0, 30]] },
  brake: { legs: [[0, 0, 50], [0, 1, 25]] },
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const rows = []
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
try {
  for (const [world, kind] of places) for (const hour of hours) {
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await page.evaluate(() => window.syn3h.shell.play())
    await page.waitForFunction(() => window.syn3h.game.tick > 60, null, { timeout: 120000 })
    await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
    await page.evaluate(({ hour, tyre }) => {
      const s = window.syn3h
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', hour); s.params.set('sun.dayLength', 0)
      if (tyre) s.params.set('buggy.tyreSize', tyre)
      // Settled strength: the frame is held right after a manoeuvre, so without this the last
      // fraction of a second of track would still be easing in (gfx.tyreMarks.fadeIn).
      if (s.params.get('gfx.tyreMarks.fadeIn')) s.params.set('gfx.tyreMarks.fadeIn', 0)
    }, { hour, tyre })
    for (const [move, { legs }] of Object.entries(MOVES)) {
      // A fresh flat patch of the surface, facing more of it, every time.
      const at = await page.evaluate((kind) => {
        const s = window.syn3h, t = s.terrain, sp = t.spawnPoint(0).position
        const n = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this } }
        const good = (x, z) => t.surfaceAt(x, z) === kind && t.normalAt(x, z, n).y > 0.97 && (t.liquidHeightAt?.(x, z) ?? -Infinity) < t.heightAt(x, z) - 0.5
        window.__tried = (window.__tried ?? 0) + 1
        for (let r = 40 * window.__tried; r < 1500; r += 10) for (let a = 0; a < 48; a++) {
          const ang = (a / 48) * Math.PI * 2, x = sp.x + Math.cos(ang) * r, z = sp.z + Math.sin(ang) * r
          if (!good(x, z)) continue
          for (let h = 0; h < 8; h++) {
            const hd = (h / 8) * Math.PI * 2, dx = -Math.sin(hd), dz = -Math.cos(hd)
            let ok = true
            for (let d = 10; d <= 90 && ok; d += 10) ok = good(x + dx * d, z + dz * d) && good(x + dx * d + dz * 15, z + dz * d - dx * 15) && good(x + dx * d - dz * 15, z + dz * d + dx * 15)
            if (!ok) continue
            s.player.teleport(s.player.object.position.clone().set(x, t.heightAt(x, z) + 1.2, z), hd)
            return { x, z }
          }
        }
        return null
      }, kind)
      if (!at) { rows.push({ world, kind, hour, move, error: 'no flat patch' }); continue }
      await page.waitForTimeout(1500)
      const pts = await page.evaluate(async (legs) => {
        const s = window.syn3h, rec = [[], []]
        for (const [steer, brake, steps] of legs) {
          s.game.input.external.y = brake ? 0 : 1; s.game.input.external.x = steer; s.game.input.external.brakes = Boolean(brake)
          for (let i = 0; i < steps; i++) {
            await new Promise((r) => setTimeout(r, 50))
            const raw = s.player.body.linvel(), speed = Math.hypot(raw.x, raw.z)
            if (speed > 18) s.player.body.setLinvel({ x: raw.x * 18 / speed, y: raw.y, z: raw.z * 18 / speed }, true)
            const w = s.player.getWheelEffects()
            for (const k of [0, 1]) { const c = w[2 + k]; if (c.grounded) rec[k].push([c.point.x, c.point.y, c.point.z]) }
          }
        }
        // Hold this frame: the camera matches what is on screen.
        s.game.pause()
        const cam = s.game.camera, car = s.player.object.position, v = car.clone()
        const res = []
        for (const k of [0, 1]) {
          const path = rec[k]
          for (let i = 1; i < path.length; i++) for (const f of [0, 0.2, 0.4, 0.6, 0.8]) {
            const [x1, y1, z1] = path[i], [px, py, pz] = path[i - 1]
            const x = px + (x1 - px) * (1 - f), y = py + (y1 - py) * (1 - f), z = pz + (z1 - pz) * (1 - f)
            const d = Math.hypot(x - car.x, z - car.z)
            if (d < 3 || d > 18 || Math.hypot(x1 - px, z1 - pz) < 0.05) continue
            // Outward from the car, across the track.
            let sx = -(z1 - pz), sz = x1 - px; const l = Math.hypot(sx, sz); sx /= l; sz /= l
            const side = (x - car.x) * sx + (z - car.z) * sz >= 0 ? 1 : -1
            const p = v.set(x, y + 0.02, z).project(cam), track = [p.x, p.y, p.z]
            const g = v.set(x + sx * side * 1.3, y + 0.02, z + sz * side * 1.3).project(cam), ground = [g.x, g.y, g.z]
            if (Math.abs(track[0]) < 0.98 && Math.abs(track[1]) < 0.98 && Math.abs(ground[0]) < 0.98 && Math.abs(ground[1]) < 0.98 && track[2] < 1) res.push({ track, ground })
          }
        }
        s.game.input.external.y = 0; s.game.input.external.x = 0; s.game.input.external.brakes = false
        return res
      }, legs)
      await page.waitForTimeout(150)
      const file = `${out}/${label}-${world}-${kind}-${hour}h-${move}${tyre ? `-tyre${tyre}` : ''}${phone ? '-phone' : ''}.png`
      const png = await page.screenshot({ path: file })
      await page.evaluate(() => window.syn3h.game.resume())
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
      const L = (nx, ny) => {
        const cx = Math.round((nx + 1) / 2 * info.width), cy = Math.round((1 - ny) / 2 * info.height)
        let sum = 0, n = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy
          if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue
          const i = (y * info.width + x) * info.channels
          sum += lum(data[i], data[i + 1], data[i + 2]); n++
        }
        return sum / n
      }
      let t = 0, g = 0
      for (const p of pts) { t += L(p.track[0], p.track[1]); g += L(p.ground[0], p.ground[1]) }
      const contrast = pts.length ? +(100 * (g - t) / g).toFixed(1) : null
      rows.push({ world, kind, hour, move, tyre, samples: pts.length, contrast, ground: pts.length ? +(g / pts.length).toFixed(1) : null, file, errors })
      console.log(JSON.stringify(rows.at(-1)))
    }
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(`${out}/${label}-contrast.json`, JSON.stringify(rows, null, 2))
