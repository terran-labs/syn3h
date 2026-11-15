/**
 * Two players on a wrapping world, at the seam. The world is one square tile whose edges
 * meet; positions travel inside the tile, so two cars a few metres apart across the seam are
 * a whole tile apart in plain numbers. Checks, in two real browsers:
 *
 *  1. cross    both drive through the seam side by side. Each must keep seeing the other
 *              where it really is: the separation each sees never differs from the true one
 *              by more than a few metres, and the copy never goes stale or streaks.
 *  2. chase    B drives off slowly across the seam, A chases and rear-ends it on the far side.
 *              The ram registers, "it" changes hands and B feels the hit.
 *  3. ram      B is parked just past the seam, A rams it from this side.
 *  4. beam     A sends a tag beam at B across the seam; B is tagged.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/wrap-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5183/'
const WORLD = 'alpine.7~terrain.planetSize=0,world.curve=0.45,world.wrap=true'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791', '--rtt', '40'], { stdio: 'ignore' })
let finished = false
proxy.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(3000)
const room = `wrap${Date.now() % 100000}`
const browsers = []
const errors = []
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 800, height: 450 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&world=${encodeURIComponent(WORLD)}&room=${room}&name=${name}`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 90000 })
  await page.evaluate(() => { window.syn3h.shell.play(); window.syn3h.params.set('gfx.level', 0) })
  return page
}
const results = []
const check = (name, ok, detail) => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }
const round = (n, d = 1) => (n == null ? null : +n.toFixed(d))

try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 })))
  const [idA, idB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3hNet.id)))
  const size = await a.evaluate(() => window.syn3h.terrain.wrapSize ?? 0)
  check('the world wraps and both players have the same tile', size > 0 && size === await b.evaluate(() => window.syn3h.terrain.wrapSize ?? 0), { size })
  const half = size / 2

  // A level line along +X through the seam at x = half, dry if there is one.
  const lane = await a.evaluate((half) => {
    const t = window.syn3h.terrain
    let best = null
    for (let z = -half + 40; z < half - 40; z += 16) {
      let lo = Infinity, hi = -Infinity, wet = false
      for (let x = half - 90; x <= half + 110; x += 3) for (const dz of [-5, 0, 5]) {
        const y = t.heightAt(x, z + dz)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
        if ((t.liquidHeightAt?.(x, z + dz) ?? -Infinity) > y - 0.5) wet = true
      }
      // Dry beats wet; among equals, the most level. The seam usually runs through the sea,
      // which vehicles cross afloat.
      const cand = { z, range: hi - lo, wet }
      if (!best || (best.wet && !wet) || (best.wet === wet && cand.range < best.range)) best = cand
    }
    return best
  }, half)
  console.log(`lane at z ${lane.z}, ground height range ${lane.range.toFixed(1)} m, ${lane.wet ? 'across the sea' : 'dry'}, seam at x ${half}`)

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
      log.push({ t: Date.now(), x: p.x, z: p.z, s: Math.hypot(v.x, v.z), rx: rp?.x ?? null, rz: rp?.z ?? null, mode: r?.sample.mode ?? 'none', visible: r?.vehicle.object.visible ?? false, rams: n.stats.rams, shoves: n.stats.shoves, it: n.game.it, up: n.connected, newest: r?.buffer.newest?.t ?? 0, got: n.stats.statesReceived, fps: Math.round(window.syn3h.game.fps ?? 0) })
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
    let frame = 0
    for (let i = 1; i < log.length; i++) frame = Math.max(frame, log[i].t - log[i - 1].t)
    return { worstErrorM: round(worst), worstRelativeStepM: round(jump), staleSamples: stale, hiddenSamples: hidden, disconnectedSamples: down, longestWaitForAnyStateMs: gap, longestPageStallMs: frame, lowestFps: Math.min(...log.map((e) => e.fps)) }
  }
  const crossed = (log) => ({ from: round(log[0].x), to: round(log.at(-1).x), top: round(Math.max(...log.map((e) => e.s))) })
  const settle = async () => { await Promise.all([drive(a, 0), drive(b, 0)]); await wait(4000) }

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

  // 2. Chase: B leaves slowly from 30 m short of the seam; A starts 30 m behind and catches it.
  await place(a, half - 60); await place(b, half - 30)
  await settle()
  await Promise.all([record(a, idB), record(b, idA)])
  const before2 = await a.evaluate(() => ({ rams: window.syn3hNet.stats.rams, it: window.syn3hNet.game.it }))
  await Promise.all([drive(a, 22), drive(b, 7)])
  await a.waitForFunction((n) => window.syn3hNet.stats.rams > n, before2.rams, { timeout: 20000 }).catch(() => {})
  await Promise.all([drive(a, 0), drive(b, 0)])
  await wait(2500)
  const [ca, cb] = await Promise.all([stop(a), stop(b)])
  const hit2 = ca.find((e) => e.rams > before2.rams)
  const b0 = hit2 ? at(cb, hit2.t) : null
  const gain2 = hit2 ? Math.max(...cb.filter((e) => e.t >= hit2.t && e.t <= hit2.t + 1500).map((e) => e.s)) - b0.s : null
  check('2. the chase ended in a ram on the far side of the seam', hit2 && wrapDelta(half, hit2.x) > 0, { ramAtX: round(hit2?.x), pastSeamBy: hit2 ? round(wrapDelta(half, hit2.x)) : null })
  // Afloat, the closing speed is a few m/s and the sea damps a small push at once, so the
  // test is that the car in front felt the hit (its own contact, or the relayed shove).
  const felt2 = cb.at(-1).shoves - cb[0].shoves + cb.at(-1).rams - cb[0].rams
  check('2. "it" changed hands and the car in front felt the hit', hit2 && ca.at(-1).it !== before2.it && felt2 >= 1, { itBefore: before2.it, itAfter: ca.at(-1).it, bobGainedMs: round(gain2), relayedShoves: cb.at(-1).shoves - cb[0].shoves, bobRams: cb.at(-1).rams - cb[0].rams })
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
  const hit3 = ra.find((e) => e.rams > before3.rams)
  const gain3 = hit3 ? Math.max(...rb.filter((e) => e.t >= hit3.t - 300 && e.t <= hit3.t + 1500).map((e) => e.s)) : null
  check('3. A rammed B across the seam', hit3 && Math.abs(wrapDelta(half, hit3.x)) < 20, { ramAtX: round(hit3?.x), bobAtX: round(rb[0].x) })
  check('3. "it" changed hands and B was shoved', hit3 && ra.at(-1).it !== before3.it && gain3 > 2, { itBefore: before3.it, itAfter: ra.at(-1).it, bobTopSpeed: round(gain3), bobRams: rb.at(-1).rams - rb[0].rams, relayedShoves: rb.at(-1).shoves - rb[0].shoves })
  check('3. each kept seeing the other where it really was', seen(ra, rb).worstErrorM < 8 && seen(rb, ra).worstErrorM < 8, { seenByA: seen(ra, rb), seenByB: seen(rb, ra) })
  // 4. Tag beam across the seam: A on this side, B 24 m away on the other.
  await place(a, half - 12); await place(b, -half + 12)
  await settle()
  const hitsBefore = await b.evaluate(() => window.syn3hNet.stats.hitsTaken)
  let beams = 0
  let tagged = false
  for (; beams < 6 && !tagged; beams++) {
    await a.evaluate((id) => { const n = window.syn3hNet; n.fire(undefined, n.remotes.get(id).vehicle.body.translation()) }, idB)
    tagged = await b.waitForFunction((n) => window.syn3hNet.stats.hitsTaken > n, hitsBefore, { timeout: 1500 }).then(() => true, () => false)
  }
  const sep = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3h.player.body.translation().x)))
  check('4. a tag beam sent across the seam tags the player on the other side', tagged, { beams, aliceX: round(sep[0]), bobX: round(sep[1]) })
  check('no page errors', errors.length === 0, errors)
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
const ok = results.length >= 12 && results.every(Boolean)
console.log(ok ? 'WRAP CHECK OK, screenshot /tmp/syn3h-wrap-cross.png' : 'WRAP CHECK FAILED')
process.exit(ok ? 0 : 1)
