/**
 * Planet curve screenshots: loads the running game, bends every drawn material at run time
 * (except the sky) with window.__miraCurve, and renders fixed views at several curve values.
 *
 *   tools/heavy.sh node tools/terrainlab/curve-shots.mjs [baseUrl] [outDir] [curve,curve,...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5199/'
const out = process.argv[3] ?? '/tmp/terrainlab-curve'
const curves = (process.argv[4] ?? '0,0.3,0.6,1').split(',').map(Number)
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
const room = `curve${Math.floor(Math.random() * 1e9)}`
await page.goto(`${base}?autoplay=1&room=${room}${process.env.QUERY ? `&${process.env.QUERY}` : ''}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.mira?.game?.tick > 25 && window.__miraCurve, null, { timeout: 60000 })

// Pin the camera and update the bend from it just before every render. With BEND unset the
// pinned view is used without bending other lanes' materials (the terrain bends itself).
await page.evaluate(() => {
  const g = window.mira.game
  const C = window.__miraCurve
  const orig = g.renderer.render.bind(g.renderer)
  window.__view = null
  g.renderer.render = (scene, cam) => {
    const v = window.__view
    // Only the game camera: shadow and other passes render through here too.
    if (cam !== g.camera) return orig(scene, cam)
    if (v) {
      cam.position.set(v.eye[0], v.eye[1], v.eye[2])
      cam.lookAt(v.at[0], v.at[1], v.at[2])
      cam.updateMatrixWorld()
    }
    C.updateCurve(cam.position, window.mira.terrain.data.size ?? 2048)
    // Materials rebuilt mid-run (the vent emitters rebuild when the particle budget moves)
    // must be bent before they are drawn, so bend everything on every frame. Idempotent.
    if (window.__bendEveryFrame) {
      scene.traverse((o) => {
        if (!o.material || o.constructor.name === 'AlienSkyMesh') return
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) C.applyCurve(m)
      })
    }
    const t0 = performance.now()
    const r = orig(scene, cam)
    window.__renderMs = (window.__renderMs ?? 0) * 0.95 + (performance.now() - t0) * 0.05
    return r
  }
})

/** Bend every mesh and sprite in the scene except the sky. Returns what was bent. */
const bendAll = () => page.evaluate(() => {
  const C = window.__miraCurve
  const seen = new Map()
  window.mira.game.scene.traverse((o) => {
    if (!o.material) return
    if (o.constructor.name === 'AlienSkyMesh') return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      C.applyCurve(m)
      const k = `${o.constructor.name}/${m.type}${m.name ? `:${m.name}` : ''}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
  })
  return Object.fromEntries(seen)
})

const info = () => page.evaluate(() => {
  const s = window.mira
  const t = s.terrain
  const L = t.data.layout
  const v = L.volcano
  const p = s.player?.vehicle?.object?.position ?? s.player?.object?.position
  return {
    backend: s.game.backend, size: t.data.size, seed: t.data.seed,
    volcano: { gx: v.gentleX, gz: v.gentleZ }, summit: t.summit(), pads: L.spawns.map((q) => [q.x, q.z]),
    player: p ? [p.x, p.y, p.z] : null,
  }
})

async function shoot(name, eye, at) {
  await page.evaluate((v) => { window.__view = v }, { eye, at })
  await page.waitForTimeout(300)
  // Bend anything created since the last shot (particles, effects), then let it compile.
  if (process.env.BEND !== '0') Object.assign(bent, await bendAll())
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${name}.png` })
}

const i = await info()
const gy = (x, z) => page.evaluate(([a, b]) => window.mira.terrain.heightAt(a, b), [x, z])
const { gx, gz } = i.volcano
const S = i.summit
const [px, pz] = [i.pads[0][0] * 1.02, i.pads[0][1] * 1.02]
const padY = await gy(px, pz)
// Outward from the volcano through pad 0, for the high horizon view.
const ol = Math.hypot(px, pz) || 1
const [ox, oz] = [px / ol, pz / ol]
const bent = process.env.BEND === '0' ? {} : await bendAll()
if (process.env.BEND !== '0') await page.evaluate(() => { window.__bendEveryFrame = true })
const frames = []
for (const c of curves) {
  await page.evaluate((v) => window.mira.params.set('world.curve', v), c)
  if (process.env.BEND !== '0') Object.assign(bent, await bendAll())
  const tag = `c${String(c).replace('.', '')}`
  await shoot(`${tag}-1-pad0-eye`, [px, padY + 3, pz], [0, 170, 0])
  await shoot(`${tag}-2-high-horizon`, [px, padY + 150, pz], [px + ox * 1000, padY + 60, pz + oz * 1000])
  await shoot(`${tag}-3-summit-eye`, [-gx * S.rimRadius, (await gy(-gx * S.rimRadius, -gz * S.rimRadius)) + 4, -gz * S.rimRadius],
    [gx * S.rimRadius, S.rimHeight - 10, gz * S.rimRadius])
  if (i.player) {
    const [vx, vy, vz] = i.player
    await shoot(`${tag}-4-vehicle`, [vx + 9, vy + 4, vz + 9], [vx, vy + 0.5, vz])
  }
  frames.push({ curve: c, renderMs: await page.evaluate(() => +window.__renderMs.toFixed(2)), fps: await page.evaluate(() => Math.round(window.mira.game.fps)) })
}
await browser.close()
console.log(JSON.stringify({ info: i, bent, frames, errors }, null, 2))
