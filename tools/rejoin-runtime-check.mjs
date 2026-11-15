/**
 * Runs the `game.rejoin` code under the local Cloudflare runtime (`wrangler dev --local`):
 * the Worker and Durable Object in server/worker.ts, not the Node room server. It covers
 * what the unit tests and the browser soak cannot: the roster stored with the room, the
 * rejoin secret riding in the socket attachment, and the tidy-up alarm.
 *
 * Build first (`npm run build`), then:
 *
 *   node tools/rejoin-runtime-check.mjs [dir with wrangler.toml and dist, default .]
 *
 * Cases, with plain socket players:
 *  1. blink     both drop and come back within the hold, the object still in memory.
 *  2. reset     the server process is stopped and started (a release resetting the room):
 *               both come back from the roster in storage.
 *  3. one       only one drops and returns; the other must see no leave or join.
 *  4. quiet     both stay connected but silent for 25 s (long enough for the runtime to
 *               hibernate the object if it is going to), then one drops and returns: the
 *               secret must have survived with the socket.
 *  5. alarm     both drop and never return. After the hold plus the alarm, the server is
 *               restarted and a stranger joins: the room must have forgotten everything
 *               (ids start again at 1), which only the alarm can have done.
 *  6. off       with `game.rejoin` off a dropout is a leave and a new player.
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import WebSocket from 'ws'

const dir = resolve(process.argv[2] ?? '.')
const port = 8098
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const version = Number(readFileSync(`${dir}/shared/protocol.ts`, 'utf8').match(/export const PROTOCOL_VERSION = (\d+)/)[1])
const wrangler = `${process.cwd()}/node_modules/wrangler/bin/wrangler.js`
// A clean local state, so rooms from an earlier run cannot leak in.
const persist = `/tmp/syn3h-rejoin-runtime-${Date.now()}`
let logs = ''
const start = async () => {
  const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { logs += d })
  child.stderr.on('data', (d) => { logs += d })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return child } catch { /* not up yet */ } await wait(500) }
  child.kill(); throw new Error('wrangler dev did not start')
}
const stop = async (child) => { child.kill(); await wait(2500) }

