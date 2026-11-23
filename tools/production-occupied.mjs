/**
 * Is anyone playing? Run before a release: a deploy resets every occupied room about five
 * minutes later (docs/CUTOVER.md, "Releasing while people are playing").
 *
 *   node tools/production-occupied.mjs https://mira.cc
 *   node tools/production-occupied.mjs https://mira.cc --rooms lobby,demo-sunday
 *
 * Exit 0: nobody is connected. Exit 1: someone is. Exit 2: could not tell.
 *
 * It asks the server's /status first: `{ rooms, players }`, every room, no names. A release
 * from before /status existed does not have it; then it falls back to looking into the rooms
 * it is told about (`lobby`, the default room, unless --rooms says otherwise) by joining each
 * for a moment as "release check" and reading who is there. That fallback cannot see a room
 * whose name it was not given, and the people in a room it looks into see one "joined" and
 * one "left" line.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const origin = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/+$/, '')
if (!/^https?:\/\//.test(origin)) { console.error('Usage: node tools/production-occupied.mjs <origin> [--rooms a,b]'); process.exit(2) }
const roomsAt = args.indexOf('--rooms')
const rooms = (roomsAt >= 0 ? args[roomsAt + 1] : 'lobby').split(',').map((r) => r.trim()).filter(Boolean)
const here = dirname(fileURLToPath(import.meta.url))
const version = Number(readFileSync(join(here, '../shared/protocol.ts'), 'utf8').match(/export const PROTOCOL_VERSION = (\d+)/)[1])

/** `{ rooms, players }` from /status, or null if this release has no such endpoint. */
async function status() {
  try {
    const res = await fetch(`${origin}/status`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null
    const body = await res.json()
    return typeof body?.rooms === 'number' && typeof body?.players === 'number' ? body : null
  } catch {
    return null
  }
}

/** People (not bots, not this check) in one room, or a reason it could not be read. */
function peek(room) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws?room=${encodeURIComponent(room)}`)
    const done = (result) => { clearTimeout(timer); try { ws.close() } catch { /* already closed */ } resolve(result) }
    const timer = setTimeout(() => done({ room, error: 'no answer in 10 s' }), 10000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', v: version, name: 'release check', params: {} })))
    ws.on('message', (data, binary) => {
      if (binary) return
      const m = JSON.parse(String(data))
      if (m.type === 'welcome') done({ room, people: m.players.filter((p) => !p.bot && p.id !== m.id).length })
      if (m.type === 'error') done({ room, error: m.message })
    })
    ws.on('error', (e) => done({ room, error: String(e.message ?? e) }))
  })
}

const s = await status()
if (s) {
  console.log(`${origin}/status: ${s.players} player${s.players === 1 ? '' : 's'} in ${s.rooms} room${s.rooms === 1 ? '' : 's'}`)
  console.log(s.players > 0 ? 'OCCUPIED: do not release now' : 'EMPTY: nobody is connected')
  process.exit(s.players > 0 ? 1 : 0)
}
console.log(`${origin} has no /status (a release from before it existed). Looking into: ${rooms.join(', ')}`)
let people = 0
let unknown = 0
for (const room of rooms) {
  const r = await peek(room)
  if (r.error) { unknown++; console.log(`  ${room}: could not tell (${r.error})`) }
  else { people += r.people; console.log(`  ${room}: ${r.people} ${r.people === 1 ? 'person' : 'people'}`) }
}
if (people > 0) { console.log('OCCUPIED: do not release now'); process.exit(1) }
if (unknown > 0) { console.log('UNKNOWN: at least one room could not be read'); process.exit(2) }
console.log(`EMPTY as far as this can see: nobody in ${rooms.join(', ')}. Rooms with other names are not visible to this check.`)
process.exit(0)
