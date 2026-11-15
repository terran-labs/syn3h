/**
 * Measures multiplayer under a bad network. Two headless players join one room through
 * server/latency-proxy.ts (latency, jitter, TCP-style loss, periodic stalls) and run a set of
 * scenarios. Both pages log their own vehicle and their copy of the other at 100 Hz, and the
 * numbers come from laying the two logs side by side (same machine, so one wall clock).
 *
 * Needs a room server and a dev server whose client talks to the proxy port:
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/net-conditions.mjs --rtt 100 --loss 0.03 [--jitter 20] [--rto 200]
 *        [--stall 500 --stall-every 10] [--set net.proxyBlend=0.2] [--only cruise,parked]
 *        [--label venue] [--secure-off]
 *
 * `--rtt` is each player's round trip, so a state takes about that long from one screen to
 * the other. `--set id=value` applies a parameter on both pages (repeatable). The proxy is
 * started and stopped by this script. A screenshot of B's view during the cruise goes to
 * /tmp/syn3h-cond-<label>.png.
 *
 * Scenarios, on the flattest dry 80 m line near the origin:
 *   cruise    A shuttles forward and back for 24 s while B, parked 8 m to the side, watches.
 *   parked    B is parked 35 m ahead; A drives into its back.
 *   headon    A and B start 70 m apart and drive at each other.
 *   chase     B drives off for 1.5 s and coasts; A starts behind and catches it.
 *   nearmiss  B is parked 4.5 m to the side of A's line; A drives past. No ram should count.
 *   beam      A sends tag beams at B, 20 m ahead.
 *   hill      King of the Hill: A is put on the rim and must be shown as holder on B.
 *
 * cruise reports, for B's copy of A:
 *   gapWorstMs, gapP95Ms    longest and 95th percentile wait between new states arriving
 *   lagWorstM, lagMeanM     distance from where A really is at that instant (includes the
 *                           unavoidable lag of latency plus the interpolation delay)
 *   pathWorstM, pathMeanM   distance from where A was `delay` ago: how faithfully the copy
 *                           replays A's path. This is the snap and drift number.
 *   frozenMs                time the copy stood still although A (delayed) was moving
 *   jumpWorstM              most the copy moved in 100 ms beyond what A did (a snap)
 *   extrapolatedPct, stalePct   share of samples played past the newest state, or given up on
 *   delayMinMs, delayMaxMs  the interpolation delay B used
 *
 * The ram scenarios report:
 *   ramA, ramB        how many rams each client detected
 *   gapMs             B's detection time minus A's (how late the other side feels it)
 *   speedA            A's speed just before its contact, m/s
 *   keptA             fraction of that speed A still has 0.3 s later (0 = hit a wall)
 *   shoveB, movedB    B's peak speed gain in the 1.5 s after first contact, and how far it went
 *   ghostBonA         at A's contact, distance between B's copy on A and the real B, m
 *   ghostAonB         at B's contact, distance between A's copy on B and the real A, m
 *   snapBonA, snapAonB   largest single step either copy made in the 2 s after contact, m
 *   settleA, settleB  the two ghost distances 2.5 s later, once everything is at rest
 *   itMs              ms from first contact until "it" changed hands (null if it did not)
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const base = opt('base', 'http://localhost:5183/')
const net = { rtt: opt('rtt', '0'), jitter: opt('jitter', '0'), loss: opt('loss', '0'), rto: opt('rto', '200'), stall: opt('stall', '0'), 'stall-every': opt('stall-every', '10') }
const listen = opt('listen', '8794')
const target = opt('target', 'http://127.0.0.1:8791')
const label = opt('label', `rtt${net.rtt}`)
const only = opt('only', 'cruise,parked,headon,chase,beam,hill').split(',')
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1].split('=')] : []))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const proxy = spawn('npx', ['tsx', 'server/latency-proxy.ts', '--listen', listen, '--target', target, ...Object.entries(net).flatMap(([k, v]) => [`--${k}`, v])], { stdio: ['ignore', 'ignore', 'inherit'] })
await wait(2500)

// One browser process per player. Two pages in one headless Chrome take turns at being the
// active page, and the other's frame loop is starved: its vehicle stops simulating for
// seconds at a time, which would be measured as network trouble.
const launch = () => chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const browsers = []
const room = `cond${Date.now() % 100000}`
const errors = []
async function open(name) {
  const browser = await launch()
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 60000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  return page
}

/** Start logging on a page: own pose and speed, and this page's copy of player `other`. */
const record = (page, other) => page.evaluate((other) => {
  const log = []
  window.__condLog = log
  clearInterval(window.__condTimer)
  window.__condTimer = setInterval(() => {
    const net = window.syn3hNet
    const p = window.syn3h.player.body.translation()
    const v = window.syn3h.player.body.linvel()
    const r = net.remotes.get(other)
    const rp = r?.vehicle.body.translation()
    log.push({
      t: Date.now(), p: [p.x, p.y, p.z], s: Math.hypot(v.x, v.z), rp: rp ? [rp.x, rp.y, rp.z] : null,
      delay: r?.delay ?? 0, newest: r?.buffer.newest?.t ?? 0, mode: r?.sample.mode ?? 'empty',
      rams: net.stats.rams, it: net.game.it,
    })
  }, 10)
}, other)
const stop = (page) => page.evaluate(() => { clearInterval(window.__condTimer); return window.__condLog })
/** Drive without the keyboard, which only reaches whichever page has focus. */
const drive = (page, y, x = 0) => page.evaluate(([y, x]) => { const e = window.syn3h.game.input.external; e.y = y; e.x = x }, [y, x])

