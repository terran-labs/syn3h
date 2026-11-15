/**
 * GET /status under the local Cloudflare runtime, including the upgrade from a release that
 * does not have it. Socket players against `wrangler dev --local` with persisted state.
 *
 *   npm run build
 *   node tools/status-runtime-check.mjs <dir of the older release> [dir of this build, default .]
 *
 * The older release is a frozen copy, for example ../Syn3h-stable/20261114-200625-bc8cb48.
 *
 *  1. The older release holds a live room with a changed world, stored. It has no /status.
 *  2. The server is stopped and this build is started on the same stored state.
 *  3. /status answers at once, before any room has reported: nobody.
 *  4. The old room's stored world is still there when its players come back.
 *  5. The counts follow joins and leaves across two rooms, and stay right through 25 s of
 *     silence (rooms asleep) without being woken.
 *  6. tools/production-occupied.mjs agrees: exit 1 while someone is connected, 0 after.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import WebSocket from 'ws'

const older = resolve(process.argv[2] ?? '')
const newer = resolve(process.argv[3] ?? '.')
if (!process.argv[2]) { console.error('Usage: node tools/status-runtime-check.mjs <older release dir> [this build dir]'); process.exit(2) }
const port = 8097
const origin = `http://127.0.0.1:${port}`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const wrangler = `${process.cwd()}/node_modules/wrangler/bin/wrangler.js`
const persist = `/tmp/syn3h-status-runtime-${Date.now()}`
let logs = ''
const start = async (dir) => {
  const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { logs += d })
  child.stderr.on('data', (d) => { logs += d })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${origin}/`)).ok) return child } catch { /* not up yet */ } await wait(500) }
  child.kill(); throw new Error(`wrangler dev did not start in ${dir}`)
}
const stop = async (child) => { child.kill(); await wait(2500) }
const versionOf = (dir) => Number(readFileSync(`${dir}/shared/protocol.ts`, 'utf8').match(/export const PROTOCOL_VERSION = (\d+)/)[1])
function player(room, name, version, params = {}) {
  const p = { welcome: null, params: {}, open: false }
  p.connect = () => new Promise((ok, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}`)
    p.ws = ws
    ws.on('open', () => { p.open = true; ws.send(JSON.stringify({ type: 'hello', v: version, name, params })) })
    ws.on('message', (data, binary) => {
      if (binary) return
      const m = JSON.parse(String(data))
      if (m.type === 'welcome') { p.welcome = m; Object.assign(p.params, m.params); ok(m) }
      if (m.type === 'param') p.params[m.id] = m.value
      if (m.type === 'error') reject(new Error(m.message))
    })
    ws.on('close', () => { p.open = false })
    ws.on('error', reject)
    setTimeout(() => reject(new Error(`${name} got no welcome`)), 15000)
  })
  p.drop = async () => { p.ws.terminate(); await wait(400) }
  return p
}
const status = async () => {
  const res = await fetch(`${origin}/status`)
  const type = res.headers.get('content-type') ?? ''
  return { http: res.status, json: type.includes('application/json') ? await res.json() : null }
}
const occupied = (...extra) => spawnSync(process.execPath, ['tools/production-occupied.mjs', origin, ...extra], { encoding: 'utf8' })
const results = []
const check = (name, ok, detail) => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }

let server = await start(older)
try {
  // 1. The older release, with a live room whose world has been changed and stored.
  const vOld = versionOf(older)
  const a = player('upgrade', 'Alice', vOld, { 'world.gravity': 9.81 })
  const b = player('upgrade', 'Bob', vOld)
  await a.connect(); await b.connect()
  a.ws.send(JSON.stringify({ type: 'param', id: 'world.gravity', value: 15 }))
  await wait(800)
  const before = await status()
  check('1. the older release holds a live room with a stored world, and has no /status', b.params['world.gravity'] === 15 && before.json === null, { gravity: b.params['world.gravity'], ids: [a.welcome.id, b.welcome.id], statusOnOldRelease: before })

  // 2. Upgrade under them: same stored state, this build.
  await stop(server)
  server = await start(newer)
  const vNew = versionOf(newer)

  // 3. /status on a deployment where no room has ever reported.
  const fresh = await status()
  check('3. /status answers before any room has reported: nobody', fresh.http === 200 && fresh.json?.rooms === 0 && fresh.json?.players === 0, fresh)

  // 4. The old room's players come back; they send no world of their own, so what they are
  // given is what was stored. New ids follow the old ones, which also only storage can know.
  const a2 = player('upgrade', 'Alice', vNew)
  const b2 = player('upgrade', 'Bob', vNew)
  await a2.connect(); await b2.connect(); await wait(500)
  check('4. the room stored by the older release kept its world across the upgrade', a2.params['world.gravity'] === 15 && a2.welcome.id > b.welcome.id, { gravity: a2.params['world.gravity'], idsNow: [a2.welcome.id, b2.welcome.id], sameProtocol: vOld === vNew })

  // 5. Counts.
  const s1 = (await status()).json
  const c = player('second-room', 'Carol', vNew)
  await c.connect(); await wait(500)
  const s2 = (await status()).json
  await b2.drop(); await wait(500)
  const s3 = (await status()).json
  check('5. the counts follow joins and leaves across rooms', s1.rooms === 1 && s1.players === 2 && s2.rooms === 2 && s2.players === 3 && s3.rooms === 2 && s3.players === 2, { twoInOneRoom: s1, plusOneInAnother: s2, oneLeft: s3 })
  await wait(25000)
  const quiet = (await status()).json
  check('5. after 25 s of silence the count is unchanged', quiet.rooms === 2 && quiet.players === 2, quiet)

  // 6. The release tool.
  const busy = occupied()
  await a2.drop(); await c.drop(); await wait(800)
  const empty = occupied()
  const s4 = (await status()).json
  check('6. production-occupied.mjs: exit 1 while occupied, 0 when everyone has left', busy.status === 1 && empty.status === 0 && s4.players === 0 && s4.rooms === 0, { occupied: busy.stdout.trim().split('\n'), exitOccupied: busy.status, empty: empty.stdout.trim().split('\n'), exitEmpty: empty.status })

  // Not for players: only GET, and the registry cannot be reached as a room.
  const post = await fetch(`${origin}/status`, { method: 'POST', body: '{"room":"x","players":99}' })
  const afterPost = (await status()).json
  check('/status is read only', post.status === 405 && afterPost.players === 0, { post: post.status, after: afterPost })
  const errors = logs.split('\n').filter((l) => /error|exception|uncaught/i.test(l) && !/WebSocket.*(closed|disconnect)/i.test(l)).slice(0, 6)
  check('no errors in the runtime log', errors.length === 0, errors)
} finally {
  server.kill()
  await wait(1500)
  rmSync(persist, { recursive: true, force: true })
}
const ok = results.length >= 8 && results.every(Boolean)
console.log(ok ? 'STATUS RUNTIME CHECK OK' : 'STATUS RUNTIME CHECK FAILED')
process.exit(ok ? 0 : 1)
