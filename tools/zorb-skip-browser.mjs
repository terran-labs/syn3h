/**
 * Zorb skipping in the real game, on the production build. Build first, then:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/zorb-skip-browser.mjs [output directory]
 *
 * Serves dist/ and a room server in this process, opens two players in one room per world (a
 * sea world and a lava world), and on player A launches a zorbed buggy over open liquid:
 * a fast shallow skip, a slow entry and a hop pressed mid-skip. Saves a short frame sequence
 * of each from A's camera, A's own path, and B's copy of A, and prints how far B's copy
 * strayed from A's path. Exits non zero on a page error or if B's copy disagrees (median gap).
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/zorb-skip'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const base = `http://127.0.0.1:${app.server.address().port}/`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const errors = [], results = []

/** In the page: find a straight run of open, deep liquid of `kind` and return its start and heading. */
function findRun(kind) {
  const t = window.mira.terrain, size = t.size ?? 2048
  const deep = (x, z) => t.liquidKindAt?.(x, z) === kind && Number.isFinite(t.liquidHeightAt(x, z)) && t.heightAt(x, z) < t.liquidHeightAt(x, z) - 12
  let best = null
  for (let x = -size / 2; x < size / 2; x += 32) for (let z = -size / 2; z < size / 2; z += 32) {
    if (!deep(x, z)) continue
    for (let a = 0; a < 8; a++) {
      const h = (a * Math.PI) / 4, dx = -Math.sin(h), dz = -Math.cos(h)
      let n = 0
      while (n < 400 && deep(x + dx * n, z + dz * n)) n += 8
      if (!best || n > best.n) best = { x, z, h, n }
      if (n >= 400) return best
    }
  }
  return best
}

