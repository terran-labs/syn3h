/**
 * Where is the water, in the real game? Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/water-surface-browser.mjs <output directory> [--frames]
 *
 * Serves dist/ from this checkout in this process (and checks the port's listener is this
 * process). On a desert world with rivers and a lake, and on an archipelago sea, at Low, Medium
 * and High, on WebGPU and WebGL 2, at phone and desktop sizes, it samples at the same instant:
 * the physics surface (terrain.liquidHeightAt), its rest height (liquidLevelAt), and the drawn
 * surface's rest height, read by casting a ray down onto the game's own water meshes. With
 * --frames it also saves frames (phone landscape, Medium, WebGPU): a buggy and a hovercraft
 * afloat on a river from the side, and the lens crossing the surface on a river, a lake and the
 * sea, still and in a moving vehicle.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-surface/run'
const frames = process.argv.includes('--frames')
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]
if (Number(listener) !== process.pid) throw new Error(`port ${port} is not ours: ${listener} vs ${process.pid}`)
const base = `http://127.0.0.1:${port}/`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], rows = []

async function open(planet, seed, { webgl = false, quality = 2, viewport = { width: 1280, height: 720 }, vehicle = 'buggy' } = {}) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&vehicle=${vehicle}&planet=${planet}&seed=${seed}&room=ws${Date.now().toString(36)}${webgl ? '&webgl=1' : ''}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
  await page.evaluate((q) => { const s = window.syn3h; s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 12); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', q) }, quality)
  await page.waitForTimeout(3000)
  return { ctx, page }
}

/** In the page: physics against drawn at points of rivers, lakes or the sea. */
function sample(which) {
  const s = window.syn3h, t = s.terrain, lava = t.data.lava, out = []
  const meshes = []
  s.game.scene.traverse((o) => { if (o.isMesh && o.userData.spacing !== undefined && o.visible !== false) meshes.push(o) })
  const drawnRest = (x, z) => {
    let best = -Infinity
    for (const m of meshes) {
      const g = m.geometry, pos = g.getAttribute('position'), idx = g.getIndex()
      if (!pos || !idx) continue
      m.updateMatrixWorld()
      const e = m.matrixWorld.elements
      const P = (i) => [pos.getX(i) * e[0] + pos.getY(i) * e[4] + pos.getZ(i) * e[8] + e[12], pos.getX(i) * e[1] + pos.getY(i) * e[5] + pos.getZ(i) * e[9] + e[13], pos.getX(i) * e[2] + pos.getY(i) * e[6] + pos.getZ(i) * e[10] + e[14]]
      // Vertical ray through (x, z): barycentric test per triangle in the xz plane.
      for (let k = 0; k < idx.count; k += 3) {
        const a = P(idx.getX(k)), b = P(idx.getX(k + 1)), c = P(idx.getX(k + 2))
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if (Math.abs(d) < 1e-9) continue
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue
        best = Math.max(best, u * a[1] + v * b[1] + (1 - u - v) * c[1])
      }
    }
    return best
  }
  const points = []
  if (which === 'river') for (const r of lava.rivers) for (let i = 2; i < r.points.length - 2; i += Math.max(1, Math.floor(r.points.length / 25))) points.push(r.points[i])
  if (which === 'lake') for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) for (let k = 0; k < 8; k++) points.push({ x: b.x + Math.cos(k) * b.radius * 0.5, z: b.z + Math.sin(k) * b.radius * 0.5 })
  if (which === 'sea') for (let k = 0; k < 400 && points.length < 30; k++) { const x = (Math.sin(k * 12.9) * 0.5) * t.size, z = (Math.cos(k * 7.3) * 0.5) * t.size; if (t.liquidKindAt(x, z) === 'water' && t.liquidLevelAt(x, z) <= 0.01 + s.params.get('world.lavaAltitude').value) points.push({ x, z }) }
  for (const p of points) {
    if (t.liquidKindAt(p.x, p.z) !== 'water') continue
    const physics = t.liquidHeightAt(p.x, p.z), rest = t.liquidLevelAt(p.x, p.z)
    const drawn = which === 'sea' ? s.params.get('world.lavaAltitude').value : drawnRest(p.x, p.z)
    if (!Number.isFinite(drawn)) continue
    out.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), physics: +physics.toFixed(3), physicsRest: +rest.toFixed(3), drawnRest: +drawn.toFixed(3), restGap: +(rest - drawn).toFixed(3), waves: +(physics - rest).toFixed(3), ground: +t.heightAt(p.x, p.z).toFixed(2) })
  }
  return out
}

