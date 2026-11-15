/**
 * How deep does a fast remote vehicle sink into the ground on another player's screen?
 * Player A drives flat out up the steepest nearby ground for 25 s, weaving; player B records, for its
 * copy of A, the height of the copy's body above B's terrain at that spot, every 10 ms. It
 * does this twice: once with the ground clamp in src/net/RemotePlayer.ts switched off on B,
 * once with it on, through 150 ms of latency with jitter, 2% loss and a 0.6 s stall every
 * 4 s: a copy runs into a slope when it has to carry on without fresh states. Prints the lowest the copy went and how long it spent under the
 * surface, beside the real vehicle's own lowest clearance.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/ground-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791', '--rtt', '150', '--jitter', '30', '--loss', '0.02', '--stall', '600', '--stall-every', '4'], { stdio: 'ignore' })
let finished = false
proxy.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(3000)
const room = `ground${Date.now() % 100000}`
const browsers = []
const errors = []
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`http://localhost:5183/?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 90000 })
  await page.evaluate(() => { window.syn3h.shell.play(); window.syn3h.params.set('gfx.level', 0) })
  return page
}
const round = (n, d = 2) => +n.toFixed(d)
let ok = false
try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 })))
  const idA = await a.evaluate(() => window.syn3hNet.id)
  const original = await b.evaluate(() => { window.__groundAt = window.syn3hNet.groundAt; return typeof window.__groundAt })

  async function run(clamp) {
    await b.evaluate((clamp) => { window.syn3hNet.groundAt = clamp ? window.__groundAt : null }, clamp)
    // Start at the foot of the steepest dry ground within 400 m, facing up it: a copy that
    // carries on in a straight line during a gap then runs into the slope.
    await a.evaluate(() => {
      const { terrain: t, player } = window.syn3h
      let best = null
      for (let r = 120; r <= 400; r += 40) for (let k = 0; k < 24; k++) {
        const x = Math.cos(k / 24 * Math.PI * 2) * r, z = Math.sin(k / 24 * Math.PI * 2) * r
        const gx = (t.heightAt(x + 15, z) - t.heightAt(x - 15, z)) / 30, gz = (t.heightAt(x, z + 15) - t.heightAt(x, z - 15)) / 30
        const g = Math.hypot(gx, gz)
        if ((t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z) - 1 || g > 0.6) continue
        if (!best || g > best.g) best = { x, z, g, gx, gz }
      }
      window.__start = best
      // Forward at heading h is (-sin h, -cos h): face up the gradient.
      const h = Math.atan2(-best.gx, -best.gz)
      player.teleport(player.object.position.clone().set(best.x, t.heightAt(best.x, best.z) + 1.2, best.z), h)
    })
    await wait(3000)
    await b.evaluate((id) => {
      window.__log = []
      clearInterval(window.__timer)
      window.__timer = setInterval(() => {
        const r = window.syn3hNet.remotes.get(id)
        if (!r) return
        const p = r.vehicle.body.translation()
        window.__log.push({ above: p.y - window.syn3h.terrain.heightAt(p.x, p.z), mode: r.sample.mode, physical: r.physical })
      }, 10)
    }, idA)
    await a.evaluate(() => {
      window.__own = []
      clearInterval(window.__timer)
      const e = window.syn3h.game.input.external
      let t = 0
      window.__timer = setInterval(() => {
        t += 0.02
        e.y = 1
        e.x = Math.sin(t * 0.9) * 0.35 // a weave, so it crosses slopes and crests
        const p = window.syn3h.player.body.translation(), v = window.syn3h.player.body.linvel()
        window.__own.push({ above: p.y - window.syn3h.terrain.heightAt(p.x, p.z), speed: Math.hypot(v.x, v.z) })
      }, 20)
    })
    await wait(25000)
    const own = await a.evaluate(() => { clearInterval(window.__timer); const e = window.syn3h.game.input.external; e.y = 0; e.x = 0; return window.__own })
    const log = await b.evaluate(() => { clearInterval(window.__timer); return window.__log })
    const under = log.filter((e) => e.above < 0)
    return {
      clamp,
      copyLowestAboveGroundM: round(Math.min(...log.map((e) => e.above))),
      copyUnderTheSurfaceMs: under.length * 10,
      copyDeeperThanHalfAMetreMs: log.filter((e) => e.above < -0.5).length * 10,
      samples: log.length,
      extrapolatedPct: round(100 * log.filter((e) => e.mode === 'extrapolate').length / log.length, 1),
      realLowestAboveGroundM: round(Math.min(...own.map((e) => e.above))),
      realTopSpeed: round(Math.max(...own.map((e) => e.speed)), 1),
      slope: round((await a.evaluate(() => window.__start.g))),
    }
  }
  const off = await run(false)
  console.log(JSON.stringify(off))
  const on = await run(true)
  console.log(JSON.stringify(on))
  ok = original === 'function' && on.copyDeeperThanHalfAMetreMs === 0 && errors.length === 0
  console.log(`errors ${JSON.stringify(errors)}`)
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
console.log(ok ? 'GROUND CHECK OK' : 'GROUND CHECK FAILED')
process.exit(ok ? 0 : 1)
