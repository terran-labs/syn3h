/**
 * Cloudflare Worker: serves the built client from `dist/` and routes `/ws?room=<name>` to one
 * Durable Object per room. The object uses the WebSocket hibernation API, so an idle room
 * costs nothing; everything it needs to wake up again lives in the socket attachments
 * (who each player is) and in storage (parameters, tag state, scores).
 *
 * The Workers runtime types are declared minimally below rather than adding a dependency.
 */
import type { PlayerInfo } from '../shared/protocol'
import { type Peer, Room, type RoomSnapshot } from './room'
import { REJOIN_GRACE } from '../src/modes/params'
import { roomName } from './util'

interface DurableObjectId {}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}
interface Fetcher {
  fetch(req: Request): Promise<Response>
}
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  deleteAll(): Promise<void>
  setAlarm(at: number): Promise<void>
}
/** Hibernation capable sockets carry a small serialisable attachment. */
interface HibernatingWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
interface DurableObjectState {
  storage: DurableObjectStorage
  acceptWebSocket(ws: WebSocket): void
  getWebSockets(): HibernatingWebSocket[]
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}
declare const WebSocketPair: { new (): { 0: WebSocket; 1: HibernatingWebSocket } }

interface Env {
  ROOMS: DurableObjectNamespace
  ASSETS: Fetcher
}

interface Attachment {
  room: string
  info?: PlayerInfo
  /** The player's rejoin secret (game.rejoin), so it survives hibernation with the socket. */
  token?: string | null
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('expected a websocket', { status: 426 })
      }
      const name = roomName(url.searchParams.get('room'))
      return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(req)
    }
    return env.ASSETS.fetch(req)
  },
}

export class RoomDO {
  private room: Room | null = null
  private snapshot: RoomSnapshot | undefined
  private readonly peers = new WeakMap<WebSocket, Peer>()

  constructor(private readonly state: DurableObjectState, _env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.snapshot = await state.storage.get<RoomSnapshot>('room')
    })
  }

  async fetch(req: Request): Promise<Response> {
    const name = roomName(new URL(req.url).searchParams.get('room'))
    const room = this.ensureRoom(name)
    const pair = new WebSocketPair()
    const server = pair[1]
    this.state.acceptWebSocket(server)
    server.serializeAttachment({ room: name } satisfies Attachment)
    room.connect(this.peer(server))
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
  }

  webSocketMessage(ws: HibernatingWebSocket, message: string | ArrayBuffer): void {
    const room = this.roomFor(ws)
    if (!room) return
    const peer = this.peer(ws)
    room.receive(peer, message)
    const att = ws.deserializeAttachment() as Attachment
    if (!att.info) {
      const info = room.info(peer)
      if (info) ws.serializeAttachment({ ...att, info, token: room.token(peer) } satisfies Attachment)
    }
  }

  webSocketClose(ws: HibernatingWebSocket, code: number, _reason: string): void {
    this.drop(ws)
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed')
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws: HibernatingWebSocket): void {
    this.drop(ws)
  }

  private drop(ws: HibernatingWebSocket): void {
    const room = this.roomFor(ws)
    if (!room) return
    room.disconnect(this.peer(ws))
    // An empty room forgets its world: the next first player brings theirs.
    if (room.connectionCount === 0) {
      this.state.storage.deleteAll()
      this.snapshot = undefined
    } else if (room.heldCount === room.connectionCount) {
      // Nobody is connected, but places are held for players who may rejoin (game.rejoin).
      // Keep the storage for them, and come back when the holds have run out to tidy up:
      // with no sockets there are no messages to make the room notice the time.
      void this.state.storage.setAlarm(Date.now() + (REJOIN_GRACE + 2) * 1000)
    }
  }

  /** The holds have run out: if nobody came back, the room is empty and forgets its world. */
  async alarm(): Promise<void> {
    const room = this.room
    room?.tick()
    if (!room || room.connectionCount === 0) {
      await this.state.storage.deleteAll()
      this.snapshot = undefined
    }
  }

  /** After hibernation the object is rebuilt from scratch; rebuild the room from the sockets. */
  private roomFor(ws: HibernatingWebSocket): Room | null {
    if (this.room) return this.room
    const att = ws.deserializeAttachment() as Attachment | null
    return att ? this.ensureRoom(att.room) : null
  }

  private ensureRoom(name: string): Room {
    if (this.room) return this.room
    const room = new Room(name, { onPersist: (s) => void this.state.storage.put('room', s) })
    if (this.snapshot) room.restore(this.snapshot)
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.info) room.adopt(this.peer(ws), att.info, att.token)
      else room.connect(this.peer(ws))
    }
    this.room = room
    return room
  }

  private peer(ws: WebSocket): Peer {
    let p = this.peers.get(ws)
    if (!p) {
      p = {
        send(data) {
          try {
            ws.send(data as string | Uint8Array<ArrayBuffer>)
          } catch {
            // The socket closed under us; its close event cleans up.
          }
        },
        close(code, reason) {
          ws.close(code, reason)
        },
      }
      this.peers.set(ws, p)
    }
    return p
  }
}