const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const q = (f) => s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; return { n: s.length, median: q(0.5), p90: q(0.9), max: q(1), over30cm: s.filter((v) => Math.abs(v) > 0.3).length } }

const PHONE = { width: 844, height: 390 }, DESKTOP = { width: 1280, height: 720 }
for (const config of [
  { quality: 1, webgl: false, viewport: PHONE }, { quality: 2, webgl: false, viewport: PHONE }, { quality: 3, webgl: false, viewport: DESKTOP },
  { quality: 1, webgl: true, viewport: PHONE }, { quality: 3, webgl: true, viewport: DESKTOP },
]) {
  for (const [planet, seed, kinds] of [['desert', 4, ['river', 'lake']], ['archipelago', 4, ['sea', 'river']]]) {
    const { ctx, page } = await open(planet, seed, config)
    const backend = await page.evaluate(() => window.syn3h.game.backend)
    for (const which of kinds) {
      const points = await page.evaluate(sample, which)
      const row = { planet, which, backend, quality: config.quality, viewport: `${config.viewport.width}x${config.viewport.height}`, restGap_m: stats(points.map((p) => p.restGap)), waves_m: stats(points.map((p) => Math.abs(p.waves))) }
      rows.push(row); console.log(JSON.stringify(row))
      await writeFile(`${out}/${planet}-${which}-${backend}-q${config.quality}.json`, JSON.stringify(points, null, 1))
    }
    await ctx.close()
  }
}

