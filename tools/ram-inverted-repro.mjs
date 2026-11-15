/**
 * Reproduces a buggy left unable to drive after a ram. Player A rams a parked player B at
 * about 20 m/s; afterwards A's `isInverted` stays true although A is upright, so its
 * suspension and tyre load are off and it sits on its skid plate. A teleport does not help.
 * Prints A's state before the ram, after it, after a teleport, and while trying to drive.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/ram-inverted-repro.mjs
 *
 * Healthy: wheelsGrounded 4, isInverted false, y about 0.69 above the ground, and "driving A"
 * shows a speed. Broken: isInverted true, hitCompress about 0.79, y 0.09 above the ground,
 * velocity 0 with input 1.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = spawn('npx', ['tsx', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791'], { stdio: 'ignore' })
await wait(2500)
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const browsers = []
const errors = []
const room = `scr${Date.now() % 10000}`
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args }); browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message} ${String(e.stack).split('\n').slice(0, 4).join(' | ')}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name} console: ${m.text().slice(0, 200)}`) })
  await page.goto(`http://localhost:5183/?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => { window.syn3h.shell.play(); window.syn3h.params.set('gfx.level', 0) })
  return page
}
try {
  const a = await open('A'); const b = await open('B')
  await a.waitForFunction(() => window.syn3hNet.remotes.size === 1, null, { timeout: 20000 })
  const diag = (page) => page.evaluate(async () => {
    const { player, terrain, game } = window.syn3h
    const snap = () => { const p = player.body.translation(), v = player.body.linvel(); return { tick: game.tick, y: +p.y.toFixed(2), g: +terrain.heightAt(p.x, p.z).toFixed(2), v: [v.x, v.y, v.z].map((n) => +n.toFixed(2)) } }
    const s0 = snap(); await new Promise((r) => setTimeout(r, 500)); const s1 = snap()
    const nums = {}
    for (const [k, v] of Object.entries(player)) {
      if (typeof v === 'number') nums[k] = +v.toFixed(3)
      else if (Array.isArray(v) && v.every((n) => typeof n === 'number')) nums[k] = v.map((n) => +n.toFixed(3))
      else if (typeof v === 'boolean' || typeof v === 'string') nums[k] = v
    }
    return { nums, s0, s1, enabled: player.body.isEnabled?.(), grav: player.body.gravityScale?.(), type: player.body.bodyType(), inWorld: game.world.getRigidBody(player.body.handle) === player.body, bodies: game.world.bodies.len(), input: player.input.y, polled: game.input.state.y, vis: document.visibilityState }
  })
  const tp = (page, x, z) => page.evaluate(([x, z]) => { const { player, terrain } = window.syn3h; player.teleport(player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z), 0) }, [x, z])
  const drive = (page, y) => page.evaluate((y) => { window.syn3h.game.input.external.y = y }, y)
  const s = await a.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0).position; return [s.x, s.z] })
  await tp(a, s[0], s[1]); await tp(b, s[0], s[1] - 25); await wait(3500)
  console.log('before A', JSON.stringify(await diag(a)))
  await drive(a, 1)
  await a.waitForFunction(() => window.syn3hNet.stats.rams > 0, null, { timeout: 9000 }).catch(() => console.log('no ram'))
  await drive(a, 0); await wait(2500)
  console.log('after ram A', JSON.stringify(await diag(a)))
  console.log('after ram B', JSON.stringify(await diag(b)))
  await tp(a, s[0], s[1]); await wait(1200)
  console.log('after tp A', JSON.stringify(await diag(a)))
  await drive(a, 1); await wait(700)
  console.log('driving A', JSON.stringify(await diag(a)))
  console.log('errors', JSON.stringify(errors.slice(0, 12)), errors.length)
} finally { await Promise.all(browsers.map((b) => b.close())); proxy.kill() }
