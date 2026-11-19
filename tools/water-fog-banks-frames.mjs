/**
 * The water under the weather fog's two layers (surface.ts hazeCurve, fog.ts fogLayersOf).
 * Production build, run from each checkout to compare:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/water-fog-banks-frames.mjs <output directory>
 *
 * Serves dist/ from this checkout (and checks the port's listener is this process). Five frames
 * at High, 1280x800, interface hidden, the hour fixed, and everything that moves held still (no
 * swell, chop, wind or cloud, fixed exposure, the shaders' clock stopped), so frames from two
 * builds can be compared pixel for pixel:
 *   open-sea-curved, open-sea-flat   no banks (weather.fogBanks 0), 11:00, lens 1.5 m over open
 *                                    sea, the round planet drawn as usual and flat: must not change
 *   underwater                       no banks, 3 m under open sea looking along it: must not change
 *   dawn-bank-shore, dawn-bank-jet   Archipelago at 6:30 with its fog banks, from a beach 2 m up
 *                                    looking out to sea, and 120 m up over the water off it
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/water-fog-banks/run'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const port = app.server.address().port
if (Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n')[0]) !== process.pid) throw new Error(`port ${port} is not ours`)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], notes = []

async function open(planet, seed, set) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/?autoplay=1&vehicle=buggy&planet=${planet}&seed=${seed}&room=fb${Date.now().toString(36)}&daydream=0`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
  await page.evaluate((set) => {
    const s = window.syn3h
    s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', 3)
    // Still: no swell, chop, wind or cloud, exposure fixed and the shaders' clock stopped, so two
    // builds draw the same pixels wherever they agree and a difference is the change itself.
    const still = { 'water.waves': 0, 'water.chop': 0, 'weather.windSpeed': 0, 'weather.gustiness': 0, 'weather.cloudCoverage': 0, 'weather.cloudSpeed': 0, 'sky.autoExposure': 0, 'weather.storminess': 0 }
    for (const [k, v] of Object.entries({ ...still, ...set })) if (s.params.get(k)) s.params.set(k, v)
    const nf = s.game.renderer._nodes.nodeFrame
    nf.update = function () { this.frameId++; this.deltaTime = 0; this.time = 10 }
    const canvas = s.game.canvas ?? document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden'
  }, set)
  await page.waitForTimeout(5000)
  return { ctx, page }
}
/** Lens at (x, z), `height` over the liquid there (negative is under it), looking along `heading`. */
async function shoot(page, name, p, heading, height, down) {
  await page.evaluate(({ p, heading, height, down }) => {
    const s = window.syn3h, t = s.terrain, V = s.game.camera.position.constructor
    const y = t.liquidHeightAt(p.x, p.z) + height
    s.player.teleport({ x: p.x + 400, y: t.heightAt(p.x + 400, p.z) + 2, z: p.z }, 0)
    s.camera.setCinematicPose(new V(p.x, y, p.z), new V(p.x - Math.sin(heading) * 100, y - 100 * down, p.z - Math.cos(heading) * 100), 60)
  }, { p, heading, height, down })
  // The pose eases in: wait until the camera has arrived across the ground and in its aim.
  // Under the water the lens rule crosses over a second or more: wait for the height too.
  await page.waitForFunction((under) => { const s = window.syn3h, c = s.camera.cinematic, cam = s.game.camera; return !c || (Math.hypot(cam.position.x - c.position.x, cam.position.z - c.position.z) < 0.05 && c.look.distanceTo(c.target) < 0.1 && (!under || Math.abs(cam.position.y - c.position.y) < 0.05)) }, height < 0, { timeout: 30000, polling: 200 }).catch(() => notes.push({ name, unsettled: true }))
  await page.waitForTimeout(800)
  const cam = await page.evaluate(() => { const s = window.syn3h, c = s.game.camera.position; return { y: +(c.y - s.terrain.liquidHeightAt(c.x, c.z)).toFixed(2) } })
  notes.push({ name, x: +p.x.toFixed(1), z: +p.z.toFixed(1), heading: +heading.toFixed(3), lensOverWater: cam.y })
  await page.screenshot({ path: `${out}/${name}.png` })
}
/** Open sea: at least `depth` metres of water and no land within `clear` metres. */
const openSea = (page, depth, clear) => page.evaluate(({ depth, clear }) => {
  const t = window.syn3h.terrain, size = t.size
  for (let k = 0; k < 20000; k++) {
    const x = (Math.sin(k * 12.9898) * 0.5) * size * 0.9, z = (Math.cos(k * 78.233) * 0.5) * size * 0.9
    if (t.liquidKindAt(x, z) !== 'water' || t.liquidHeightAt(x, z) - t.heightAt(x, z) < depth) continue
    let dry = false
    for (let a = 0; a < 16 && !dry; a++) for (let r = 20; r <= clear && !dry; r += 20) { const h = (a / 16) * Math.PI * 2; dry = t.liquidKindAt(x + Math.sin(h) * r, z + Math.cos(h) * r) !== 'water' }
    if (!dry) return { x, z }
  }
  return null
}, { depth, clear })

