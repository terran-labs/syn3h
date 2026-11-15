/**
 * Shows what a room keeps when its Durable Object is reset, as a production deploy does to a
 * room with players in it (Cloudflare defers the code update for up to five minutes, then
 * resets the object and disconnects its sockets).
 *
 * It serves the frozen build with `wrangler dev --local`, joins two plain socket players,
 * changes the world and the score state, stops the server process, starts it again, and has
 * both players reconnect the way the game client does (hello with the world they hold).
 * It prints what each saw and what the room holds afterwards.
 *
 *   node tools/deploy-reset-check.mjs            # port 8099
 */
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import WebSocket from 'ws'

const port = 8099
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const dest = realpathSync('../Syn3h-stable/current')
const version = Number(readFileSync(`${dest}/shared/protocol.ts`, 'utf8').match(/export const PROTOCOL_VERSION = (\d+)/)[1])
const wrangler = `${process.cwd()}/node_modules/wrangler/bin/wrangler.js`
const start = async () => {
  const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1'], { cwd: dest, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/build.json`)).ok) return child } catch { /* not up yet */ } await wait(500) }
  child.kill(); throw new Error('wrangler dev did not start')
}
const room = `reset${Date.now() % 100000}`
function player(name, params) {
  const p = { name, log: [], welcome: null, params: { ...params }, game: null, closed: null }
  p.connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}`)
    p.ws = ws
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', v: version, name, params: p.params })))
    ws.on('message', (data, binary) => {
      if (binary) return
      const m = JSON.parse(String(data))
      if (m.type === 'welcome') { p.welcome = m; Object.assign(p.params, m.params); p.game = m.game; resolve(m) }
      if (m.type === 'param') p.params[m.id] = m.value
      if (m.type === 'game') p.game = m.game
    })
    ws.on('close', (code) => { p.closed = { code, at: Date.now() } })
    ws.on('error', reject)
  })
  return p
}
const brief = (p) => ({ id: p.welcome.id, players: p.welcome.players.map((x) => `${x.id}:${x.name}`), gravity: p.params['world.gravity'], mode: p.params['game.mode'], host: p.game.host, it: p.game.it, locked: p.game.locked, scores: p.game.scores })

let server = await start()
try {
  const a = player('Alice', { 'world.gravity': 9.81, 'world.seed': 1 })
  const b = player('Bob', { 'world.gravity': 9.81, 'world.seed': 1 })
  await a.connect(); await b.connect()
  a.ws.send(JSON.stringify({ type: 'param', id: 'world.gravity', value: 15 }))
  a.ws.send(JSON.stringify({ type: 'lock', locked: true }))
  await wait(800)
  console.log('before the reset  Alice', JSON.stringify(brief(a)))
  console.log('before the reset  Bob  ', JSON.stringify(brief(b)))

  const t0 = Date.now()
  server.kill()
  await wait(2500)
  console.log('sockets after the server stopped', JSON.stringify({ alice: a.closed?.code ?? 'still open', bob: b.closed?.code ?? 'still open' }))
  server = await start()
  console.log(`server back after ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  // Bob happens to reconnect first, then Alice, each sending the world it holds.
  await b.connect(); await a.connect()
  await wait(800)
  console.log('after the reset   Bob  ', JSON.stringify(brief(b)))
  console.log('after the reset   Alice', JSON.stringify(brief(a)))
} finally {
  server.kill()
}
