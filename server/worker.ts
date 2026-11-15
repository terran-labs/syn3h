/**
 * Cloudflare Worker: serves the built client from `dist/` and routes `/ws?room=<name>` to one
 * Durable Object per room. The object uses the WebSocket hibernation API, so an idle room
 * costs nothing; everything it needs to wake up again lives in the socket attachments
 * (who each player is) and in storage (parameters, tag state, scores).
 *
 * The Workers runtime types are declared minimally below rather than adding a dependency.
 */
import type { PlayerInfo } from '../shared/protocol'
import { REFRESH_MS, RoomRegistry } from './registry'
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
    // How many people are playing, in total: counts only. Read before a release.
    if (url.pathname === '/status') {
      if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: { allow: 'GET' } })
      return env.ROOMS.get(env.ROOMS.idFromName(REGISTRY_ID)).fetch(new Request('https://registry/totals'))
    }
    return env.ASSETS.fetch(req)
  },
}

/**
 * The player count for /status is kept by one reserved instance of the room class, not by a
 * class of its own. A new Durable Object class needs a migration, and Cloudflare does not
 * allow a rollback to a version from before a class change, so adding one would have put
 * every earlier release out of reach of tools/rollback.sh. This way the classes and bindings
 * are exactly as before. The name cannot be a player's room: room names are slugs of
 * a-z, 0-9, _ and - (roomName), and this has neither only those nor comes from a URL.
 */
const REGISTRY_ID = '#status'

export class RoomDO {
  private room: Room | null = null
  private snapshot: RoomSnapshot | undefined
  private readonly peers = new WeakMap<WebSocket, Peer>()

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.snapshot = await state.storage.get<RoomSnapshot>('room')
    })
  }

  /** The count last sent to the registry, and when. -1: nothing sent by this instance. */
  private reported = -1
  private reportedAt = 0

  /**
   * Tell the registry how many players are connected here, when that changes and every
   * REFRESH_MS while there is traffic. Held places (game.rejoin) are not connected and do
   * not count. Never awaited: counting must not slow or break the game.
   */
  private report(room: Room): void {
    const players = room.playerCount - room.heldCount
    const now = Date.now()
    if (players === this.reported && now - this.reportedAt < REFRESH_MS) return
    if (players === 0 && this.reported <= 0 && this.reported !== -1) return
    this.reported = players
    this.reportedAt = now
    try {
      const body = JSON.stringify({ room: room.name, players })
      void this.env.ROOMS.get(this.env.ROOMS.idFromName(REGISTRY_ID))
        .fetch(new Request('https://registry/report', { method: 'POST', body }))
        .catch(() => {})
    } catch {
      // Counting must never break the game.
    }
  }

  /** Only on the registry instance: the counts, loaded from storage on first use. */
  private registry: RoomRegistry | null = null

  /** The registry instance's two requests; see REGISTRY_ID. */
  private async registryFetch(req: Request, path: string): Promise<Response> {
    this.registry ??= new RoomRegistry(await this.state.storage.get<Record<string, { players: number; at: number }>>('counts'))
    if (path === '/report' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { room?: unknown; players?: unknown } | null
      if (body && typeof body.room === 'string' && typeof body.players === 'number') {
        this.registry.report(body.room, body.players, Date.now())
        await this.state.storage.put('counts', this.registry.save())
      }
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify(this.registry.totals(Date.now())), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path === '/report' || path === '/totals') return this.registryFetch(req, path)
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
    this.report(room)
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
    this.report(room)
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

  /**
   * The holds have run out: if nobody came back, the room is empty and forgets its world.
   *
   * An alarm wakes the object like any event, and after hibernation it wakes with no room in
   * memory although players are still connected (the room is rebuilt from their sockets on
   * the next message). "No room" must therefore never be read as "nobody here": that wiped
   * the storage under two connected players, and the room came back with default settings.
   * Any connected socket means the room is in use, and it is left alone.
   */
  async alarm(): Promise<void> {
    if (this.state.getWebSockets().length > 0) return
    const room = this.room
    room?.tick()
    if (room) this.report(room)
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