function player(room, name, secret) {
  const p = { name, events: [], welcome: null, game: null, params: {}, open: false }
  p.connect = () => new Promise((resolveJoin, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}`)
    p.ws = ws
    ws.on('open', () => { p.open = true; ws.send(JSON.stringify({ type: 'hello', v: version, name, params: { 'world.gravity': 9.81 }, ...(secret ? { resume: secret } : {}) })) })
    ws.on('message', (data, binary) => {
      if (binary) return
      const m = JSON.parse(String(data))
      if (m.type === 'welcome') { p.welcome = m; p.game = m.game; Object.assign(p.params, m.params); resolveJoin(m) }
      if (m.type === 'game') p.game = m.game
      if (m.type === 'param') p.params[m.id] = m.value
      if (m.type === 'leave' || m.type === 'join') p.events.push(`${m.type}:${m.type === 'leave' ? m.id : m.player.id}`)
    })
    ws.on('close', () => { p.open = false })
    ws.on('error', reject)
    setTimeout(() => reject(new Error(`${name} got no welcome`)), 15000)
  })
  p.drop = async () => { p.ws.terminate(); await wait(300) }
  p.send = (m) => p.ws.send(JSON.stringify(m))
  return p
}
const results = []
const check = (name, ok, detail) => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }
const seen = (p) => ({ id: p.welcome.id, ids: p.welcome.players.map((x) => x.id).sort(), host: p.game.host, locked: p.game.locked, gravity: p.params['world.gravity'] })
const SECRET = (c) => c.repeat(32)

let server = await start()
try {
  // A room with the rule on, the sliders locked by the host and a changed world.
  const room = `rejoin${Date.now() % 100000}`
  const a = player(room, 'Alice', SECRET('a'))
  const b = player(room, 'Bob', SECRET('b'))
  await a.connect(); await b.connect()
  check('fresh rooms enable same-player rejoin without an opt-in', a.params['game.rejoin'] === true && b.params['game.rejoin'] === true, { alice: a.params['game.rejoin'], bob: b.params['game.rejoin'] })
  a.send({ type: 'param', id: 'world.gravity', value: 15 })
  a.send({ type: 'lock', locked: true })
  await wait(800)
  const first = [seen(a), seen(b)]
  const same = (now) => now.every((v, i) => v.id === first[i].id) && now.every((v) => v.host === first[0].id && v.locked === true && v.gravity === 15 && JSON.stringify(v.ids) === JSON.stringify([first[0].id, first[1].id].sort()))

  // 1. Both blink.
  await a.drop(); await b.drop()
  await wait(3000)
  await b.connect(); await a.connect(); await wait(500)
  check('1. blink: both drop and return as the same players, host and lock intact', same([seen(a), seen(b)]), [seen(a), seen(b)])

  // 2. The object is reset under them.
  await stop(server)
  const closed = { alice: !a.open, bob: !b.open }
  server = await start()
  await b.connect(); await a.connect(); await wait(500)
  check('2. reset: the server restarts and both return as the same players from stored state', closed.alice && closed.bob && same([seen(a), seen(b)]), { closed, now: [seen(a), seen(b)] })

  // 3. Only one drops.
  b.events.length = 0
  await a.drop()
  await wait(4000)
  await a.connect(); await wait(500)
  check('3. one: the one who stayed saw no leave and no join', same([seen(a), seen(b)]) && b.events.length === 0, { now: seen(a), bobSaw: b.events })

  // 4. Silence, then a drop: the secret must still be with the socket.
  await wait(25000)
  b.events.length = 0
  await a.drop()
  await wait(1000)
  await a.connect(); await wait(500)
  check('4. quiet: after 25 s of silence a dropout still returns as the same player', same([seen(a), seen(b)]) && b.events.length === 0, { now: seen(a), bobSaw: b.events })

  // 5. Both leave for good: the alarm must clear the room's storage.
  await a.drop(); await b.drop()
  await wait(36000)
  const alarmLogged = /alarm/i.test(logs)
  await stop(server)
  server = await start()
  const c = player(room, 'Carol', SECRET('c'))
  await c.connect(); await wait(300)
  check('5. alarm: after the hold ran out with nobody back, the room forgot everything', c.welcome.id === 1 && c.welcome.players.length === 1 && c.params['world.gravity'] === 9.81, { carol: seen(c), alarmSeenInRuntimeLog: alarmLogged })
  await c.drop()

  // 6. The rule off, in a fresh room.
  const room2 = `${room}off`
  const d = player(room2, 'Dan', SECRET('d'))
  const e = player(room2, 'Eve', SECRET('e'))
  await d.connect(); await e.connect()
  d.send({ type: 'param', id: 'game.rejoin', value: false })
  await wait(300)
  const dId = d.welcome.id
  e.events.length = 0
  await d.drop(); await wait(1500)
  await d.connect(); await wait(500)
  check('6. off: with the rule off a dropout is a leave and a new player', d.welcome.id !== dId && e.events.includes(`leave:${dId}`) && e.events.includes(`join:${d.welcome.id}`), { before: dId, after: d.welcome.id, eveSaw: e.events })
  const errors = logs.split('\n').filter((l) => /error|exception|uncaught/i.test(l) && !/WebSocket.*(closed|disconnect)/i.test(l)).slice(0, 6)
  check('no errors in the runtime log', errors.length === 0, errors)
} finally {
  server.kill()
  await wait(1500)
  rmSync(persist, { recursive: true, force: true })
}
const ok = results.length >= 8 && results.every(Boolean)
console.log(ok ? 'REJOIN RUNTIME CHECK OK' : 'REJOIN RUNTIME CHECK FAILED')
process.exit(ok ? 0 : 1)
