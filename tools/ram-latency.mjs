/**
 * Measures how ramming behaves under latency. Two headless players join one room through
 * server/latency-proxy.ts and run four collisions; both pages log their own vehicle and their
 * copy of the other at 100 Hz, and the numbers below come from laying the two logs side by
 * side (same machine, so one wall clock).
 *
 * Needs a room server and a dev server whose client talks to the proxy port:
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/ram-latency.mjs --rtt 150 --jitter 30 [--set net.proxyBlend=0.2] [--only parked,chase]
 *
 * `--rtt` is each player's round trip, so a state takes about that long from one screen to
 * the other. `--set id=value` applies a client parameter on both pages (repeatable).
 *
 * Scenarios, on the flattest 80 m line near the origin:
 *   parked    B is parked 35 m ahead; A drives into its back.
 *   headon    A and B start 70 m apart and drive at each other.
 *   nearmiss  B is parked 4.5 m to the side of A's line; A drives past. No ram should count.
 *   chase     B drives off for 1.5 s and coasts; A starts behind and catches it.
 *
 * Per scenario, as JSON:
 *   ramA, ramB        whether each client detected a ram, and how many
 *   gapMs             B's detection time minus A's (how late the victim feels it)
 *   speedA            A's speed just before its contact, m/s
 *   keptA             fraction of that speed A still has 0.3 s later (0 = hit a wall)
 *   shoveB            B's peak speed gain in the 1.5 s after the first contact, m/s
 *   movedB            how far B ended from where it stood at first contact, m
 *   ghostBonA         at A's contact, distance between B's copy on A and the real B, m
 *   ghostAonB         at B's contact, distance between A's copy on B and the real A, m
 *   settleA, settleB  the same two distances 2.5 s after, once everything is at rest
 *   itMs              ms from the first contact until "it" changed hands (null if it did not)
 *   delayA, delayB    the interpolation delay each client was using, ms
 *   wentA, wentB      how far each travelled over the whole scenario, m
 *   topA, topB        each one's top speed, m/s
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const base = opt('base', 'http://localhost:5183/')
const rtt = Number(opt('rtt', '0'))
const jitter = Number(opt('jitter', '0'))
const listen = opt('listen', '8794')
const target = opt('target', 'http://127.0.0.1:8791')
const only = opt('only', 'parked,headon,nearmiss,chase').split(',')
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1].split('=')] : []))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const proxy = spawn('npx', ['tsx', 'server/latency-proxy.ts', '--listen', listen, '--target', target, '--rtt', String(rtt), '--jitter', String(jitter)], { stdio: ['ignore', 'ignore', 'inherit'] })
await wait(2500)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const room = `ram${Date.now() % 100000}`
const errors = []
async function open(name) {
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
  window.__ramLog = log
  clearInterval(window.__ramTimer)
  window.__ramTimer = setInterval(() => {
    const net = window.syn3hNet
    const p = window.syn3h.player.body.translation()
    const v = window.syn3h.player.body.linvel()
    const r = net.remotes.get(other)
    const rp = r?.vehicle.body.translation()
    log.push({ t: Date.now(), p: [p.x, p.y, p.z], s: Math.hypot(v.x, v.z), rp: rp ? [rp.x, rp.y, rp.z] : null, phys: r?.physical ?? false, delay: r?.delay ?? 0, rams: net.stats.rams, it: net.game.it })
  }, 10)
}, other)
const stop = (page) => page.evaluate(() => { clearInterval(window.__ramTimer); return window.__ramLog })

const d2 = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2])
const at = (log, t) => log.reduce((best, e) => (Math.abs(e.t - t) < Math.abs(best.t - t) ? e : best), log[0])
const round = (x, n = 2) => (x == null ? null : +x.toFixed(n))

function analyse(logA, logB) {
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
    wentA: round(d2(logA.at(-1).p, logA[0].p), 1),
    wentB: round(d2(logB.at(-1).p, logB[0].p), 1),
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
      for (let s = -6; s <= 86; s += 2) for (const l of [-5, 0, 5]) {
        const x = ox + f[0] * s + f[1] * l, z = oz + f[1] * s - f[0] * l
        const y = t.heightAt(x, z)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
        if ((t.liquidHeightAt?.(x, z) ?? -Infinity) > y) wet = true
      }
      if (!wet && (!best || hi - lo < best.range)) best = { ox, oz, h, range: hi - lo }
    }
    return best
  })
  const place = (page, s, l, heading) => page.evaluate(({ runway, s, l, heading }) => {
    const { terrain, player } = window.syn3h
    const f = [-Math.sin(runway.h), -Math.cos(runway.h)]
    const x = runway.ox + f[0] * s + f[1] * l, z = runway.oz + f[1] * s - f[0] * l
    const pos = player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z)
    player.teleport(pos, runway.h + heading)
  }, { runway, s, l, heading })
  const rammed = (page, n) => page.waitForFunction((n) => window.syn3hNet.stats.rams > n, n, { timeout: 9000 }).catch(() => {})
  const rams = (page) => page.evaluate(() => window.syn3hNet.stats.rams)
  const cooldown = await a.evaluate(() => window.syn3h.params.get('tag.cooldown')?.value ?? 3)

  const scenarios = {
    async parked() {
      await place(a, 0, 0, 0); await place(b, 35, 0, 0)
      await begin()
      const n = await rams(a)
      await a.keyboard.down('KeyW'); await rammed(a, n); await a.keyboard.up('KeyW')
    },
    async headon() {
      await place(a, 0, 0, 0); await place(b, 70, 0, Math.PI)
      await begin()
      const [na, nb] = [await rams(a), await rams(b)]
      await Promise.all([a.keyboard.down('KeyW'), b.keyboard.down('KeyW')])
      await Promise.race([rammed(a, na), rammed(b, nb)])
      await Promise.all([a.keyboard.up('KeyW'), b.keyboard.up('KeyW')])
    },
    async nearmiss() {
      await place(a, 0, 0, 0); await place(b, 35, 4.5, 0)
      await begin()
      await a.keyboard.down('KeyW'); await wait(4500); await a.keyboard.up('KeyW')
    },
    async chase() {
      await place(a, 0, 0, 0); await place(b, 14, 0, 0)
      await begin()
      const n = await rams(a)
      await Promise.all([a.keyboard.down('KeyW'), b.keyboard.down('KeyW')])
      await wait(1500)
      await b.keyboard.up('KeyW')
      await rammed(a, n); await a.keyboard.up('KeyW')
    },
  }
  /** Let both settle where they were placed and the tag cooldown pass, then start logging. */
  async function begin() {
    await wait(Math.max(2500, cooldown * 1000 + 800))
    await Promise.all([record(a, idB), record(b, idA)])
    await wait(200)
  }

  report = { rtt, jitter, set: Object.fromEntries(sets), runway: { range: round(runway.range), heading: round(runway.h) }, scenarios: {} }
  for (const name of only) {
    await scenarios[name]()
    await wait(2500)
    const [logA, logB] = await Promise.all([stop(a), stop(b)])
    report.scenarios[name] = analyse(logA, logB)
    console.error(name, JSON.stringify(report.scenarios[name]))
  }
  report.fps = await Promise.all([a, b].map((p) => p.evaluate(() => Number(document.getElementById('hud')?.textContent.match(/(\d+) fps/)?.[1] ?? 0))))
  report.errors = errors
} finally {
  await browser.close()
  proxy.kill()
}
console.log(JSON.stringify(report))