const d2 = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2])
const at = (log, t) => log.reduce((best, e) => (Math.abs(e.t - t) < Math.abs(best.t - t) ? e : best), log[0])
const round = (x, n = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

function analyseCruise(logA, logB) {
  const seen = logB.filter((e) => e.rp)
  const gaps = []
  let lastT = seen[0].t
  for (let i = 1; i < seen.length; i++) if (seen[i].newest !== seen[i - 1].newest) { gaps.push(seen[i].t - lastT); lastT = seen[i].t }
  gaps.sort((a, b) => a - b)
  const lag = seen.map((e) => d2(e.rp, at(logA, e.t).p))
  const path = seen.map((e) => d2(e.rp, at(logA, e.t - e.delay * 1000).p))
  // 100 ms windows: what the copy did against what A did, `delay` earlier.
  let frozen = 0
  let jump = 0
  for (let i = 0; i + 10 < seen.length; i += 10) {
    const [e0, e1] = [seen[i], seen[i + 10]]
    const copy = d2(e1.rp, e0.rp)
    const real = d2(at(logA, e1.t - e1.delay * 1000).p, at(logA, e0.t - e0.delay * 1000).p)
    if (real > 0.5 && copy < real * 0.2) frozen += e1.t - e0.t
    jump = Math.max(jump, copy - real)
  }
  const delays = seen.map((e) => e.delay * 1000)
  return {
    gapWorstMs: gaps.at(-1) ?? null, gapP95Ms: gaps[Math.floor(gaps.length * 0.95)] ?? null,
    lagWorstM: round(Math.max(...lag)), lagMeanM: round(mean(lag)),
    pathWorstM: round(Math.max(...path)), pathMeanM: round(mean(path)),
    frozenMs: frozen, jumpWorstM: round(jump),
    extrapolatedPct: round(100 * seen.filter((e) => e.mode === 'extrapolate').length / seen.length, 1),
    stalePct: round(100 * seen.filter((e) => e.mode === 'stale').length / seen.length, 1),
    delayMinMs: round(Math.min(...delays), 0), delayMaxMs: round(Math.max(...delays), 0),
    topA: round(Math.max(...logA.map((e) => e.s)), 1),
  }
}

function analyseRam(logA, logB) {
  const first = (log) => log.find((e) => e.rams > log[0].rams)?.t ?? null
  const tA = first(logA)
  const tB = first(logB)
  const t0 = Math.min(tA ?? Infinity, tB ?? Infinity)
  const end = logA.at(-1).t
  const out = {
    ramA: logA.at(-1).rams - logA[0].rams,
    ramB: logB.at(-1).rams - logB[0].rams,
    delayA: round(at(logA, Math.min(t0, end)).delay * 1000, 0),
    delayB: round(at(logB, Math.min(t0, end)).delay * 1000, 0),
    settleA: round(d2(logA.at(-1).rp, logB.at(-1).p)),
    settleB: round(d2(logB.at(-1).rp, logA.at(-1).p)),
    topA: round(Math.max(...logA.map((e) => e.s)), 1),
    topB: round(Math.max(...logB.map((e) => e.s)), 1),
  }
  if (t0 === Infinity) return out
  out.gapMs = tA && tB ? tB - tA : null
  if (tA) {
    out.speedA = round(at(logA, tA - 60).s, 1)
    out.keptA = round(at(logA, tA + 300).s / Math.max(0.1, out.speedA))
    out.ghostBonA = round(d2(at(logA, tA).rp, at(logB, tA).p))
  }
  if (tB) out.ghostAonB = round(d2(at(logB, tB).rp, at(logA, tB).p))
  const b0 = at(logB, t0)
  out.shoveB = round(Math.max(...logB.filter((e) => e.t >= t0 && e.t <= t0 + 1500).map((e) => e.s)) - b0.s, 1)
  out.movedB = round(d2(logB.at(-1).p, b0.p), 1)
  const snap = (log) => {
    const w = log.filter((e) => e.t >= t0 && e.t <= t0 + 2000 && e.rp)
    let worst = 0
    for (let i = 1; i < w.length; i++) worst = Math.max(worst, d2(w[i].rp, w[i - 1].rp))
    return round(worst)
  }
  out.snapBonA = snap(logA)
  out.snapAonB = snap(logB)
  const it0 = at(logA, t0 - 100).it
  const changed = logA.find((e) => e.t >= t0 - 100 && e.it !== it0)
  out.itMs = changed ? changed.t - t0 : null
  return out
}

let report
try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && window.syn3hNet.players.size === 2, null, { timeout: 60000 })))
  const [idA, idB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3hNet.id)))
  await Promise.all([a.waitForFunction((id) => window.syn3hNet.remotes.has(id), idB, { timeout: 20000 }), b.waitForFunction((id) => window.syn3hNet.remotes.has(id), idA, { timeout: 20000 })])
  for (const [id, value] of sets) await Promise.all([a, b].map((p) => p.evaluate(([id, value]) => window.syn3h.params.set(id, Number(value)), [id, value])))

  // The flattest dry 80 m line near the origin, so slopes do not decide the result.
  const runway = await a.evaluate(() => {
    const t = window.syn3h.terrain
    let best = null
    for (let ox = -120; ox <= 120; ox += 40) for (let oz = -120; oz <= 120; oz += 40) for (let k = 0; k < 16; k++) {
      const h = (k / 16) * Math.PI * 2
      const f = [-Math.sin(h), -Math.cos(h)]
      let lo = Infinity, hi = -Infinity, wet = false
      for (let s = -6; s <= 86; s += 2) for (const l of [-9, -5, 0, 5, 9]) {
        const x = ox + f[0] * s + f[1] * l, z = oz + f[1] * s - f[0] * l
        const y = t.heightAt(x, z)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
        if ((t.liquidHeightAt?.(x, z) ?? -Infinity) > y) wet = true
      }
      if (!wet && (!best || hi - lo < best.range)) best = { ox, oz, h, range: hi - lo }
    }
    return best
  })
  const teleport = (page, s, l, heading, lift) => page.evaluate(({ runway, s, l, heading, lift }) => {
    const { terrain, player } = window.syn3h
    const f = [-Math.sin(runway.h), -Math.cos(runway.h)]
    const x = runway.ox + f[0] * s + f[1] * l, z = runway.oz + f[1] * s - f[0] * l
    const pos = player.object.position.clone().set(x, terrain.heightAt(x, z) + lift, z)
    player.teleport(pos, runway.h + heading)
  }, { runway, s, l, heading, lift })
  const speed = (page) => page.evaluate(() => { const v = window.syn3h.player.body.linvel(); return Math.hypot(v.x, v.z) })
  let replaced = 0
  /**
   * Put a vehicle on the runway and make sure it can drive: nudge it and, if it does not
   * respond, place it again from a different height.
   */
  async function place(page, s, l, heading) {
    for (const lift of [1.2, 2, 0.8, 2.5, 1.5]) {
      // Work around a buggy defect: a ram can leave `isInverted` latched, which turns the
      // suspension off for good (see tools/ram-inverted-repro.mjs).
      await page.evaluate(() => { if ('isInverted' in window.syn3h.player) window.syn3h.player.isInverted = false })
      await teleport(page, s, l, heading, lift)
      await wait(1200)
      await drive(page, 1); await wait(500); await drive(page, 0)
      const moving = (await speed(page)) > 0.5
      await teleport(page, s, l, heading, lift)
      if (moving) return
      replaced++
    }
    const diag = await page.evaluate(() => {
      const { player, terrain, game } = window.syn3h
      const p = player.body.translation(), v = player.body.linvel(), q = player.body.rotation()
      return {
        y: +p.y.toFixed(2), ground: +terrain.heightAt(p.x, p.z).toFixed(2), speed: +Math.hypot(v.x, v.z).toFixed(2),
        upY: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2), type: player.body.bodyType(), sleeping: player.body.isSleeping(),
        input: { ...player.input }, polled: { ...game.input.state }, suspended: game.input.suspended, ext: { ...game.input.external },
        time: game.time, mode: window.syn3hNet.game.mode, hud: document.getElementById('hud')?.textContent.slice(0, 60),
      }
    })
    throw new Error(`vehicle would not drive after five placements: ${JSON.stringify(diag)}`)
  }
  const rammed = (page, n) => page.waitForFunction((n) => window.syn3hNet.stats.rams > n, n, { timeout: 9000 }).catch(() => {})
  const rams = (page) => page.evaluate(() => window.syn3hNet.stats.rams)
  const cooldown = await a.evaluate(() => window.syn3h.params.get('tag.cooldown')?.value ?? 3)
  /** Let both settle where they were placed and the tag cooldown pass, then start logging. */
  async function begin() {
    await Promise.all([drive(a, 0), drive(b, 0)])
    await wait(Math.max(2500, cooldown * 1000 + 800))
    await Promise.all([record(a, idB), record(b, idA)])
    await wait(200)
  }
  const logs = async () => { await wait(2500); return Promise.all([stop(a), stop(b)]) }

  const scenarios = {
    async cruise() {
      await place(a, 0, 0, 0); await place(b, 40, 8, 0)
      await begin()
      for (let i = 0; i < 3; i++) {
        await drive(a, 1); await wait(4000)
        if (i === 1) await b.screenshot({ path: `/tmp/syn3h-cond-${label}.png` })
        await drive(a, -1); await wait(4000)
      }
      await drive(a, 0)
      return analyseCruise(...await logs())
    },
    async parked() {
      await place(a, 0, 0, 0); await place(b, 35, 0, 0)
      await begin()
      const n = await rams(a)
      await drive(a, 1); await rammed(a, n); await drive(a, 0)
      return analyseRam(...await logs())
    },
    async headon() {
      await place(a, 0, 0, 0); await place(b, 70, 0, Math.PI)
      await begin()
      const [na, nb] = [await rams(a), await rams(b)]
      await Promise.all([drive(a, 1), drive(b, 1)])
      await Promise.race([rammed(a, na), rammed(b, nb)])
      await Promise.all([drive(a, 0), drive(b, 0)])
      return analyseRam(...await logs())
    },
    async chase() {
      await place(a, 0, 0, 0); await place(b, 14, 0, 0)
      await begin()
      const n = await rams(a)
      await Promise.all([drive(a, 1), drive(b, 1)])
      await wait(1500)
      await drive(b, 0)
      await rammed(a, n); await drive(a, 0)
      return analyseRam(...await logs())
    },
    async nearmiss() {
      await place(a, 0, 0, 0); await place(b, 35, 4.5, 0)
      await begin()
      await drive(a, 1); await wait(4500); await drive(a, 0)
      return analyseRam(...await logs())
    },
    async beam() {
      await place(a, 0, 0, 0); await place(b, 20, 0, 0)
      await begin()
      await stop(a); await stop(b)
      const before = await b.evaluate(() => window.syn3hNet.stats.hitsTaken)
      const t0 = Date.now()
      let sent = 0
      let tagged = false
      for (; sent < 8 && !tagged; sent++) {
        await a.evaluate((id) => { const n = window.syn3hNet; n.fire(undefined, n.remotes.get(id).vehicle.body.translation()) }, idB)
        tagged = await b.waitForFunction((n) => window.syn3hNet.stats.hitsTaken > n, before, { timeout: 1500 }).then(() => true, () => false)
      }
      return { tagged, beamsSent: sent, ms: tagged ? Date.now() - t0 : null }
    },
    async hill() {
      await place(b, 0, 0, 0)
      await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
      const t0 = Date.now()
      const gotZone = await b.waitForFunction(() => window.syn3hNet.game.mode === 1 && window.syn3hNet.game.koth.zone, null, { timeout: 10000 }).then(() => true, () => false)
      if (!gotZone) return { zoneOnB: false }
      const zoneMs = Date.now() - t0
      // A dry spot on the zone's mid line whose ground lies inside the zone's height band.
      const spot = await a.evaluate(() => {
        const zone = window.syn3hNet.game.koth.zone
        const r = (zone.inner + zone.outer) / 2
        const { terrain, player } = window.syn3h
        for (let k = 0; k < 64; k++) {
          const x = zone.x + Math.cos(k * 0.1) * r, z = zone.z + Math.sin(k * 0.1) * r
          const y = terrain.heightAt(x, z)
          if (y < zone.yMin + 1 || y > zone.yMax - 2 || (terrain.liquidHeightAt?.(x, z) ?? -Infinity) > y - 1) continue
          player.teleport(player.object.position.clone().set(x, y + 1.2, z), 0)
          return { angle: k * 0.1, y }
        }
        return null
      })
      if (!spot) return { zoneOnB: true, zoneMs, spot: null }
      const t1 = Date.now()
      const held = await b.waitForFunction((id) => window.syn3hNet.game.koth.holder === id, idA, { timeout: 10000 }).then(() => true, () => false)
      const captureMs = held ? Date.now() - t1 : null
      await wait(3000)
      const score = await b.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idA)
      await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
      const seen = await a.evaluate(() => {
        const p = window.syn3h.player.body.translation(), k = window.syn3hNet.game.koth
        return { p: [p.x, p.y, p.z].map((n) => +n.toFixed(1)), r: +Math.hypot(p.x - k.zone.x, p.z - k.zone.z).toFixed(1), zone: k.zone, holder: k.holder, contested: k.contested, stuck: k.out }
      })
      return { zoneOnB: true, zoneMs, captureSeenOnB: held, captureMs, scoreAfter3s: score, spot, seen }
    },
  }

  report = { label, net, set: Object.fromEntries(sets), runway: { range: round(runway.range), heading: round(runway.h) }, scenarios: {} }
  for (const name of only) {
    report.scenarios[name] = await scenarios[name]()
    console.error(name, JSON.stringify(report.scenarios[name]))
  }
  report.hud = await b.evaluate(() => document.getElementById('hud')?.textContent.match(/net:[^\n]*/)?.[0] ?? null)
  report.fps = await Promise.all([a, b].map((p) => p.evaluate(() => Number(document.getElementById('hud')?.textContent.match(/(\d+) fps/)?.[1] ?? 0))))
  report.tickRate = await Promise.all([a, b].map(async (p) => { const t0 = await p.evaluate(() => window.syn3h.game.tick); await wait(1000); return (await p.evaluate(() => window.syn3h.game.tick)) - t0 }))
  report.errors = errors
  report.replaced = replaced
} finally {
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
console.log(JSON.stringify(report))
