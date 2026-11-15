/**
 * Regression check: a buggy must still drive after a hard ram.
 *
 * The defect it guards against: a vehicle to vehicle contact set the buggy's `isInverted`
 * flag and nothing cleared it, so the suspension and tyre load stayed off and the rammer sat
 * on its skid plate with the motor spinning, upright but unable to move.
 *
 * Player A rams a parked player B twelve times: at about 10, 20 and 30 m/s, into B's back
 * (head on) and into B's side, twice each (SPEEDS=10 REPS=6 node ... to change that). After
 * each ram A lets go and the script waits, up to 12 s, for A to be upright on its
 * wheels (a hard ram may roll it; righting itself is part of the check). It then notes A's
 * flag, ride height and wheel compression, and A tries to drive: forward for 3 s, then in
 * reverse for 6 s, in place, with no teleport first. Reverse matters: after a gentle ram A
 * rests against B, and forward only pushes into it.
 *
 * A ram fails if A never ends up upright, cannot gain 2 m/s and travel 2 m in a commanded direction, or
 * still has the flag set after driving. Exit 1 on any failure. A run where A missed B is
 * reported as a miss, not credited as coverage. Any missing collision coverage fails. FLAT_PATCH=1 uses an
 * elevated flat collider in both clients to isolate recovery from hills. BASE_URL targets
 * a managed preview without starting the local latency proxy.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/ram-inverted-repro.mjs
 *
 * Each player gets its own browser process: two pages in one headless Chrome starve each
 * other's frame loop.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// A supplied managed preview already has its room connection; do not start a second proxy.
const flatPatch = process.env.FLAT_PATCH === '1'
const base = process.env.BASE_URL ?? 'http://localhost:5183/'
const proxy = process.env.BASE_URL ? null : spawn('npx', ['tsx', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791'], { stdio: 'ignore' })
let finished = false
proxy?.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(2500)
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const browsers = []
const errors = []
const room = `ram${Date.now()}`
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  const url = new URL(base)
  url.searchParams.set('room', room); url.searchParams.set('name', name); url.searchParams.set('autoplay', '1')
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.syn3h.shell.play()
    window.syn3h.params.set('gfx.level', 0)
    // Automation writes input.external rather than human events. Daydream would take
    // over after 30 seconds and drive the supposedly parked target out of the fixture.
    window.syn3h.params.set('daydream.seconds', 0)
    window.syn3h.params.set('bots.count', 0)
  })
  await page.evaluate(async flatPatch => {
    const s = window.syn3h
    const originalTeleport = s.player.teleport.bind(s.player)
    window.__ramTeleports = 0
    window.__ramOutside = false
    window.__ramMonitoring = false
    setInterval(() => {
      if (!window.__ramMonitoring) return
      const p = s.player.body.translation()
      if (Math.abs(p.x) > 390 || Math.abs(p.z) > 390) window.__ramOutside = true
    }, 20)
    s.player.teleport = (...args) => { window.__ramTeleports++; return originalTeleport(...args) }
    if (flatPatch) {
      // Browser-test-only surface, identical in both clients. No gameplay defaults change.
      const { RAPIER, groups, GROUP_TERRAIN, GROUP_ALL } = await import('/src/core/physics.ts')
      const top = 1000
      s.game.world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, top - 1, 0).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
      s.terrain.heightAt = () => top
      s.terrain.normalAt = (_x, _z, out) => out.set(0, 1, 0)
    }
  }, flatPatch)
  return page
}

let failed = 0
let missed = 0
const rows = []
try {
  const a = await open('A')
  const b = await open('B')
  const targetId = await b.evaluate(() => window.syn3hNet.id)
  await a.waitForFunction(() => window.syn3hNet.remotes.size === 1, null, { timeout: 20000 })
  // The flattest dry 125 m line near the origin: 30 m/s needs a long run up.
  const runway = flatPatch ? { ox: 0, oz: 0, h: 0, range: 0 } : await a.evaluate(() => {
    const t = window.syn3h.terrain
    let best = null
    for (let ox = -160; ox <= 160; ox += 40) for (let oz = -160; oz <= 160; oz += 40) for (let k = 0; k < 16; k++) {
      const h = (k / 16) * Math.PI * 2
      const f = [-Math.sin(h), -Math.cos(h)]
      let lo = Infinity, hi = -Infinity, wet = false
      for (let s = -6; s <= 130; s += 3) for (const l of [-6, 0, 6]) {
        const x = ox + f[0] * s + f[1] * l, z = oz + f[1] * s - f[0] * l
        const y = t.heightAt(x, z)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
        if ((t.liquidHeightAt?.(x, z) ?? -Infinity) > y) wet = true
      }
      if (!wet && (!best || hi - lo < best.range)) best = { ox, oz, h, range: hi - lo }
    }
    return best
  })
  const place = (page, s, heading) => page.evaluate(({ runway, s, heading }) => {
    const { terrain, player } = window.syn3h
    const f = [-Math.sin(runway.h), -Math.cos(runway.h)]
    const x = runway.ox + f[0] * s, z = runway.oz + f[1] * s
    player.teleport(player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z), runway.h + heading)
  }, { runway, s, heading })
  /** Hold A at `target` m/s, steering at the point `s` metres down the runway (0 lets go). */
  const cruise = (target, s = 0) => a.evaluate(({ target, s, runway }) => {
    clearInterval(window.__cruise)
    const e = window.syn3h.game.input.external
    e.y = 0; e.x = 0
    if (!target) return
    const bx = runway.ox - Math.sin(runway.h) * s, bz = runway.oz - Math.cos(runway.h) * s
    window.__cruise = setInterval(() => {
      const body = window.syn3h.player.body
      const v = body.linvel(), p = body.translation(), q = body.rotation()
      e.y = Math.hypot(v.x, v.z) < target ? 1 : 0
      // Forward is -Z. Steer by the cross product of forward and the bearing to the target;
      // let go of the wheel for the last few metres so the hit is square.
      const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      const dx = bx - p.x, dz = bz - p.z, d = Math.hypot(dx, dz)
      e.x = d > 8 ? Math.max(-0.5, Math.min(0.5, 3 * (fx * dz - fz * dx) / d)) : 0
    }, 20)
  }, { target, s, runway })
  const state = () => a.evaluate(() => {
    const { player, terrain } = window.syn3h
    const p = player.body.translation(), v = player.body.linvel(), q = player.body.rotation()
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const n = { x: terrain.heightAt(p.x - 1, p.z) - terrain.heightAt(p.x + 1, p.z), y: 2, z: terrain.heightAt(p.x, p.z - 1) - terrain.heightAt(p.x, p.z + 1) }
    const nl = Math.hypot(n.x, n.y, n.z)
    const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) }
    const w = player.body.angvel()
    return {
      outsidePatch: window.__ramOutside, teleports: window.__ramTeleports, wrapSize: terrain.wrapSize ?? 0,
      position: { ...p }, velocity: { ...v }, forward: { x: fx, z: fz },
      terrainNormal: { x: n.x / nl, y: n.y / nl, z: n.z / nl },
      terrainAlignment: (up.x * n.x + up.y * n.y + up.z * n.z) / nl,
      angularSpeed: Math.hypot(w.x, w.y, w.z),
      t: Date.now(), inverted: player.isInverted, ride: +(p.y - terrain.heightAt(p.x, p.z)).toFixed(2), speed: +Math.hypot(v.x, v.z).toFixed(1),
      compress: +Math.max(...player.hitCompress).toFixed(2), wheels: player.wheelsGrounded, upY: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2),
    }
  })

  const kind = await a.evaluate(() => window.syn3h.player.kind)
  console.log(`vehicle ${kind}, runway height range ${runway.range.toFixed(2)} m`)
  const speeds = (process.env.SPEEDS ?? '10,20,30').split(',').map(Number)
  const reps = Number(process.env.REPS ?? 2)
  for (const speed of speeds) for (const side of [false, true]) for (let rep = 0; rep < reps; rep++) {
    await cruise(0)
    const gap = flatPatch ? 15 : speed > 22 ? 115 : 50
    await place(a, 0, 0); await b.evaluate(() => { window.syn3h.game.input.external.y = 0 }); await place(b, gap, side ? Math.PI / 2 : 0)
    const startCounts = await Promise.all([a, b].map(page => page.evaluate(() => {
      window.__ramOutside = false; window.__ramMonitoring = true
      return window.__ramTeleports
    })))
    if (process.env.TRACE_SETUP === '1') {
      for (let sample = 0; sample < 15; sample++) {
        const clients = await Promise.all([a, b].map(page => page.evaluate(() => {
          const { player, game } = window.syn3h, net = window.syn3hNet
          return { t: Date.now(), position: player.body.translation(), velocity: player.body.linvel(),
            input: { ...game.input.state }, external: { ...game.input.external }, wind: { ...player.wind },
            shoves: net.stats.shoves, rams: net.stats.rams,
            touching: [...net.remotes.entries()].filter(([, r]) => r.touching).map(([id]) => id) }
        })))
        console.log('SETUP', JSON.stringify({ speed, side, sample, clients }))
        if (sample < 14) await wait(250)
      }
    } else await wait(3500)
    if (flatPatch) {
      // Start at the requested collision speed; a long acceleration runway adds no
      // recovery coverage and lets a delayed remote copy escape the collision window.
      await a.waitForFunction(({ gap, targetId }) => {
        const remote = window.syn3hNet.remotes.get(targetId)?.vehicle.body.translation()
        return remote && Math.hypot(remote.x, remote.z + gap, remote.y - 1000.7) < 2
      }, { gap, targetId }, { timeout: 20000 }).catch(async error => {
        const snapshots = await Promise.all([a, b].map(page => page.evaluate(() => ({
          local: window.syn3h.player.body.translation(),
          remotes: [...window.syn3hNet.remotes.entries()].map(([id, remote]) => ({ id, position: remote.vehicle.body.translation(), responding: remote.responding })),
        }))))
        console.error('REMOTE PLACEMENT FAILED', JSON.stringify({ speed, side, gap, snapshots }))
        throw error
      })
    }
    const before = await a.evaluate(({ speed, flatPatch }) => {
      const before = window.syn3hNet.stats.rams
      if (flatPatch) window.syn3h.player.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
      return before
    }, { speed, flatPatch })
    await cruise(speed, gap)
    let impact = 0
    const deadline = Date.now() + 20000
    let rammed = false
    while (Date.now() < deadline && !rammed) {
      const s = await state()
      impact = Math.max(impact, s.speed)
      rammed = await a.evaluate((n) => window.syn3hNet.stats.rams > n, before)
      if (!rammed) await wait(30)
    }
    await cruise(0)
    // Wait for A to come to rest upright, sampling the flag every 100 ms.
    let invertedMs = 0
    let settledMs = null
    let last = await state()
    const t0 = Date.now()
    let sampledAt = t0
    while (Date.now() - t0 < 12000) {
      last = await state()
      if (last.inverted) invertedMs += last.t - sampledAt
      sampledAt = last.t
      // Upright on its wheels counts, moving or not: after a gentle ram A may coast on.
      if (last.upY > 0.9 && last.wheels >= 3 && Date.now() - t0 > 1000) { settledMs = Date.now() - t0; break }
      await wait(100)
    }
    const go = async (y, ms) => {
      const before = await state()
      // Keep a fixed projection axis; this measures commanded motion, not causal engine force.
      const f = before.forward, length = Math.hypot(f.x, f.z) || 1
      const project = v => y * (v.x * f.x + v.z * f.z) / length
      const initialSpeed = project(before.velocity)
      await a.evaluate((y) => { window.syn3h.game.input.external.y = y }, y)
      let peakCommandedSpeed = initialSpeed
      for (const end = Date.now() + ms; Date.now() < end; await wait(100)) {
        peakCommandedSpeed = Math.max(peakCommandedSpeed, project((await state()).velocity))
      }
      await a.evaluate(() => { window.syn3h.game.input.external.y = 0 })
      const after = await state()
      const delta = (a, b) => {
        const size = before.wrapSize
        const d = b - a
        return size > 0 ? d - Math.round(d / size) * size : d
      }
      const displacement = project({ x: delta(before.position.x, after.position.x), z: delta(before.position.z, after.position.z) })
      const teleported = after.teleports !== before.teleports
      const gainedSpeed = peakCommandedSpeed - initialSpeed
      return { initialSpeed, peakCommandedSpeed, gainedSpeed, displacement, teleported,
        // Conservative response evidence: motion in the commanded direction and a speed gain.
        responsive: !teleported && displacement >= 2 && peakCommandedSpeed >= 2 && gainedSpeed >= 2 }
    }
    const forward = await go(1, 3000)
    const reverse = await go(-1, 6000)
    const end = await state()
    const mobilityOk = (forward.responsive || reverse.responsive) && !end.inverted
    const settlingOk = settledMs !== null
    const fixture = await Promise.all([a, b].map(page => page.evaluate(() => ({ teleports: window.__ramTeleports, outside: window.__ramOutside }))))
    const recoveredByTeleport = fixture.some((f, i) => f.teleports !== startCounts[i])
    const outsidePatch = flatPatch && fixture.some(f => f.outside)
    const valid = !recoveredByTeleport && !outsidePatch
    const ok = !rammed || (valid && settlingOk && mobilityOk)
    if (!ok) failed++
    if (!rammed) missed++
    const row = { speed, side: side ? 'side' : 'head', rammed, impact, settledMs, invertedMs, atRest: last, endState: end, mobilityOk, settlingOk, valid, recoveredByTeleport, outsidePatch, forward, reverse, invertedAfterDriving: end.inverted, ok }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
  console.log(`errors ${JSON.stringify(errors.slice(0, 5))}`)
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy?.kill()
}
const hits = rows.length - missed
// Settling and drive-away are separate criteria; report the failing check accurately.
const bad = failed > 0 || hits === 0 || missed > 0 || errors.length > 0
console.log(`${bad ? 'RAM REPRO FAILED' : 'RAM REPRO OK'}: ${hits} rams, ${missed} misses, ${failed} settling/drive-away failures, ${errors.length} page errors`)
// Zero actual contacts or renderer errors cannot establish a passing ram regression.
process.exit(bad ? 1 : 0)