async function player(room, planet, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&vehicle=buggy&planet=${planet}&seed=1&room=${room}&name=${name}`)
  await page.waitForFunction(() => window.miraNet?.connected && window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.mira
    s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 12); s.params.set('sun.dayLength', 0)
    // Keep A's copy physical along the whole run, so its skims are simulated here, not placed.
    s.params.set('net.proxyRadius', 200)
  })
  return { ctx, page }
}

for (const [planet, kind] of [['archipelago', 'water'], ['volcanic', 'lava']]) {
  const room = `zorbskip${Date.now().toString(36)}`
  const a = await player(room, planet, 'A'), b = await player(room, planet, 'B')
  await Promise.all([a, b].map((p) => p.page.waitForFunction(() => window.miraNet.remotes.size === 1, null, { timeout: 30000 })))
  const run = await a.page.evaluate(findRun, kind)
  if (!run || run.n < 150) { console.log(`SKIP ${planet}: no long run of open ${kind}`, run); await a.ctx.close(); await b.ctx.close(); continue }
  // Zorb on, grown, before anything is measured.
  await a.page.evaluate(() => { window.mira.game.input.state.zorb = true })
  await a.page.waitForFunction(() => { const z = window.mira.player.zorb; return z.target > 0 && z.radius === z.target }, null, { timeout: 30000 })
  // B floats nearby, out of the way, watching A.
  await b.page.evaluate(({ run }) => {
    const s = window.mira, y = s.terrain.liquidHeightAt(run.x, run.z) + 8
    s.player.teleport({ x: run.x + Math.cos(run.h) * 40, y, z: run.z - Math.sin(run.h) * 40 }, run.h)
  }, { run })

  for (const [label, speed, angle, hopAt] of [['fast-skip', 30, 8, null], ['slow-entry', 5, 5, null], ['hop-mid-skip', 30, 8, 0.6]]) {
    const dir = `${out}/${kind}-${label}`
    await mkdir(dir, { recursive: true })
    await a.page.evaluate(({ run, speed, angle, hopAt }) => {
      const s = window.mira, p = s.player, z = p.zorb, sea = s.terrain.liquidHeightAt(run.x, run.z)
      const a = (angle * Math.PI) / 180, dx = -Math.sin(run.h), dz = -Math.cos(run.h)
      // A real three.js vector from the page, for the ball's centre.
      const c = p.object.position.clone()
      p.teleport({ x: run.x, y: sea + z.radius + 1.5, z: run.z }, run.h)
      p.body.setLinvel({ x: dx * speed * Math.cos(a), y: -speed * Math.sin(a), z: dz * speed * Math.cos(a) }, true)
      window.zorbTrace = []
      window.zorbProbe?.()
      const probe = s.game.add({ postPhysics() {
        const t = z.centre(c), v = p.body.linvel(), surface = s.terrain.liquidHeightAt(t.x, t.z)
        window.zorbTrace.push({ tick: s.game.tick, p: [t.x, t.y, t.z], speed: Math.hypot(v.x, v.z), base: t.y - z.radius - surface, skimming: z.skimming, onLiquid: z.onLiquid, hops: z.hops })
      } })
      window.zorbProbe = () => s.game.remove(probe)
      // A hop pressed at the first touch of the surface after `hopAt` seconds (Space toggles
      // `special`; zorb.ts `hold` reads one change as one hop). A press in mid-air between
      // skips is remembered only HOP_BUFFER seconds, as over land.
      const t0 = s.game.tick
      window.hopProbe?.()
      const hop = hopAt === null ? null : s.game.add({ postPhysics() {
        if ((s.game.tick - t0) / 60 >= hopAt && z.onLiquid && z.hops === hops0) { const st = s.game.input.state; st.special = !st.special; s.game.remove(hop) }
      } })
      const hops0 = z.hops
      window.hopProbe = () => hop && s.game.remove(hop)
    }, { run, speed, angle, hopAt })
    // B records its copy of A over the same time.
    await b.page.evaluate(() => {
      const s = window.mira, r = [...window.miraNet.remotes.values()][0]
      window.copyTrace = []
      window.copyProbe?.()
      const c = r.vehicle.object.position.clone()
      const probe = s.game.add({ postPhysics() { const t = r.vehicle.zorb.centre(c); window.copyTrace.push({ p: [t.x, t.y, t.z], physical: r.physical, zorb: r.vehicle.zorb.active }) } })
      window.copyProbe = () => s.game.remove(probe)
    })
    for (let i = 0; i < 16; i++) {
      await a.page.screenshot({ path: `${dir}/a-${String(i).padStart(2, '0')}.png` })
      await a.page.waitForTimeout(180)
    }
    await b.page.screenshot({ path: `${dir}/b-view.png` })
    const own = await a.page.evaluate(() => window.zorbTrace)
    const copy = await b.page.evaluate(() => window.copyTrace)
    // B's copy runs about a tenth of a second behind: compare each copy point to A's whole path.
    // The world wraps: each page draws the other at the image nearest itself.
    const size = await a.page.evaluate(() => window.mira.terrain.size)
    const wrap = (d) => d - size * Math.round(d / size)
    const near = (q) => Math.min(...own.map((o) => Math.hypot(wrap(o.p[0] - q.p[0]), o.p[1] - q.p[1], wrap(o.p[2] - q.p[2]))))
    const settledCopy = copy.slice(20).filter((q) => q.zorb)
    const gaps = settledCopy.map(near).sort((x, y) => x - y)
    let skips = 0, wet = false
    for (const s of own) { if (s.base <= 0) wet = true; else if (wet && s.base > 0.15) { skips++; wet = false } }
    const r = {
      world: planet, liquid: kind, case: label, speed, angle, steps: own.length, skips,
      speedStart: own[0]?.speed, speedEnd: own.at(-1)?.speed, hops: own.at(-1)?.hops - own[0]?.hops,
      copySamples: settledCopy.length, copyPhysical: copy.filter((q) => q.physical).length,
      copyGapMedian: gaps[Math.floor(gaps.length / 2)] ?? null, copyGapMax: gaps.at(-1) ?? null,
    }
    results.push(r)
    console.log(JSON.stringify(r))
    await writeFile(`${dir}/trace.json`, JSON.stringify({ result: r, own, copy }, null, 1))
  }
  await a.ctx.close(); await b.ctx.close()
}
await browser.close()
await app.close()
await writeFile(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2))
if (errors.length) { console.error(errors); process.exit(1) }
// The median judges agreement. The maximum is reported: B hears a hop press about a tenth of
// a second late and hops from where its copy is then, a gap of a few metres that closes
// within about 0.3 s (4.2 m on 17 November 2026; 0.3 m with no hop).
const bad = results.filter((r) => !(r.copyGapMedian < 0.5))
if (bad.length) { console.error('B disagreed with A', bad); process.exit(1) }
process.exit(0)
