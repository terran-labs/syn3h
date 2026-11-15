/**
 * Checks that joining a room stored by an older build gives everyone the same world.
 *
 * A plain socket client first creates a room the way an older build would have: its world
 * has a seed but lacks terrain.kind, world.seaKind and terrain.treeCover. Two browsers then
 * join with different planets and seeds in their URLs. Before the fix each kept its own
 * values for the missing settings and built a different island (alpine colours on volcanic
 * terrain). Passes when both end on the room's seed, the defaults for the three missing
 * settings, and identical world values.
 *
 *   PORT=8791 npm run server
 *   SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://localhost:8794 npx vite --port 5183 --strictPort
 *   node tools/stale-room-check.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import WebSocket from 'ws'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const version = Number(readFileSync('shared/protocol.ts', 'utf8').match(/export const PROTOCOL_VERSION = (\d+)/)[1])
const room = `stale${Date.now() % 100000}`
const proxy = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/latency-proxy.ts', '--listen', '8794', '--target', 'http://127.0.0.1:8791', '--rtt', '0'], { stdio: 'ignore' })
let finished = false
proxy.on('exit', (code) => { if (!finished) { console.error(`latency proxy exited early (code ${code}); is port 8794 in use?`); process.exit(3) } })
await wait(3000)

// The "older build": first into the room, so the room takes its world, which has no kind.
const old = new WebSocket(`ws://127.0.0.1:8791/ws?room=${room}`)
await new Promise((resolve, reject) => { old.once('open', resolve); old.once('error', reject) })
const welcome = new Promise((resolve) => old.on('message', (data, binary) => { if (!binary) { const m = JSON.parse(String(data)); if (m.type === 'welcome') resolve(m) } }))
old.send(JSON.stringify({ type: 'hello', v: version, name: 'OldBuild', params: { 'world.seed': 1, 'world.gravity': 9.81 } }))
const stored = (await welcome).params
const missing = ['terrain.kind', 'world.seaKind', 'terrain.treeCover'].filter((id) => !(id in stored))
console.log(`room ${room} stored by the old client: seed ${stored['world.seed']}, lacks ${JSON.stringify(missing)}`)

const browsers = []
async function join(name, query) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  await page.goto(`http://localhost:5183/?room=${room}&name=${name}&autoplay=1&${query}`)
  await page.waitForFunction(() => window.syn3h?.shell && window.syn3hNet?.connected, null, { timeout: 60000 })
  return page
}
/** A page's world, read once everything has settled. */
const worldOf = (page) => page.evaluate(() => {
    const get = (id) => window.syn3h.params.get(id)?.value
    return {
      seed: get('world.seed'), kind: get('terrain.kind'), seaKind: get('world.seaKind'), treeCover: get('terrain.treeCover'),
      encoded: window.syn3h.planets.encodeWorld?.() ?? null,
      world: Object.fromEntries(Object.entries(window.syn3h.params.snapshot('world')).sort()),
    }
  })

let ok = false
try {
  const pageA = await join('Alpine', 'planet=alpine&seed=7')
  const pageB = await join('Desert', 'planet=desert&seed=99')
  // Both read at the same moment, after the terrain has regenerated and any late parameter
  // messages have crossed.
  await wait(6000)
  const [a, b] = await Promise.all([worldOf(pageA), worldOf(pageB)])
  const show = ({ world, ...rest }) => rest
  const differing = Object.keys(a.world).filter((id) => a.world[id] !== b.world[id]).map((id) => `${id}: ${a.world[id]} vs ${b.world[id]}`)
  console.log('joiner with ?planet=alpine&seed=7 ', JSON.stringify(show(a)))
  console.log('joiner with ?planet=desert&seed=99', JSON.stringify(show(b)))
  const defaults = (v) => v.seed === 1 && v.kind === 0 && v.seaKind === 0 && v.treeCover === 0.5
  ok = missing.length === 3 && defaults(a) && defaults(b) && differing.length === 0
  console.log(differing.length ? `world values that differ: ${JSON.stringify(differing)}` : 'same world values on both')
} finally {
  finished = true
  await Promise.all(browsers.map((b) => b.close()))
  old.close()
  proxy.kill()
}
console.log(ok ? 'STALE ROOM CHECK OK' : 'STALE ROOM CHECK FAILED')
process.exit(ok ? 0 : 1)
