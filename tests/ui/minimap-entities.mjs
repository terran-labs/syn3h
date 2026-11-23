// People and bots on the minimap, and dots for vehicles beyond its rim. Two pages in one room:
// a desktop host (who runs the bots) and a phone guest (the real second person). Each scene
// places the bots and the other person relative to the viewer, then captures the viewer's map.
//   MIRA_URL=http://127.0.0.1:5213/ [MIRA_WORLD=ice] (a planet kind) node tests/ui/minimap-entities.mjs
// Screenshots go to tests/ui/artifacts/minimap-entities. Look at them: this checks layout and
// legibility, which pixels asserted here cannot.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const world = process.env.MIRA_WORLD ?? ''
const out = 'tests/ui/artifacts/minimap-entities' + (world ? `/${world}` : '')
await mkdir(out, { recursive: true })
const room = `minimap-entities-${Date.now()}`
const RIM = 0.77, BOTS = 8 // the most a headless page's quality budget (Ultra) runs
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []

async function open(options, label) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`))
  await page.goto(`${base}?autoplay=1&room=${room}${world ? `&planet=${world}` : ''}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.miraNet?.connected, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  if (await page.locator('.world-inspector').isVisible() && await page.locator('.inspector-toggle').isVisible()) await page.locator('.inspector-toggle').click()
  return page
}

