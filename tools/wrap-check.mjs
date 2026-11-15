/**
 * Two players on a wrapping world, at the seam. The world is one square tile whose edges
 * meet; positions travel inside the tile, so two cars a few metres apart across the seam are
 * a whole tile apart in plain numbers. Checks, in two real browsers:
 *
 *  1. cross    both drive through the seam side by side. Each must keep seeing the other
 *              where it really is: the separation each sees never differs from the true one
 *              by more than a few metres, and the copy never goes stale or streaks.
 *  2. chase    B drives off slowly across the seam, A chases and rear-ends it on the far side.
 *              The ram registers and "it" changes hands.
 *  3. ram      B is parked just past the seam, A rams it from this side.
 *  4. beam     A sends a tag beam at B across the seam; B is tagged.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/wrap-check.mjs
 *   node tools/wrap-check.mjs https://www.syn3h.com/ --direct
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { checkPublicBuild } from './check-public-build.mjs'
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5183/'
const WORLD = 'alpine.7~terrain.planetSize=0,world.curve=0.8,terrain.dry=1,world.lavaAltitude=-80'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = process.argv.includes('--direct') ? null : spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791', '--rtt', '40'], { stdio: 'ignore' })
let finished = false
proxy?.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
if (proxy) await wait(3000)
const room = `wrap${Date.now() % 100000}`
const browsers = []
const pages = []
const raw = { world: WORLD, readiness: [], stages: [], errors: [] }
const rawPath = process.env.WRAP_DIAGNOSTICS ?? '/tmp/syn3h-wrap-diagnostic.json'
process.once('SIGTERM', async () => {
  raw.failure = 'External fixture deadline'
  raw.clients = await Promise.all(pages.map(p => p.evaluate(() => ({ diagnostics: window.__wrapDiag, startup: window.syn3hStartup })).catch(() => null)))
  writeFileSync(rawPath, JSON.stringify(raw))
  finished = true
  await Promise.all(browsers.map(b => b.close()))
  proxy?.kill()
  process.exit(1)
})
const errors = []
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 800, height: 450 } })).newPage()
  pages.push(page)
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&world=${encodeURIComponent(WORLD)}&room=${room}&name=${name}`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 90000 })
  await page.evaluate(() => { window.syn3h.shell.play(); window.syn3h.params.set('gfx.level', 0); window.syn3h.params.set('daydream.seconds', 0) })
  return page
}
const results = []
const check = (name, ok, detail) => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }
const round = (n, d = 1) => (n == null ? null : +n.toFixed(d))

try {
  if (process.env.EXPECTED_BUILD_DIR) {
    raw.identity = await checkPublicBuild(base, process.env.EXPECTED_BUILD_DIR)
    console.log('PUBLIC BUILD OK', JSON.stringify(raw.identity))
  }
  const a = await open('Alice')
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 })))
  const [idA, idB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3hNet.id)))
  const size = await a.evaluate(() => window.syn3h.terrain.wrapSize ?? 0)
  check('the world wraps and both players have the same tile', size > 0 && size === await b.evaluate(() => window.syn3h.terrain.wrapSize ?? 0), { size })
  const half = size / 2

  // A dry corridor is a precondition, never a preference with a wet fallback. Include
  // both lanes and braking room, sampling both clients rather than trusting a shared seed.
  const corridor = async (page, zOnly = null) => page.evaluate(({ half, zOnly }) => {
    const t = window.syn3h.terrain
    const candidates = [], rejected = []
    for (let z = zOnly ?? -half + 40; z < (zOnly === null ? half - 40 : zOnly + 1); z += 16) {
      let lo = Infinity, hi = -Infinity, wet = false, slope = 0, maxLiquid = -Infinity, nonfinite = 0, minClearance = Infinity
      const heights = []
      for (let x = half - 90; x <= half + 132; x += 3) for (const dz of [-10, -5, 0, 6, 11, 16]) {
        const y = t.heightAt(x, z + dz), liquid = t.liquidHeightAt(x, z + dz)
        heights.push(y)
        maxLiquid = Math.max(maxLiquid, liquid)
        minClearance = Math.min(minClearance, y - liquid)
        if (!Number.isFinite(y) || !Number.isFinite(liquid)) nonfinite++
        if (!Number.isFinite(y) || !Number.isFinite(liquid) || y < liquid + 1) wet = true
        slope = Math.max(slope, Math.abs(t.heightAt(x + 1, z + dz) - y), Math.abs(t.heightAt(x, z + dz + 1) - y))
        lo = Math.min(lo, y); hi = Math.max(hi, y)
      }
      if (!wet && slope <= 0.3) candidates.push({ z, range: hi - lo, slope, heights })
      else rejected.push({ z, minGround: lo, maxGround: hi, maxLiquid, minClearance, maxSlope: slope, wet, nonfinite, steep: slope > 0.3 })
    }
    candidates.sort((a, b) => a.range - b.range)
    return { lane: candidates[0] ?? null, validCount: candidates.length, rejected, params: window.syn3h.params.snapshot('world'), size: t.wrapSize }
  }, { half, zOnly })
  const first = await corridor(a)
  raw.corridor = { first }
  const second = await corridor(b, first.lane?.z ?? null)
  raw.corridor.second = second
  if (process.argv.includes('--sample-only')) {
    check('sampling found a supported dry route on both clients', Boolean(first.lane && second.lane),
      { candidatesA: first.validCount, candidatesB: second.validCount, rejectedA: first.rejected.length, rejectedB: second.rejected.length })
    // Sampling is diagnostic only. It cannot print WRAP CHECK OK or satisfy the full gate.
    throw new Error('Sampling-only diagnostic complete; full gate not run')
  }
  if (!first.lane) throw new Error('No verified dry gentle seam corridor; fixture unavailable')
  const equalParams = Object.keys({ ...first.params, ...second.params }).every(k => first.params[k] === second.params[k])
  if (!second.lane || !equalParams || first.size !== second.size || first.lane.heights.some((h, i) => Math.abs(h - second.lane.heights[i]) > 0.01)) throw new Error('Clients disagree on dry corridor/world')
  const lane = first.lane
  raw.corridor = { first, second }
  console.log(`verified dry lane z ${lane.z}, range ${lane.range.toFixed(1)} m, slope ${lane.slope.toFixed(3)}, seam x ${half}`)

  // Diagnostic wrappers preserve calls and arguments. Observe target arrivals and actual
  // ram target, not just aggregate counters which may include another actor.
  await Promise.all([[a, idB], [b, idA]].map(([page, other]) => page.evaluate(other => {
    const s = window.syn3h, n = window.syn3hNet, r = n.remotes.get(other)
    const d = window.__wrapDiag = { arrivals: [], frames: [], samples: [], contacts: [], teleports: 0 }
    const push = r.push.bind(r)
    r.push = (...args) => { d.arrivals.push({ at: performance.now(), t: args[0].t }); return push(...args) }
    const contact = n.onContact.bind(n)
    n.onContact = (...args) => { d.contacts.push({ at: Date.now(), target: args[0] }); return contact(...args) }
    const teleport = s.player.teleport.bind(s.player)
    s.player.teleport = (...args) => { d.teleports++; return teleport(...args) }
    const frame = at => { d.frames.push(at); requestAnimationFrame(frame) }; requestAnimationFrame(frame)
    setInterval(() => {
      const p = s.player.body.translation(), v = s.player.body.linvel()
      d.samples.push({ at: performance.now(), t: Date.now(), tick: s.game.tick, gameTime: s.game.time,
        sent: n.stats.statesSent, received: n.stats.statesReceived, heartbeats: n.stats.heartbeats,
        newest: r.buffer.newest?.t, overrun: r.sample.overrun, mode: r.sample.mode, delay: r.delay,
        roomNow: n.roomNow(), synced: n.clock.synced, rtt: n.clock.rtt, hidden: document.hidden,
        suspended: s.game.input.suspended, buffered: n.conn?.ws?.bufferedAmount ?? null,
        position: { ...p }, velocity: { ...v }, ground: s.terrain.heightAt(p.x, p.z), liquid: s.terrain.liquidHeightAt(p.x, p.z),
        input: { ...s.game.input.state }, external: { ...s.game.input.external }, teleports: d.teleports })
    }, 100)
  }, other)))
  const ready = async (label, placement = false) => {
    // At least two continuous seconds, bounded by thirty seconds. Retain all pre-gate
    // evidence; nothing is removed from measured-stage logs to manufacture a pass.
    const started = Date.now()
    try {
      await Promise.all([[a, idB], [b, idA]].map(([page, other]) => page.waitForFunction(({ other, placement }) => {
        const s = window.syn3h, n = window.syn3hNet, d = window.__wrapDiag, now = performance.now()
        const samples = d.samples.filter(e => e.at >= now - 2100)
        const arrivals = d.arrivals.filter(e => e.at >= now - 2000)
        const frames = d.frames.filter(t => t >= now - 2000)
        if (!n.connected || !n.clock.synced || !s.shell.playing || document.hidden || s.game.input.suspended || samples.length < 18 || samples[0].at > now - 2000) return false
        if (samples.some(e => e.mode === 'stale' || e.hidden || e.suspended) || arrivals.length < 20 || frames.length < 20) return false
        const gaps = list => Math.max(list[0] - (now - 2000), now - list.at(-1), ...list.slice(1).map((t, i) => t - list[i]))
        if (gaps(arrivals.map(e => e.at)) > 250 || gaps(frames) > 250 || arrivals.at(-1).t <= arrivals[0].t) return false
        if (placement) {
          const r = n.remotes.get(other), expected = window.__wrapOtherPlacement, p = r.vehicle.body.translation(), size = s.terrain.wrapSize
          const delta = (a, b) => { let d = a - b; return d - size * Math.floor(d / size + 0.5) }
          if (!expected || Math.hypot(delta(p.x, expected.x), p.y - expected.y, delta(p.z, expected.z)) > 2) return false
        }
        return true
      }, { other, placement }, { timeout: 30000, polling: 100 })))
      raw.readiness.push({ label, ms: Date.now() - started, ok: true })
      console.log('READY', label, Date.now() - started)
    } catch (e) { raw.readiness.push({ label, ms: Date.now() - started, ok: false }); throw e }
  }
  await ready('startup')

  /** Put a page's vehicle at world x (any image), on the lane, facing +X. */
  const place = (page, x, dz = 0) => page.evaluate(({ x, z }) => {
    const { terrain, player } = window.syn3h
    player.teleport(player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z), -Math.PI / 2)
  }, { x, z: lane.z + dz })
  /** Drive along +X at up to `speed` m/s holding the lane (0 lets go). */
  const drive = (page, speed, dz = 0) => page.evaluate(({ speed, z }) => {
    clearInterval(window.__drive)
    const e = window.syn3h.game.input.external
    e.y = 0; e.x = 0
    if (!speed) return
    window.__drive = setInterval(() => {
      const body = window.syn3h.player.body
      const v = body.linvel(), p = body.translation(), q = body.rotation()
      e.y = Math.hypot(v.x, v.z) < speed ? 1 : 0
      const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      // Aim at a point 30 m ahead on the lane.
      const dx = 30, dzz = z - p.z, d = Math.hypot(dx, dzz)
      e.x = Math.max(-0.4, Math.min(0.4, 3 * (fx * dzz - fz * dx) / d))
    }, 20)
  }, { speed, z: lane.z + dz })
  /** Log, on a page: own position and speed, where it draws the other, and the game state. */
  const record = (page, other) => page.evaluate((other) => {
    const log = []
    window.__log = log
    clearInterval(window.__logTimer)
    window.__logTimer = setInterval(() => {
      const n = window.syn3hNet, p = window.syn3h.player.body.translation(), v = window.syn3h.player.body.linvel()
      const r = n.remotes.get(other), rp = r?.vehicle.body.translation()
      log.push({ teleports: window.__wrapDiag.teleports, contacts: window.__wrapDiag.contacts.length, lastTarget: window.__wrapDiag.contacts.at(-1)?.target, y: p.y, ground: window.syn3h.terrain.heightAt(p.x, p.z), liquid: window.syn3h.terrain.liquidHeightAt(p.x, p.z), t: Date.now(), x: p.x, z: p.z, s: Math.hypot(v.x, v.z), rx: rp?.x ?? null, rz: rp?.z ?? null, mode: r?.sample.mode ?? 'none', visible: r?.vehicle.object.visible ?? false, rams: n.stats.rams, shoves: n.stats.shoves, it: n.game.it, up: n.connected, newest: r?.buffer.newest?.t ?? 0, got: n.stats.statesReceived, fps: Math.round(window.syn3h.game.fps ?? 0) })
    }, 10)
  }, other)
  const stop = (page) => page.evaluate(() => { clearInterval(window.__logTimer); return window.__log })
  const wrapDelta = (from, to) => { const d = to - from; return d - size * Math.floor(d / size + 0.5) }
  const at = (log, t) => log.reduce((best, e) => (Math.abs(e.t - t) < Math.abs(best.t - t) ? e : best), log[0])
  /** How far what `log` sees of the other is from the truth in `truth`, over the whole run. */
  function seen(log, truth) {
    let worst = 0, jump = 0, stale = 0, hidden = 0, last = null
    for (const e of log) {
      if (e.rx == null) continue
      const o = at(truth, e.t)
      // The offset the page draws, against the true offset the short way round.
      const err = Math.hypot((e.rx - e.x) - wrapDelta(e.x, o.x), (e.rz - e.z) - wrapDelta(e.z, o.z))
      worst = Math.max(worst, err)
      if (last) jump = Math.max(jump, Math.hypot((e.rx - e.x) - (last.rx - last.x), (e.rz - e.z) - (last.rz - last.z)))
      if (e.mode === 'stale') stale++
      if (!e.visible) hidden++
      last = e
    }
    // Diagnostics for a bad run: was the connection up, were states arriving, was the page drawing?
    const down = log.filter((e) => !e.up).length
    let gap = 0, lastChange = log[0].t
    for (let i = 1; i < log.length; i++) if (log[i].got !== log[i - 1].got) { gap = Math.max(gap, log[i].t - lastChange); lastChange = log[i].t }
    gap = Math.max(gap, log.at(-1).t - lastChange)
    let frame = 0
    for (let i = 1; i < log.length; i++) frame = Math.max(frame, log[i].t - log[i - 1].t)
    return { worstErrorM: round(worst), worstRelativeStepM: round(jump), staleSamples: stale, hiddenSamples: hidden, disconnectedSamples: down, longestWaitForAnyStateMs: gap, longestPageStallMs: frame, lowestFps: Math.min(...log.map((e) => e.fps)) }
  }
  const crossed = (log) => ({ from: round(log[0].x), to: round(log.at(-1).x), top: round(Math.max(...log.map((e) => e.s))) })
  const settle = async () => {
    await Promise.all([drive(a, 0), drive(b, 0)]); await wait(1200)
    const positions = await Promise.all([a, b].map(p => p.evaluate(() => ({ ...window.syn3h.player.body.translation() }))))
    await Promise.all([a, b].map((p, i) => p.evaluate(expected => { window.__wrapOtherPlacement = expected }, positions[1 - i])))
    await ready('placement', true)
  }
  const saveStage = (name, left, right) => {
    raw.stages.push({ name, left, right })
    const valid = [left, right].every(log => log.length > 1 && log.every(e => e.teleports === log[0].teleports && e.ground > e.liquid + 1 && wrapDelta(half, e.x) >= -90 && wrapDelta(half, e.x) <= 130 && wrapDelta(lane.z, e.z) >= -10 && wrapDelta(lane.z, e.z) <= 16))
    check(`${name}. fixture stayed dry without recovery teleports or lane escape`, valid, {})
  }

  // 1. Both cross the seam, side by side: A on the lane, B 6 m to its right and 4 m ahead.
  await place(a, half - 70); await place(b, half - 66, 6)
  await settle()
  await Promise.all([record(a, idB), record(b, idA)])
  await Promise.all([drive(a, 16), drive(b, 16, 6)])
  // Until each is 60 m past the seam, measured round the wrap: its own position is kept
  // inside the tile, so it goes from +half to -half as it crosses.
  await Promise.all([a, b].map((p) => p.waitForFunction(({ half, size }) => {
    let d = window.syn3h.player.body.translation().x - half
    d -= size * Math.floor(d / size + 0.5)
    return d > 60 && d < 200
  }, { half, size }, { timeout: 40000 }).catch(() => {})))
  await Promise.all([drive(a, 0), drive(b, 0)])
  await wait(1500)
  const [la, lb] = await Promise.all([stop(a), stop(b)])
  saveStage('cross', la, lb)
  const canon = await a.evaluate((x) => window.syn3hNet.canonical([x, 0, 0])[0], half + 60)
  const seenByA = seen(la, lb), seenByB = seen(lb, la)
  await b.screenshot({ path: '/tmp/syn3h-wrap-cross.png' })
  check('1. both crossed the seam', la.some((e) => wrapDelta(half, e.x) > 20) && lb.some((e) => wrapDelta(half, e.x) > 20), { alice: crossed(la), bob: crossed(lb) })
  // The local seam shift lets a vehicle run a little past the edge before moving it a tile
  // (so it does not flip back and forth on the line); what goes on the wire is always inside.
  const overrun = Math.max(...[...la, ...lb].map((e) => Math.abs(e.x) - half))
  check('1. positions go on the wire inside the tile, and each player is kept near it', Math.abs(canon - (half + 60 - size)) < 1e-6 && overrun < 64, { sent: canon, for: half + 60, furthestPastTheEdgeM: round(overrun) })
  check('1. each kept seeing the other where it really was', seenByA.worstErrorM < 6 && seenByB.worstErrorM < 6 && seenByA.staleSamples + seenByB.staleSamples === 0, { seenByA, seenByB })
  if (seenByA.worstErrorM >= 6 || seenByB.worstErrorM >= 6) {
    // Keep the raw logs of a bad crossing: it is intermittent.
    const { writeFileSync } = await import('node:fs')
    writeFileSync('/tmp/syn3h-wrap-bad.json', JSON.stringify({ size, lane, la, lb }))
    console.log('raw logs of the bad crossing saved to /tmp/syn3h-wrap-bad.json')
  }
  check('1. no copy streaked or snapped across the world', seenByA.worstRelativeStepM < 6 && seenByB.worstRelativeStepM < 6, { stepA: seenByA.worstRelativeStepM, stepB: seenByB.worstRelativeStepM })

  // 2. Chase: B starts 10 m short, A 40 m behind. Dry-ground closure allows a far-side hit.
  await place(a, half - 50); await place(b, half - 10)
  await settle()
  await Promise.all([record(a, idB), record(b, idA)])
  const before2 = await a.evaluate(() => ({ rams: window.syn3hNet.stats.rams, it: window.syn3hNet.game.it }))
  await Promise.all([drive(a, 22), drive(b, 7)])
  await a.waitForFunction((n) => window.syn3hNet.stats.rams > n, before2.rams, { timeout: 20000 }).catch(() => {})
  await Promise.all([drive(a, 0), drive(b, 0)])
  await wait(2500)
  const [ca, cb] = await Promise.all([stop(a), stop(b)])
  saveStage('chase', ca, cb)
  const hit2 = ca.find((e) => e.rams > before2.rams && e.lastTarget === idB)
  const b0 = hit2 ? at(cb, hit2.t) : null
  const gain2 = hit2 ? Math.max(...cb.filter((e) => e.t >= hit2.t && e.t <= hit2.t + 1500).map((e) => e.s)) - b0.s : null
  check('2. the chase ended in a ram on the far side of the seam', hit2 && wrapDelta(half, hit2.x) > 0, { ramAtX: round(hit2?.x), pastSeamBy: hit2 ? round(wrapDelta(half, hit2.x)) : null })
  // Keep tag transfer mandatory here; the parked-target case also requires a shove.
  check('2. the room accepted the ram across the wrap: "it" changed hands', hit2 && ca.at(-1).it !== before2.it, { itBefore: before2.it, itAfter: ca.at(-1).it, bobGainedMs: round(gain2), relayedShoves: cb.at(-1).shoves - cb[0].shoves, bobRams: cb.at(-1).rams - cb[0].rams })
  check('2. each kept seeing the other where it really was', seen(ca, cb).worstErrorM < 8 && seen(cb, ca).worstErrorM < 8, { seenByA: seen(ca, cb), seenByB: seen(cb, ca) })

  // 3. Ram: B parked 8 m past the seam (inside the tile that is x = -half + 8), A from this side.
  await place(a, half - 50); await place(b, -half + 8)
  await settle()
  await Promise.all([record(a, idB), record(b, idA)])
  const before3 = await a.evaluate(() => ({ rams: window.syn3hNet.stats.rams, it: window.syn3hNet.game.it }))
  await drive(a, 20)
  await a.waitForFunction((n) => window.syn3hNet.stats.rams > n, before3.rams, { timeout: 20000 }).catch(() => {})
  await drive(a, 0)
  await wait(2500)
  const [ra, rb] = await Promise.all([stop(a), stop(b)])
  saveStage('ram', ra, rb)
  const hit3 = ra.find((e) => e.rams > before3.rams && e.lastTarget === idB)
  const gain3 = hit3 ? Math.max(...rb.filter((e) => e.t >= hit3.t - 300 && e.t <= hit3.t + 1500).map((e) => e.s)) : null
  check('3. A rammed B across the seam', hit3 && Math.abs(wrapDelta(half, hit3.x)) < 20, { ramAtX: round(hit3?.x), bobAtX: round(rb[0].x) })
  check('3. "it" changed hands and B was shoved', hit3 && ra.at(-1).it !== before3.it && gain3 > 2, { itBefore: before3.it, itAfter: ra.at(-1).it, bobTopSpeed: round(gain3), bobRams: rb.at(-1).rams - rb[0].rams, relayedShoves: rb.at(-1).shoves - rb[0].shoves })
  check('3. each kept seeing the other where it really was', seen(ra, rb).worstErrorM < 8 && seen(rb, ra).worstErrorM < 8, { seenByA: seen(ra, rb), seenByB: seen(rb, ra) })
  // 4. Tag beam across the seam: A on this side, B 24 m away on the other.
  await place(a, half - 12); await place(b, -half + 12)
  await settle()
  await Promise.all([record(a, idB), record(b, idA)])
  const hitsBefore = await b.evaluate(() => window.syn3hNet.stats.hitsTaken)
  let beams = 0
  let tagged = false
  for (; beams < 6 && !tagged; beams++) {
    await a.evaluate((id) => { const n = window.syn3hNet; n.fire(undefined, n.remotes.get(id).vehicle.body.translation()) }, idB)
    tagged = await b.waitForFunction((n) => window.syn3hNet.stats.hitsTaken > n, hitsBefore, { timeout: 1500 }).then(() => true, () => false)
  }
  const sep = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3h.player.body.translation().x)))
  const [ba, bb] = await Promise.all([stop(a), stop(b)])
  saveStage('beam', ba, bb)
  check('4. a tag beam sent across the seam tags the player on the other side', tagged, { beams, aliceX: round(sep[0]), bobX: round(sep[1]) })
  check('no page errors', errors.length === 0, errors)
} catch (e) {
  raw.failure = e.stack ?? String(e)
  check('fixture/readiness completed', false, { message: e.message })
} finally {
  raw.errors = errors
  raw.results = results
  raw.clients = await Promise.all(pages.map(p => p.evaluate(() => ({ diagnostics: window.__wrapDiag, startup: window.syn3hStartup })).catch(e => ({ error: String(e) }))))
  writeFileSync(rawPath, JSON.stringify(raw))
  console.log('raw diagnostics saved', rawPath)
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy?.kill()
}
const ok = results.length >= 12 && results.every(Boolean)
console.log(ok ? 'WRAP CHECK OK, screenshot /tmp/syn3h-wrap-cross.png' : 'WRAP CHECK FAILED')
process.exit(ok ? 0 : 1)
