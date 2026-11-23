/**
 * Local room server over Node `ws`. `npm run server`, then point the client at
 * ws://localhost:8787 (the default in development).
 *
 *   PORT=8787 npm run server
 */
import { maxClientFrameBytes } from '../shared/protocol'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { CLOCK_MS, type Peer, Room } from './room'
import { roomName } from './util'
import { logError, logEvent } from './log'
import { RoomRegistry } from './registry'
import { PresenceReporter } from './presenceReporter'

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
const registry = new RoomRegistry()
const reporters = new Map<string, PresenceReporter>()
function report(room: Room): void {
  let reporter = reporters.get(room.name)
  if (!reporter) {
    reporter = new PresenceReporter(async r => { registry.report(r.room, r.players, Date.now(), r.recipeId) })
    reporters.set(room.name, reporter)
  }
  const { seed, ...presence } = room.presence()
  void reporter.report({ room: room.name, ...presence }, seed)
}

/**
 * The room's own clock, as the Worker runs it with an alarm (RoomDO.keepClock): a tick every
 * CLOCK_MS while the room needs one, and nothing otherwise.
 */
const clocks = new Map<Room, ReturnType<typeof setTimeout>>()
/** Rooms whose clock is running, for the clock_start and clock_stop lines. */
const clockOn = new Set<Room>()
function keepClock(room: Room): void {
  if (clocks.has(room) || !room.needsClock) return
  clocks.set(room, setTimeout(() => {
    clocks.delete(room)
    if (rooms.get(room.name) !== room) return
    room.tick()
    report(room)
    keepClock(room)
    if (!clocks.has(room)) stopClock(room, 'not_needed')
  }, CLOCK_MS))
  if (!clockOn.has(room)) {
    clockOn.add(room)
    logEvent('clock_start', { room: room.tag })
  }
}
function stopClock(room: Room, reason: string): void {
  clearTimeout(clocks.get(room))
  clocks.delete(room)
  if (clockOn.delete(room)) logEvent('clock_stop', { room: room.tag, reason })
}

const http = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]
  if (path === '/presence' || path === '/status') {
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end('GET only'); return }
  }
  if (path === '/presence') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(registry.presence(Date.now())))
    return
  }
  // The same answer the Worker gives at /status: counts only (held places are not connected).
  if ((req.url ?? '').split('?')[0] === '/status') {
    const live = [...rooms.values()].map((r) => r.playerCount - r.heldCount).filter((n) => n > 0)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ rooms: live.length, players: live.reduce((a, b) => a + b, 0) }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain' })
  const counts = [...rooms.values()].map((r) => `${r.name}: ${r.playerCount}`)
  res.end(`Mira room server\n${counts.join('\n')}\n`)
})

const wss = new WebSocketServer({ noServer: true, maxPayload: maxClientFrameBytes() })

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, roomName(url.searchParams.get('room'))))
})

function attach(ws: WebSocket, name: string): void {
  let room = rooms.get(name)
  if (!room) {
    room = new Room(name)
    rooms.set(name, room)
  }
  const r = room
  const peer: Peer = {
    send(data) {
      if (ws.readyState === ws.OPEN) ws.send(data)
    },
    close(code, reason) {
      ws.close(code, reason)
    },
  }
  r.connect(peer)
  const openedAt = Date.now()
  logEvent('socket_open', { room: r.tag, sockets: wss.clients.size })
  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        r.receive(peer, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      } else {
        r.receive(peer, data.toString())
      }
      report(r)
      keepClock(r)
    } catch (error) {
      logError('error', error, { where: 'message', room: r.tag })
      throw error
    }
  })
  ws.on('close', (code) => {
    // ws reports an abnormal closure (no close frame) as 1006: the Worker's wasClean false.
    logEvent('socket_close', { room: r.tag, player: r.info(peer)?.id ?? null, code, clean: code !== 1006, openMs: Date.now() - openedAt })
    r.disconnect(peer)
    report(r)
    if (r.connectionCount === 0 && rooms.get(name) === r) {
      rooms.delete(name)
      stopClock(r, 'empty')
      logEvent('room_cleanup', { room: r.tag, reason: 'empty' })
    } else if (r.heldCount === r.connectionCount) stopClock(r, 'only_held')
  })
  ws.on('error', (error) => {
    logError('socket_error', error, { room: r.tag, player: r.info(peer)?.id ?? null })
    ws.close()
  })
}

http.listen(port, () => console.log(`Mira room server on ws://localhost:${port}/ws?room=<name>`))
