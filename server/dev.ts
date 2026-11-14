/**
 * Local room server over Node `ws`. `npm run server`, then point the client at
 * ws://localhost:8787 (the default in development).
 *
 *   PORT=8787 npm run server
 */
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { type Peer, Room } from './room'
import { roomName } from './util'

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  const counts = [...rooms.values()].map((r) => `${r.name}: ${r.playerCount}`)
  res.end(`Syn3h room server\n${counts.join('\n')}\n`)
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

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
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
      r.receive(peer, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
    } else {
      r.receive(peer, data.toString())
    }
  })
  ws.on('close', () => {
    r.disconnect(peer)
    if (r.connectionCount === 0 && rooms.get(name) === r) rooms.delete(name)
  })
  ws.on('error', () => ws.close())
}

http.listen(port, () => console.log(`Syn3h room server on ws://localhost:${port}/ws?room=<name>`))
