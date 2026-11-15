/**
 * Checks that players find each other again after the connection drops. Two players join a
 * room through server/latency-proxy.ts; the proxy is stopped (both sockets die at once, as
 * when venue wifi blinks), then started again. Passes when both clients notice, reconnect by
 * themselves, the room holds exactly two players again (no leftovers from before), and one
 * sees the other drive.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/reconnect-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// Run the proxy as a direct child (no npx in between), so stopping it stops the listener.
const startProxy = () => spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791', '--rtt', '40'], { stdio: 'ignore' })
let proxy = startProxy()
await wait(3000)
const browsers = []
const errors = []
const room = `rejoin${Date.now() % 100000}`
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`http://localhost:5183/?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => { window.syn3h.shell.play(); window.syn3h.params.set('gfx.level', 0) })
  return page
}
const view = (page) => page.evaluate(() => {
  const n = window.syn3hNet
  return { connected: n.connected, id: n.id, players: [...n.players.values()].map((p) => p.name).sort(), remotes: n.remotes.size, net: document.getElementById('hud')?.textContent.match(/net:[^\n]*/)?.[0] ?? null }
})
const results = []
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }

try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 })))
  const before = [await view(a), await view(b)]
  check('both joined and see each other', before.every((v) => v.connected && v.players.length === 2), before)
  const posBefore = await a.evaluate(() => { const p = window.syn3h.player.body.translation(); return [p.x, p.z] })

  proxy.kill()
  await wait(3000)
  const during = [await view(a), await view(b)]
  check('both notice the connection is gone', during.every((v) => !v.connected && /offline|connecting/.test(v.net ?? '')), during)

  proxy = startProxy()
  const t0 = Date.now()
  const back = await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.connected && window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 }).then(() => true, () => false)))
  const after = [await view(a), await view(b)]
  check('both reconnect by themselves and the room has exactly two players', back.every(Boolean) && after.every((v) => v.players.length === 2 && v.remotes === 1), { seconds: +((Date.now() - t0) / 1000).toFixed(1), after })
  const posAfter = await a.evaluate(() => { const p = window.syn3h.player.body.translation(); return [p.x, p.z] })
  check('a reconnecting player stays where it was', Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]) < 3, { posBefore, posAfter })

  const idA = after[0].id
  const copy = () => b.evaluate((id) => { const t = window.syn3hNet.remotes.get(id)?.vehicle.body.translation(); return t ? [t.x, t.z] : null }, idA)
  const c0 = await copy()
  await a.evaluate(() => { window.syn3h.game.input.external.y = 1 })
  await wait(3000)
  await a.evaluate(() => { window.syn3h.game.input.external.y = 0 })
  const c1 = await copy()
  check('after reconnecting, one sees the other drive', c0 && c1 && Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 3, { c0, c1 })
  check('no page errors', errors.length === 0, errors)
} finally {
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
const ok = results.length >= 6 && results.every(Boolean)
console.log(ok ? 'RECONNECT CHECK OK' : 'RECONNECT CHECK FAILED')
process.exit(ok ? 0 : 1)
