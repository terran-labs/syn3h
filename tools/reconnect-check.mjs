/**
 * Checks that players find each other again after the connection drops. Two players join a
 * room through server/latency-proxy.ts; the proxy is stopped (both sockets die at once, as
 * when venue wifi blinks), then started again. Passes when both clients notice, reconnect by
 * themselves, the room holds exactly two players again (no leftovers from before), and one
 * sees the other drive.
 *
 *   PORT=8791 npm run server
 *   MIRA_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/reconnect-check.mjs
 * If using a free proxy port, pass the same port in MIRA_RECONNECT_PROXY_PORT here
 * and in the dev server's VITE_SERVER_URL before starting Vite.
 *   node tools/reconnect-check.mjs --rejoin 8     the soak for `game.rejoin`
 *
 * With --rejoin N the room has `game.rejoin` on and the connection is dropped N times, for 1
 * to 6 seconds each. After every drop both players must be the same players as before: same
 * ids, same host, same slider lock, the same score, and no "left" or "joined" lines on either
 * screen. A last drop of 35 s, longer than the 30 s a place is held, must end the other way:
 * both come back as new players.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const rejoinAt = process.argv.indexOf('--rejoin')
const cycles = rejoinAt >= 0 ? Number(process.argv[rejoinAt + 1] ?? 6) : 0
// Run the proxy as a direct child (no npx in between), so stopping it stops the listener.
const proxyPort = process.env.MIRA_RECONNECT_PROXY_PORT ?? '8794'
const startProxy = () => spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', proxyPort, '--target', 'http://127.0.0.1:8791', '--rtt', '40'], { stdio: 'ignore' })
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
  await page.waitForFunction(() => window.mira?.shell && window.miraNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => { window.mira.shell.play(); window.mira.params.set('gfx.level', 0) })
  return page
}
const view = (page) => page.evaluate(() => {
  const n = window.miraNet
  return {
    connected: n.connected, id: n.id, players: [...n.players.values()].map((p) => p.name).sort(), ids: [...n.players.keys()].sort(), remotes: n.remotes.size,
    host: n.game.host, locked: n.game.locked, scores: n.game.scores, comings: window.__comings ?? 0,
    net: document.getElementById('hud')?.textContent.match(/net:[^\n]*/)?.[0] ?? null,
  }
})
const results = []
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }

try {
  const a = await open('Alice')
  // The two seats in this fixture belong to Alice and Bob.
  await a.evaluate(() => window.mira.params.set('bots.count', 0))
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.miraNet.players.size === 2 && window.miraNet.remotes.size === 1, null, { timeout: 30000 })))
  const before = [await view(a), await view(b)]
  check('both joined and see each other', before.every((v) => v.connected && v.players.length === 2), before)
  const posBefore = await a.evaluate(() => { const p = window.mira.player.body.translation(); return [p.x, p.z] })

  proxy.kill()
  await wait(3000)
  const during = [await view(a), await view(b)]
  check('both notice the connection is gone', during.every((v) => !v.connected && /offline|connecting/.test(v.net ?? '')), during)

  proxy = startProxy()
  const t0 = Date.now()
  const back = await Promise.all([a, b].map((p) => p.waitForFunction(() => window.miraNet.connected && window.miraNet.players.size === 2 && window.miraNet.remotes.size === 1, null, { timeout: 30000 }).then(() => true, () => false)))
  const after = [await view(a), await view(b)]
  check('both reconnect by themselves and the room has exactly two players', back.every(Boolean) && after.every((v) => v.players.length === 2 && v.remotes === 1), { seconds: +((Date.now() - t0) / 1000).toFixed(1), after })
  const posAfter = await a.evaluate(() => { const p = window.mira.player.body.translation(); return [p.x, p.z] })
  check('a reconnecting player stays where it was', Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]) < 3, { posBefore, posAfter })

  const idA = after[0].id
  const copy = () => b.evaluate((id) => { const t = window.miraNet.remotes.get(id)?.vehicle.body.translation(); return t ? [t.x, t.z] : null }, idA)
  const c0 = await copy()
  await a.evaluate(() => { window.mira.game.input.external.y = 1 })
  await wait(3000)
  await a.evaluate(() => { window.mira.game.input.external.y = 0 })
  const c1 = await copy()
  check('after reconnecting, one sees the other drive', c0 && c1 && Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 3, { c0, c1 })
  if (cycles > 0) {
    // The soak. Turn the rule on, lock the sliders and give the host a score to keep.
    // Count every "left" and "joined" line from here on (the event list itself is capped).
    for (const p of [a, b]) await p.evaluate(() => {
      const n = window.miraNet, event = n.event.bind(n)
      window.__comings = 0
      n.event = (text) => { if (/ left$| joined/.test(text)) window.__comings++; event(text) }
    })
    await a.evaluate(() => { window.mira.params.set('game.rejoin', true); window.miraNet.send({ type: 'lock', locked: true }); window.mira.params.set('game.mode', 1) })
    await b.waitForFunction(() => window.mira.params.get('game.rejoin').value === true && window.miraNet.game.locked && window.miraNet.game.koth.zone, null, { timeout: 10000 })
    await a.evaluate(() => {
      const zone = window.miraNet.game.koth.zone, { terrain, player } = window.mira, r = (zone.inner + zone.outer) / 2
      for (let k = 0; k < 64; k++) {
        const x = zone.x + Math.cos(k * 0.1) * r, z = zone.z + Math.sin(k * 0.1) * r, y = terrain.heightAt(x, z)
        if (y < zone.yMin + 1 || y > zone.yMax - 2 || (terrain.liquidHeightAt?.(x, z) ?? -Infinity) > y - 1) continue
        player.teleport(player.object.position.clone().set(x, y + 1.2, z), 0)
        return
      }
    })
    await b.evaluate(() => { const s = window.mira.terrain.spawnPoint(1); window.mira.player.teleport(s.position, s.heading) })
    await a.waitForFunction((id) => (window.miraNet.game.scores[id] ?? 0) >= 3, idA, { timeout: 20000 })
    const start = [await view(a), await view(b)]
    let good = 0
    const rows = []
    for (let i = 0; i < cycles; i++) {
      const down = 1000 + Math.floor(Math.random() * 5000)
      proxy.kill()
      await wait(down)
      proxy = startProxy()
      const t = Date.now()
      const up = await Promise.all([a, b].map((p) => p.waitForFunction(() => window.miraNet.connected && window.miraNet.players.size === 2 && window.miraNet.remotes.size === 1, null, { timeout: 30000 }).then(() => true, () => false)))
      await wait(1500)
      const now = [await view(a), await view(b)]
      const same = up.every(Boolean) && now.every((v, k) => v.id === start[k].id && v.host === start[0].id && v.locked === true && v.comings === start[k].comings && JSON.stringify(v.ids) === JSON.stringify(start[k].ids))
      const kept = (now[1].scores[idA] ?? 0) >= (rows.at(-1)?.hostScore ?? start[1].scores[idA])
      if (same && kept) good++
      rows.push({ downMs: down, backInMs: Date.now() - t - 1500, same, hostScore: now[1].scores[idA] ?? 0, ids: now[0].ids })
    }
    check(`rejoin soak: after each of ${cycles} dropouts both are the same players, host and lock stand, the score only grows, nobody "left"`, good === cycles, rows)

    // Longer than a place is held: they come back as new players, and the room says so.
    proxy.kill()
    await wait(35000)
    proxy = startProxy()
    await Promise.all([a, b].map((p) => p.waitForFunction(() => window.miraNet.connected && window.miraNet.players.size === 2, null, { timeout: 30000 }).catch(() => {})))
    await wait(1500)
    const late = [await view(a), await view(b)]
    check('rejoin soak: a dropout longer than the hold comes back as new players', late.every((v, k) => v.connected && v.id !== start[k].id), { before: start.map((v) => v.id), after: late.map((v) => v.id) })
  }
  check('no page errors', errors.length === 0, errors)
} finally {
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
const ok = results.length >= (cycles > 0 ? 8 : 6) && results.every(Boolean)
console.log(ok ? 'RECONNECT CHECK OK' : 'RECONNECT CHECK FAILED')
process.exit(ok ? 0 : 1)
