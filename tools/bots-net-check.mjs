/**
 * Bots across the network, in two browsers: the host (Alice) runs the bots, the guest (Bob)
 * sees copies of them.
 *
 *  1. Mixed fleet: with `bots.fleet` 1 and four bots, the guest's copy of each bot is the
 *     same kind of vehicle the host is driving it as.
 *  2. Fleet switched back to buggies: the guest's copies change with it.
 *  3. The match: the host's bot manager is told who is "it" in tag (a vehicle, not an id),
 *     again when "it" changes, and where to hold the hill in King of the Hill: a point on
 *     the zone's ring, not the lake in its middle. The guest's manager is told nothing.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/bots-net-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const base = process.env.BOTS_TEST_URL ?? 'http://localhost:5183/'
const proxyPort = process.env.BOTS_PROXY_PORT ?? '8794'
const roomPort = process.env.BOTS_ROOM_PORT ?? '8791'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const proxy = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', proxyPort, '--target', `http://127.0.0.1:${roomPort}`, '--rtt', '40'], { stdio: 'ignore' })
let finished = false
proxy.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(3000)
const room = `bots${Date.now() % 100000}`
const browsers = []
const errors = []
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 800, height: 450 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1&daydream=0`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 90000 })
  // No lowering of the graphics level here: the lowest level caps how many bots a client runs.
  await page.evaluate(() => { window.syn3h.params.set('gfx.auto', false); window.syn3h.params.set('gfx.level', 2); window.syn3h.shell.play() })
  return page
}
const results = []
const check = (name, ok, detail) => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }
const hostKinds = (page) => page.evaluate(() => window.syn3h.bots.vehicles.map((v) => v.kind))
const guestKinds = (page) => page.evaluate(() => [...window.syn3hNet.remotes].filter(([id]) => id >= 0xff00).sort((x, y) => x[0] - y[0]).map(([, r]) => r.vehicle.kind))
const matchOf = (page) => page.evaluate(() => {
  const m = window.syn3h.bots.match
  if (!m) return null
  const { player, bots } = window.syn3h
  const who = m.it === player ? 'the host player' : m.it && bots.vehicles.includes(m.it) ? 'a host bot' : m.it ? `a remote copy (${m.it.name})` : null
  return { mode: m.mode, it: who, zone: m.zone ?? null }
})

try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet.players.size === 2 && window.syn3hNet.remotes.size === 1, null, { timeout: 30000 })))
  const [idA, idB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3hNet.id)))
  check('Alice hosts', await a.evaluate(() => window.syn3hNet.isHost) && !(await b.evaluate(() => window.syn3hNet.isHost)), { idA, idB })

  // 1. A mixed fleet of four.
  await a.evaluate(() => { const p = window.syn3h.params; p.set('bots.canDrive', false); p.set('bots.fleet', 1); p.set('bots.count', 4) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 4, null, { timeout: 30000 }).catch(() => {})
  console.log('host bots', JSON.stringify(await a.evaluate(() => ({ n: window.syn3h.bots.vehicles.length, count: window.syn3h.params.get('bots.count').value, fleet: window.syn3h.params.get('bots.fleet')?.value, gfx: window.syn3h.params.get('gfx.level').value }))))
  await b.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter((id) => id >= 0xff00).length === 4, null, { timeout: 20000 }).catch(() => {})
  await wait(1500)
  const mixed = { host: await hostKinds(a), guest: await guestKinds(b) }
  check('1. the guest sees each bot of a mixed fleet as the vehicle the host drives', mixed.host.length === 4 && new Set(mixed.host).size > 1 && JSON.stringify(mixed.host) === JSON.stringify(mixed.guest), mixed)
  await b.screenshot({ path: '/tmp/syn3h-bots-fleet.png' })

  // 2. The same bot slots come back as buggies (the fleet is chosen when bots are made, so
  // remove them, switch, and add them again): the guest's copies must change kind too.
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await b.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter((id) => id >= 0xff00).length === 0, null, { timeout: 20000 }).catch(() => {})
  await a.evaluate(() => { window.syn3h.params.set('bots.fleet', 0); window.syn3h.params.set('bots.count', 4) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 4, null, { timeout: 30000 }).catch(() => {})
  await b.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter((id) => id >= 0xff00).length === 4, null, { timeout: 20000 }).catch(() => {})
  await wait(1500)
  const plain = { host: await hostKinds(a), guest: await guestKinds(b) }
  check('2. the same slots remade as buggies are buggies for the guest too', plain.host.length === 4 && new Set(plain.host).size === 1 && JSON.stringify(plain.host) === JSON.stringify(plain.guest), plain)

  // 3. The match.
  const tag1 = { host: await matchOf(a), guest: await matchOf(b), it: await a.evaluate(() => window.syn3hNet.game.it) }
  check('3. tag: the host\'s bots are told which vehicle is "it"; the guest\'s are told nothing', tag1.host?.mode === 'tag' && tag1.host.it === (tag1.it === idA ? 'the host player' : tag1.host.it) && tag1.host.it !== null && tag1.guest === null, tag1)
  // Exercise a real contact, including fresh replicated positions and the room cooldown.
  // A synthetic ram beside the spawn can be rejected when the sloping pad separates cars.
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 0)
  await wait(3500)
  const itBefore = await a.evaluate(() => window.syn3hNet.game.it)
  await a.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0); window.syn3h.player.teleport(s.position, 0) })
  await b.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0), { terrain, player } = window.syn3h
    s.position.z -= 7
    s.position.y = terrain.heightAt(s.position.x, s.position.z) + 1.5
    player.teleport(s.position, 0)
  })
  await wait(1500)
  await a.bringToFront()
  await a.keyboard.down('KeyW')
  await a.waitForFunction((it) => window.syn3hNet.game.it !== it, itBefore, { timeout: 12000 }).catch(() => {})
  await a.keyboard.up('KeyW')
  const tag2 = { host: await matchOf(a), it: await a.evaluate(() => window.syn3hNet.game.it) }
  check('3. tag: told again when "it" changes hands', tag2.it !== itBefore && tag2.host?.mode === 'tag' && tag2.host.it !== tag1.host?.it, { before: tag1.host, after: tag2 })

  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  await a.waitForFunction(() => window.syn3h.bots.match?.mode === 'hill' && window.syn3h.bots.match.zone, null, { timeout: 15000 }).catch(() => {})
  const hill = await a.evaluate(() => {
    const m = window.syn3h.bots.match, z = window.syn3hNet.game.koth.zone, t = window.syn3h.terrain
    if (!m?.zone || !z) return { match: m ? { mode: m.mode, zone: m.zone ?? null } : null, zone: z }
    const d = Math.hypot(m.zone.x - z.x, m.zone.z - z.z)
    const ground = t.heightAt(m.zone.x, m.zone.z), liquid = t.liquidHeightAt?.(m.zone.x, m.zone.z) ?? -Infinity
    return { match: { mode: m.mode, zone: m.zone }, ring: [z.inner, z.outer], holdDistanceFromCentre: +d.toFixed(1), insideRing: d - m.zone.radius >= z.inner - 0.01 && d + m.zone.radius <= z.outer + 0.01, dry: ground > liquid }
  })
  check('3. hill: the host\'s bots are told to hold a dry point on the ring', hill.match?.mode === 'hill' && hill.insideRing && hill.dry, hill)
  await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
  await a.waitForFunction(() => window.syn3h.bots.match?.mode === 'tag', null, { timeout: 10000 }).catch(() => {})
  check('3. back to tag when the mode changes back', (await matchOf(a))?.mode === 'tag', await matchOf(a))
  // Graphics caps apply to a mixed fleet, including after the guest takes over hosting.
  await a.evaluate(() => { const p = window.syn3h.params; p.set('bots.fleet', 1); p.set('bots.count', 8); p.set('gfx.level', 0) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 2)
  await b.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter(id => id >= 0xff00).length === 2)
  check('4. safe graphics caps the mixed fleet at two', (await hostKinds(a)).length === 2, await hostKinds(a))
  await a.evaluate(() => { window.syn3h.params.set('gfx.level', 1); window.syn3h.params.set('bots.count', 4) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 4)
  await b.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter(id => id >= 0xff00).length === 4)
  await a.close()
  await b.waitForFunction(() => window.syn3hNet.isHost && !window.syn3h.bots.remote && window.syn3h.bots.vehicles.length === 4, null, { timeout: 20000 })
  const c = await open('Charlie')
  await c.waitForFunction(() => [...window.syn3hNet.remotes.keys()].filter(id => id >= 0xff00).length === 4, null, { timeout: 20000 })
  const takeover = { host: await hostKinds(b), guest: await guestKinds(c) }
  check('5. host takeover preserves mixed types for a new guest', new Set(takeover.host).size === 3 && JSON.stringify(takeover.host) === JSON.stringify(takeover.guest), takeover)
  check('no page errors', errors.length === 0, errors)
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  proxy.kill()
}
const ok = results.length >= 8 && results.every(Boolean)
console.log(ok ? 'BOTS NET CHECK OK, screenshot /tmp/syn3h-bots-fleet.png' : 'BOTS NET CHECK FAILED')
process.exit(ok ? 0 : 1)