if (frames) {
  const { ctx, page } = await open('desert', 4, { viewport: PHONE, quality: 2 })
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })
  // A river stretch with water at least a metre deep.
  const spot = await page.evaluate(() => {
    const t = window.syn3h.terrain
    for (const r of t.data.lava.rivers) for (let i = 3; i < r.points.length - 3; i++) {
      const p = r.points[i], q = r.points[i + 1]
      if (t.liquidKindAt(p.x, p.z) === 'water' && t.liquidHeightAt(p.x, p.z) - t.heightAt(p.x, p.z) > 1) return { x: p.x, z: p.z, h: Math.atan2(-(q.x - p.x), -(q.z - p.z)) }
    }
    return null
  })
  const lake = await page.evaluate(() => { const l = window.syn3h.terrain.data.lava; const b = l.lake ?? l.pools[0]; return b ? { x: b.x, z: b.z } : null })
  /** A side view of the player afloat at (x, z). */
  const sideView = async (name, kind) => {
    await page.evaluate(({ p, kind }) => {
      const s = window.syn3h
      if (s.player.kind !== kind) s.swapVehicle(kind)
      const y = s.terrain.liquidHeightAt(p.x, p.z) + 1
      s.player.teleport({ x: p.x, y, z: p.z }, p.h)
      s.game.input.external.y = 1
    }, { p: spot, kind })
    await page.waitForTimeout(4000)
    await page.evaluate(() => {
      const s = window.syn3h, b = s.player.body.translation(), V = s.game.camera.position.constructor
      const side = new V(Math.cos(s.player.object.rotation.y) * 7, 0.6, -Math.sin(s.player.object.rotation.y) * 7)
      s.camera.setCinematicPose(new V(b.x + side.x, s.terrain.liquidHeightAt(b.x, b.z) + 0.6, b.z + side.z), new V(b.x, b.y, b.z), 50)
    })
    await page.waitForTimeout(1500)
    await shot(`${name}-a`); await page.waitForTimeout(400); await shot(`${name}-b`)
    const at = await page.evaluate(() => { const s = window.syn3h, b = s.player.body.translation(); return { body: b.y, surface: s.terrain.liquidHeightAt(b.x, b.z), kind: s.player.kind } })
    await page.evaluate(() => { window.syn3h.game.input.external.y = 0; window.syn3h.camera.clearCinematicPose() })
    return at
  }
  /** The lens moving down through the surface at (x, z), frames on the way. */
  const crossing = async (name, p) => {
    await page.evaluate((p) => {
      const s = window.syn3h, V = s.game.camera.position.constructor, start = performance.now()
      const y0 = s.terrain.liquidHeightAt(p.x, p.z)
      window.lensMove = () => { const t = Math.min(1, (performance.now() - start) / 3000); const y = y0 + 0.9 - 1.8 * t; s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x + 10, y - 0.6, p.z + 4), 60); if (t < 1) requestAnimationFrame(window.lensMove) }
      window.lensMove()
    }, p)
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(330); await shot(`${name}-${i}`) }
    await page.evaluate(() => window.syn3h.camera.clearCinematicPose())
  }
  const results = {}
  if (spot) {
    results.buggy = await sideView('river-buggy', 'buggy')
    results.hovercraft = await sideView('river-hovercraft', 'hovercraft')
    await page.evaluate(() => window.syn3h.swapVehicle('buggy'))
    await crossing('lens-river', spot)
  }
  if (lake) await crossing('lens-lake', lake)
  // In a moving vehicle: drive into the lake with the chase camera low behind.
  if (lake) {
    await page.evaluate((p) => { const s = window.syn3h; s.player.teleport({ x: p.x + 40, y: s.terrain.heightAt(p.x + 40, p.z) + 1.5, z: p.z }, Math.PI / 2); s.game.input.external.y = 1; s.params.set('camera.height', 0.05) }, lake)
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(400); await shot(`lens-moving-${i}`) }
    await page.evaluate(() => { const s = window.syn3h; s.game.input.external.y = 0; s.params.set('camera.height', s.params.get('camera.height').def.default) })
  }
  await ctx.close()
  const sea = await open('archipelago', 4, { viewport: PHONE, quality: 2 })
  const seaSpot = await sea.page.evaluate(() => { const t = window.syn3h.terrain; for (let k = 0; k < 400; k++) { const x = Math.sin(k * 12.9) * 0.4 * t.size, z = Math.cos(k * 7.3) * 0.4 * t.size; if (t.liquidKindAt(x, z) === 'water' && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 8) return { x, z } } return null })
  if (seaSpot) { const p2 = sea.page; const shot2 = (n) => p2.screenshot({ path: `${out}/${n}.png` });
    await p2.evaluate((p) => { const s = window.syn3h, V = s.game.camera.position.constructor, start = performance.now(), y0 = s.terrain.liquidHeightAt(p.x, p.z); window.lensMove = () => { const t = Math.min(1, (performance.now() - start) / 3000); const y = y0 + 0.9 - 1.8 * t; s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x + 10, y - 0.6, p.z + 4), 60); if (t < 1) requestAnimationFrame(window.lensMove) }; window.lensMove() }, seaSpot)
    for (let i = 0; i < 8; i++) { await p2.waitForTimeout(330); await shot2(`lens-sea-${i}`) } }
  await sea.ctx.close()
  console.log(JSON.stringify({ frames: results }))
  rows.push({ frames: results })
}
await browser.close()
await app.close()
await writeFile(`${out}/results.json`, JSON.stringify({ rows, errors }, null, 2))
if (errors.length) { console.error(errors); process.exit(1) }
process.exit(0)