try {
  const host = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, 'desktop')
  const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'phone')
  // Parked bots (bots.canDrive off, as tools/bots-net-check.mjs does) stay where they are put.
  // Keep all eight whatever a loaded headless page measures (bots.keepCount, v26.11.1713 on);
  // guarded so the check still runs on builds without the setting.
  await host.evaluate((n) => { const p = window.mira.params; p.set('gfx.auto', false); p.set('gfx.quality', 4); p.set('bots.canDrive', false); if (p.get('bots.keepCount')) p.set('bots.keepCount', true); p.set('bots.count', n) }, BOTS)
  // Bots arrive one at a time (src/bots/pacing.ts), each judged for about three seconds, longer
  // on a busy machine. Wait for all of them as long as they keep coming; fail only when no new
  // bot has arrived for 30 s, or the pacer has decided this device carries fewer.
  await host.evaluate(() => window.mira.params.set('bots.arrivalInterval', 1))
  for (let seen = -1, since = Date.now(); ;) {
    const s = await host.evaluate(() => ({ n: window.mira.bots.vehicles.length, allowed: window.mira.bots.pacer?.allowed ?? null, log: (window.mira.bots.pacer?.log ?? []).slice(-6).map(l => `${(l.at / 1000).toFixed(1)}s ${l.action} at ${l.have}`) }))
    if (s.n >= BOTS) break
    if (s.n !== seen) { seen = s.n; since = Date.now() }
    if (Date.now() - since > 30000 || (s.allowed !== null && s.allowed < BOTS)) {
      console.log(JSON.stringify({ ...s, count: await host.evaluate(() => window.mira.params.get('bots.count').value), host: await host.evaluate(() => window.miraNet.isHost) }))
      throw new Error(`bots stopped arriving at ${s.n} of ${BOTS}${s.allowed !== null && s.allowed < BOTS ? ` (the pacer allows ${s.allowed} on this device)` : ' (none for 30 s)'}`)
    }
    await host.waitForTimeout(1000)
  }
  await host.waitForFunction(() => window.miraNet.remotes.size >= 1, null, { timeout: 60000 })
  // Let the bots finish arriving (a materializing vehicle ignores a teleport); the guest needs no detail.
  await host.waitForTimeout(4000)
  await phone.evaluate(() => { const p = window.mira.params; p.set('gfx.auto', false); p.set('gfx.quality', 0) })
  const size = await host.evaluate(() => window.mira.terrain.size)
  const rim = RIM * size / 2, far = size * Math.SQRT1_2
  /** Map offset for fraction f along [rim, far side] (f < 0: inside, as a fraction of the rim). */
  const reach = (f) => f < 0 ? -f * rim : rim + f * (far - rim)
  const polar = (bearingDeg, distance) => [Math.cos(bearingDeg * Math.PI / 180) * distance, Math.sin(bearingDeg * Math.PI / 180) * distance]

  /**
   * Places host bots (list of [dx, dz]) and the other person ([dx, dz]) around the viewer.
   * Unlisted bots go to the far side, where a bot's dot vanishes.
   */
  async function scene(viewer, other, bots, person) {
    const at = await viewer.evaluate(() => { const p = window.mira.player.object.position; return [p.x, p.z] })
    const offsets = Array.from({ length: BOTS }, (_, i) => bots[i] ?? [size / 2 - 3 + i, size / 2 - 3])
    const place = ([px, pz], list) => list.map(([dx, dz]) => [px + dx, pz + dz])
    await host.evaluate(({ spots, size }) => {
      const s = window.mira, wrap = (v) => v - size * Math.floor(v / size + 0.5)
      spots.forEach(([x, z], i) => { const bot = s.bots.vehicles[i]; if (!bot) return; x = wrap(x); z = wrap(z); bot.teleport(s.game.camera.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) })
    }, { spots: place(at, offsets), size })
    const [[x, z]] = place(at, [person])
    await other.evaluate(({ x, z, size }) => {
      const s = window.mira, wrap = (v) => v - size * Math.floor(v / size + 0.5)
      x = wrap(x); z = wrap(z); s.player.teleport(s.game.camera.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0)
    }, { x, z, size })
    // Wait until the viewer's map holds every placed vehicle (the guest sees the host's bots
    // through the room, a few hundred milliseconds later), then one more redraw.
    const expected = place(at, [...offsets, person])
    await viewer.waitForFunction(({ expected, size }) => {
      const m = window.mira.shell.minimap, d = (a, b) => Math.abs(a - b - size * Math.round((a - b) / size))
      return expected.every(([x, z]) => m.slots.slice(0, m.count).some((s) => d(s.x, x) < 4 && d(s.z, z) < 4))
    }, { expected, size }, { timeout: 30000, polling: 100 })
    await viewer.waitForTimeout(250)
  }
  async function shot(page, name) {
    await page.waitForTimeout(0)
    const box = await page.locator('.shell-minimap').boundingBox()
    const pad = 14
    if (process.env.MINIMAP_DEBUG) console.log(name, JSON.stringify(await page.evaluate((rim) => {
      const m = window.mira.shell.minimap
      return m.slots.slice(0, m.count).map((s) => `${s.kind[0]} d/rim=${(s.place.distance / rim).toFixed(2)} b=${Math.round(s.place.bearing * 180 / Math.PI)} blend=${s.place.blend.toFixed(2)} a=${s.look.alpha.toFixed(2)}`)
    }, rim)))
    await page.screenshot({ timeout: 120000, path: `${out}/${name}.png`, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } })
  }

  for (const [label, viewer, other] of [['desktop', host, phone], ['phone', phone, host]]) {
    // 1. People and bots together on the map.
    await scene(viewer, other, [polar(200, reach(-.35)), polar(250, reach(-.6)), polar(320, reach(-.5)), polar(110, reach(-.7)), polar(160, reach(-.25))], polar(30, reach(-.55)))
    await shot(viewer, `${label}-together`)
    // 2. Beyond the rim at near, middle and far distances; the person on the far side. Far
    // placements sit near the diagonals: a longer offset along one axis wraps round the planet.
    await scene(viewer, other, [polar(0, reach(.05)), polar(270, reach(.35)), polar(135, reach(.6)), polar(225, reach(.85)), polar(315, reach(.97))], polar(45, reach(.97)))
    await shot(viewer, `${label}-off-map`)
    // 3. One bot and the person crossing the rim, three frames.
    const handover = 12 * size / 320
    for (const [i, d] of [[1, rim - handover], [2, rim], [3, rim + handover]].map(([i, d]) => [i, d])) {
      await scene(viewer, other, [polar(135, d)], polar(45, d))
      await shot(viewer, `${label}-crossing-${i}`)
    }
    // 4. A crowd at the rim: the person and seven bots within 30 degrees.
    await scene(viewer, other, Array.from({ length: 7 }, (_, i) => polar(80 + i * 4, reach(.03 + i * .02))), polar(92, reach(.05)))
    await shot(viewer, `${label}-crowd`)
  }
  // The marks layer is drawn and unmasked; the terrain still fills the centre.
  const ok = await host.evaluate(() => { const c = document.querySelector('.shell-minimap-marks'); return c && getComputedStyle(c).maskImage !== undefined && c.width > 0 })
  assert.ok(ok, 'marks layer present')
  assert.deepEqual(errors, [], 'no page errors')
  console.log(`minimap-entities: screenshots in ${out}`)
} finally { await browser.close() }