{ // No banks: open sea, curved and flat, and under it.
  const { ctx, page } = await open('alpine', 4, { 'sun.timeOfDay': 11, 'weather.fogBanks': 0 })
  const sea = await openSea(page, 8, 120)
  if (sea) {
    await shoot(page, 'open-sea-curved', sea, 0.6, 1.5, 0.03)
    await page.evaluate(() => window.syn3h.params.set('world.curve', 0)); await page.waitForTimeout(1500)
    await shoot(page, 'open-sea-flat', sea, 0.6, 1.5, 0.03)
    await shoot(page, 'underwater', sea, 0.6, -3, 0)
  } else notes.push({ openSea: null })
  await ctx.close()
}
{ // Archipelago at dawn with its own fog banks: a beach, and the sea off it from a jet.
  // FOG_SET (JSON) overrides the dawn settings, for a thicker bank while diagnosing.
  const { ctx, page } = await open('archipelago', 4, { 'sun.timeOfDay': 6.5, ...JSON.parse(process.env.FOG_SET ?? '{}') })
  notes.push({ fogBanks: await page.evaluate(() => window.syn3h.params.get('weather.fogBanks').value) })
  // The beach where the coastal bank is thickest (the fog map's coast value), facing open water:
  // inside the bank, where land takes it in full and the water, before this change, did not.
  const beach = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, size = t.size, sea = s.params.get('world.lavaAltitude').value
    const map = s.game.systems.find((q) => q.fogBanks)?.fogBanks.map
    const coast = (x, z) => { if (!map) return 0; const n = map.cells, i = ((Math.floor((x / map.size + 0.5) * n) % n) + n) % n, j = ((Math.floor((z / map.size + 0.5) * n) % n) + n) % n; return map.data[(j * n + i) * 4] }
    let best = null
    for (let k = 0; k < 20000; k++) {
      const x = (Math.sin(k * 3.17) * 0.5) * size * 0.9, z = (Math.cos(k * 9.41) * 0.5) * size * 0.9
      const above = t.heightAt(x, z) - sea
      if (t.liquidKindAt(x, z) || above < 0.3 || above > 2) continue
      const c = coast(x, z)
      if (best && c <= best.coast) continue
      for (let a = 0; a < 16; a++) {
        const h = (a / 16) * Math.PI * 2, dx = -Math.sin(h), dz = -Math.cos(h)
        let wet = true
        for (let r = 30; r <= 300 && wet; r += 15) wet = t.liquidKindAt(x + dx * r, z + dz * r) === 'water'
        if (wet) { best = { x, z, heading: h, coast: c }; break }
      }
    }
    return best
  })
  notes.push({ beachCoastFog: beach?.coast ?? null })
  if (beach) {
    await shoot(page, 'dawn-bank-shore', beach, beach.heading, 2, 0.02)
    const off = { x: beach.x - Math.sin(beach.heading) * 150, z: beach.z - Math.cos(beach.heading) * 150 }
    await shoot(page, 'dawn-bank-jet', off, beach.heading + Math.PI, 120, 0.35)
  } else notes.push({ beach: null })
  await ctx.close()
}
await browser.close(); await app.close()
await writeFile(`${out}/notes.json`, JSON.stringify({ notes, errors }, null, 2))
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
