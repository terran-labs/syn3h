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
 * flag, ride height and wheel compression, and A tries to drive: forward for 1.5 s, then in
 * reverse for 2 s, in place, with no teleport first. Reverse matters: after a gentle ram A
 * rests against B, and forward only pushes into it.
 *
 * A ram fails if A never ends up upright, cannot reach 2 m/s in either direction, or
 * still has the flag set after driving. Exit 1 on any failure. A run where A missed B is
 * reported as a miss, not a failure.
 *
 *   PORT=8791 npm run server
 *   MIRA_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/ram-inverted-repro.mjs
 *
 * Each player gets its own browser process: two pages in one headless Chrome starve each
 * other's frame loop.
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = spawn('npx', ['tsx', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791'], { stdio: 'ignore' })
let finished = false
proxy.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(2500)
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const browsers = []
const errors = []
const room = `ram${Date.now() % 100000}`
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`http://localhost:5183/?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.mira?.shell && window.miraNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => { window.mira.shell.play(); window.mira.params.set('gfx.level', 0) })
  return page
}

let failed = 0
let missed = 0
const rows = []
try {
  const a = await open('A')
  const b = await open('B')
  await a.waitForFunction(() => window.miraNet.remotes.size === 1, null, { timeout: 20000 })
  // The flattest dry 125 m line near the origin: 30 m/s needs a long run up.
  const runway = await a.evaluate(() => {
    const t = window.mira.terrain
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
    const { terrain, player } = window.mira
    const f = [-Math.sin(runway.h), -Math.cos(runway.h)]
    const x = runway.ox + f[0] * s, z = runway.oz + f[1] * s
    player.teleport(player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z), runway.h + heading)
  }, { runway, s, heading })
  /** Hold A at `target` m/s, steering at the point `s` metres down the runway (0 lets go). */
  const cruise = (target, s = 0) => a.evaluate(({ target, s, runway }) => {
    clearInterval(window.__cruise)
    const e = window.mira.game.input.external
    e.y = 0; e.x = 0
    if (!target) return
    const bx = runway.ox - Math.sin(runway.h) * s, bz = runway.oz - Math.cos(runway.h) * s
    window.__cruise = setInterval(() => {
      const body = window.mira.player.body
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
    const { player, terrain } = window.mira
    const p = player.body.translation(), v = player.body.linvel(), q = player.body.rotation()
    return {
      t: Date.now(), inverted: player.isInverted, ride: +(p.y - terrain.heightAt(p.x, p.z)).toFixed(2), speed: +Math.hypot(v.x, v.z).toFixed(1),
      compress: +Math.max(...player.hitCompress).toFixed(2), wheels: player.wheelsGrounded, upY: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2),
    }
  })

  const kind = await a.evaluate(() => window.mira.player.kind)
  console.log(`vehicle ${kind}, runway height range ${runway.range.toFixed(2)} m`)
  const speeds = (process.env.SPEEDS ?? '10,20,30').split(',').map(Number)
  const reps = Number(process.env.REPS ?? 2)
  for (const speed of speeds) for (const side of [false, true]) for (let rep = 0; rep < reps; rep++) {
    await cruise(0)
    const gap = speed > 22 ? 115 : 50
    await place(a, 0, 0); await b.evaluate(() => { window.mira.game.input.external.y = 0 }); await place(b, gap, side ? Math.PI / 2 : 0)
    await wait(3500)
    const rest = await state()
    const before = await a.evaluate(() => window.miraNet.stats.rams)
    await cruise(speed, gap)
    let impact = 0
    const deadline = Date.now() + 20000
    let rammed = false
    while (Date.now() < deadline && !rammed) {
      const s = await state()
      impact = Math.max(impact, s.speed)
      rammed = await a.evaluate((n) => window.miraNet.stats.rams > n, before)
      if (!rammed) await wait(30)
    }
    await cruise(0)
    // Wait for A to come to rest upright, sampling the flag every 100 ms.
    let invertedMs = 0
    let settledMs = null
    let last = await state()
    const t0 = Date.now()
    while (Date.now() - t0 < 12000) {
      last = await state()
      if (last.inverted) invertedMs += 100
      // Upright on its wheels counts, moving or not: after a gentle ram A may coast on.
      if (last.upY > 0.9 && last.wheels >= 3 && Date.now() - t0 > 1000) { settledMs = Date.now() - t0; break }
      await wait(100)
    }
    const go = async (y, ms) => {
      await a.evaluate((y) => { window.mira.game.input.external.y = y }, y)
      let top = 0
      for (const end = Date.now() + ms; Date.now() < end; await wait(100)) top = Math.max(top, (await state()).speed)
      await a.evaluate(() => { window.mira.game.input.external.y = 0 })
      return top
    }
    const forward = await go(1, 1500)
    const reverse = await go(-1, 2000)
    const end = await state()
    const ok = !rammed || (settledMs !== null && Math.max(forward, reverse) >= 2 && !end.inverted)
    if (!ok) failed++
    if (!rammed) missed++
    const row = { speed, side: side ? 'side' : 'head', rammed, impact, settledMs, invertedMs, atRest: { inverted: last.inverted, ride: last.ride, compress: last.compress, wheels: last.wheels, upY: last.upY }, forward, reverse, invertedAfterDriving: end.inverted, ok }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
  console.log(`errors ${JSON.stringify(errors.slice(0, 5))}`)
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
const hits = rows.length - missed
console.log(failed ? `RAM REPRO FAILED: after ${failed} of ${hits} rams the buggy could not drive away` : `RAM REPRO OK: ${hits} rams (${missed} misses), the buggy drove away after every one`)
process.exit(failed ? 1 : 0)
