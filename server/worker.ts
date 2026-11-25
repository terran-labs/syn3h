/**
 * Cloudflare Worker: serves the built client from `dist/` and routes `/ws?room=<name>` to one
 * Durable Object per room. The object uses the WebSocket hibernation API, so an idle room
 * costs nothing; everything it needs to wake up again lives in the socket attachments
 * (who each player is) and in storage (parameters, tag state, scores).
 *
 * The Workers runtime types are declared minimally below rather than adding a dependency.
 */
import type { PlayerInfo } from '../shared/protocol'
import { RoomRegistry, type RegistryEntry } from './registry'
import { PresenceReporter } from './presenceReporter'
import { CLOCK_MS, type Peer, Room, type RoomSnapshot } from './room'
import { REJOIN_GRACE } from '../src/modes/params'
import { roomName } from './util'
import { logError, logEvent } from './log'

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
  waitUntil(promise: Promise<unknown>): void
  acceptWebSocket(ws: WebSocket): void
  getWebSockets(): HibernatingWebSocket[]
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}
declare const WebSocketPair: { new (): { 0: WebSocket; 1: HibernatingWebSocket } }

/**
 * The R2 bucket of frozen versions, as this Worker may use it: read only. The binding itself can
 * write (Cloudflare has no read-only R2 binding), so the type leaves put and delete out and the
 * typecheck refuses them; tools/frozen-versions.mjs is the only writer, with the release token.
 * Staging binds the same bucket and so cannot damage production's archive either.
 */
interface R2Range { offset?: number; length?: number; suffix?: number }
interface R2Object {
  size: number
  httpEtag: string
  range?: R2Range
  writeHttpMetadata(headers: Headers): void
}
interface R2ObjectBody extends R2Object { body: ReadableStream }
export interface FrozenBucket {
  get(key: string, options?: { onlyIf?: Headers; range?: Headers }): Promise<R2Object | R2ObjectBody | null>
  head(key: string): Promise<R2Object | null>
}

interface Env {
  ROOMS: DurableObjectNamespace
  ASSETS: Fetcher
  /** Frozen versions in R2 (v/<version>/<path>); absent in local dev and tests that omit it. */
  FROZEN?: FrozenBucket
}

interface Attachment {
  room: string
  info?: PlayerInfo
  /** The player's rejoin secret (game.rejoin), so it survives hibernation with the socket. */
  token?: string | null
  /** Epoch ms the socket was accepted, for the close line's openMs. */
  at?: number
  /** The player was paused as last seen (Room.pausedOf), so a wake counts them right (adopt). */
  paused?: boolean
  // The hello's page marker is not kept here: after a hibernation wake, a same-page reconnect
  // within 1.5 s of the place's last message falls back to the quiet rule (Room.quietFor).
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
    if (url.pathname === '/status' || url.pathname === '/presence') {
      if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: { allow: 'GET' } })
      return env.ROOMS.get(env.ROOMS.idFromName(REGISTRY_ID)).fetch(new Request(`https://registry/${url.pathname === '/presence' ? 'presence' : 'totals'}`))
    }
    // The standalone WebGPU present test (public/webgpu-present-test.html) keeps its .html address:
    // Workers Assets' default html_handling answers /name.html with a 307 to /name, and the
    // release guard (tools/frozen-versions.mjs check) wants that release's file at the address
    // asked. So this one path runs the Worker first (wrangler.toml) and is served exactly as any
    // other root file, by version, except that its own static asset is read at the extensionless
    // address the assets answer with a 200. A frozen version's copy comes from R2 under its .html
    // key, as archived.
    if (url.pathname === PRESENT_TEST) return serveVersioned(req, url, { ...env, ASSETS: htmlAsset(env.ASSETS) })
    return serveVersioned(req, url, env)
  },
}

const PRESENT_TEST = '/webgpu-present-test.html'
/** `assets`, reading PRESENT_TEST from its extensionless address: the same body, status and caching headers, as text/html, never a redirect. */
function htmlAsset(assets: Fetcher): Fetcher {
  // Only fetch: it is all serveVersioned and the functions it calls use of ASSETS.
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = new Request(input as RequestInfo, init)
      const url = new URL(req.url)
      if (url.pathname !== PRESENT_TEST) return assets.fetch(req)
      url.pathname = PRESENT_TEST.slice(0, -'.html'.length)
      const got = await assets.fetch(new Request(url, { method: req.method, headers: req.headers, redirect: 'manual' }))
      const out = new Response(got.body, got)
      if (got.ok) out.headers.set('content-type', 'text/html; charset=utf-8')
      return out
    },
  } as unknown as Fetcher
}

/**
 * Frozen versions in R2, the durable copy: v/<version>/<path> in the syn3h-versions bucket
 * (tools/frozen-versions.mjs r2-upload). Answers a GET or HEAD for `path` of `version`, honouring
 * If-None-Match and If-Modified-Since (304) and Range (206), or null when the object is not there.
 */
const HASHED = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/
async function fromR2(req: Request, env: Env, version: string, path: string, kind: 'document' | 'routed' | 'direct'): Promise<Response | null> {
  if (!env.FROZEN) return null
  const key = `v/${version}${kind === 'document' ? '/index.html' : path}`
  const head = req.method === 'HEAD'
  const object = head ? await env.FROZEN.head(key) : await env.FROZEN.get(key, { onlyIf: req.headers, range: req.headers })
  if (!object) return null
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('x-syn3h-version', version)
  // A page is never cached (its version comes from the address). A file whose address names it
  // uniquely (a content hash, or /v/<version>/...) never changes. A root path chosen by the
  // Referer (build.json, models) is the same address for every version: revalidate it.
  if (kind === 'document') headers.set('cache-control', 'no-store')
  else if (kind === 'direct' || HASHED.test(path)) headers.set('cache-control', 'public, max-age=31536000, immutable')
  else headers.set('cache-control', 'no-cache')
  if (kind === 'routed') headers.append('vary', 'Referer')
  if (head) { headers.set('content-length', String(object.size)); return new Response(null, { headers }) }
  const body = 'body' in object ? (object as R2ObjectBody).body : null
  if (!body) {
    // A precondition held back the body: unchanged for If-None-Match or If-Modified-Since.
    const unchanged = req.headers.has('If-None-Match') || req.headers.has('If-Modified-Since')
    return new Response(null, { status: unchanged ? 304 : 412, headers })
  }
  const range = object.range
  if (range && req.headers.has('Range')) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : range.offset ?? 0
    const length = range.suffix !== undefined ? range.suffix : range.length ?? object.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    return new Response(body, { status: 206, headers })
  }
  return new Response(body, { headers })
}

/**
 * Frozen versions (step two of the move to R2). `/?v=26.11.1503` serves that release's page at
 * the root; the files its page asks for by root path are chosen by the Referer's own `v` when the
 * Worker sees them (build.json, models: run_worker_first), and its own /v/<version>/ addresses
 * (src/core/frozenResources.ts) name the version outright. This deployment's own version is
 * served from its own static assets, so its link works before `archive` has stored it; every
 * other version is read from R2 only (fromR2). Deployments carry no old versions, only
 * /v/versions.json, the list used for the unknown-version page and the search order below.
 */
const VERSION = /^v?(\d+\.\d+\.\d+)$/
function versionOf(value: string | null): string | null {
  return value ? (VERSION.exec(value.trim())?.[1] ?? null) : null
}
async function frozenVersions(req: Request, env: Env): Promise<string[]> {
  try {
    const r = await env.ASSETS.fetch(new Request(new URL('/v/versions.json', req.url)))
    if (!r.ok) return []
    const list = ((await r.json()) as { versions?: unknown }).versions
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
/** This deployment's version, from its own build.json, read once per isolate (a failure is retried). */
let own: Promise<string | null> | undefined
function ownVersion(req: Request, env: Env): Promise<string | null> {
  own ??= env.ASSETS.fetch(new Request(new URL('/build.json', req.url)))
    .then(async (r) => (r.ok ? versionOf(((await r.json()) as { version?: string }).version ?? null) : null))
    .catch(() => null)
    .then((v) => { if (v === null) own = undefined; return v })
  return own
}
/** Tests run many deployments in one isolate. */
export function forgetOwnVersion(): void { own = undefined }
/** A response from this deployment's own static assets, marked as `version`. */
async function fromOwnAssets(req: Request, env: Env, path: string, version: string, kind: 'document' | 'routed' | 'direct'): Promise<Response> {
  const got = await env.ASSETS.fetch(new Request(new URL(path, req.url), { method: req.method, headers: req.headers }))
  const out = new Response(got.body, got)
  if (!got.ok && got.status !== 304) return out
  out.headers.set('x-syn3h-version', version)
  if (kind === 'document') out.headers.set('cache-control', 'no-store')
  if (kind === 'routed') out.headers.append('vary', 'Referer')
  return out
}
const notFound = () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
const DIRECT = /^\/v\/(\d+\.\d+\.\d+)(\/.+)$/
async function serveVersioned(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return env.ASSETS.fetch(req)
  if (url.pathname === '/v/versions.json') return env.ASSETS.fetch(req)
  // A frozen page's own address for a file: /v/<version>/<path>.
  const direct = DIRECT.exec(url.pathname)
  if (direct) {
    if (direct[1] === await ownVersion(req, env)) return fromOwnAssets(req, env, direct[2], direct[1], 'direct')
    return (await fromR2(req, env, direct[1], direct[2], 'direct')) ?? notFound()
  }
  const isDocument = url.pathname === '/' || url.pathname === '/index.html'
  let referrerV: string | null = null
  try {
    const ref = req.headers.get('Referer')
    if (ref) referrerV = versionOf(new URL(ref).searchParams.get('v'))
  } catch {
    // An unparsable Referer selects nothing.
  }
  const asked = url.searchParams.has('v')
  const wanted = isDocument ? versionOf(url.searchParams.get('v')) : referrerV
  if (isDocument && asked && !wanted) return unknownVersion(url.searchParams.get('v') ?? '', await frozenVersions(req, env))
  if (wanted) {
    const kind = isDocument ? 'document' : 'routed'
    if (wanted === await ownVersion(req, env)) return fromOwnAssets(req, env, isDocument ? '/' : url.pathname, wanted, kind)
    const stored = await fromR2(req, env, wanted, url.pathname, kind)
    if (stored) return stored
    if (isDocument) return unknownVersion(wanted, await frozenVersions(req, env))
    // A root file this version never had: the latest build's, as a browser would get it.
  }
  const latest = await env.ASSETS.fetch(req)
  if (latest.status !== 404 || isDocument || !HASHED.test(url.pathname)) return latest
  // A content-hashed file the latest build no longer has, asked without a usable Referer: the
  // release that owns it is in R2. Only hashed names are searched.
  const mine = await ownVersion(req, env)
  return (await searchHashed(req, env, url, (await frozenVersions(req, env)).filter((v) => v !== mine).reverse())) ?? latest
}

/**
 * Find `url`'s path among `versions` (newest first) in R2. One read per version in series grew
 * with every release (2.9 s for a made-up name at 54 versions), so the versions are looked up
 * SEARCH_BATCH at a time with HEAD reads, and the first batch holding the file decides. A name
 * found nowhere is remembered at the edge for SEARCH_MISS_SECONDS (the Cache API: the custom
 * domain only, never workers.dev), so a client or a scanner repeating it costs no reads. A
 * cached miss cannot hide a file: hashed names are content-addressed, the latest build's files
 * are served by the static assets before the Worker runs, and a version's files are all in R2
 * before any page can ask for them.
 */
const SEARCH_BATCH = 16
const SEARCH_MISS_SECONDS = 300
async function searchHashed(req: Request, env: Env, url: URL, versions: string[]): Promise<Response | null> {
  if (!env.FROZEN || !versions.length) return null
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  const key = new Request(`${url.origin}${url.pathname}`)
  if (cache) { const hit = await cache.match(key); if (hit) return hit }
  for (let i = 0; i < versions.length; i += SEARCH_BATCH) {
    const batch = versions.slice(i, i + SEARCH_BATCH)
    const found = await Promise.all(batch.map((v) => env.FROZEN!.head(`v/${v}${url.pathname}`)))
    const at = found.findIndex(Boolean)
    if (at >= 0) return fromR2(req, env, batch[at], url.pathname, 'direct')
  }
  // Best effort: a cache that will not take it changes nothing but the next miss's cost.
  if (cache) {
    await cache.put(key, new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': `public, max-age=${SEARCH_MISS_SECONDS}` } })).catch(() => {})
  }
  return null
}
function unknownVersion(asked: string, versions: string[]): Response {
  const list = versions.map(v => `https://mira.cc/?v=${v}`).join('\n')
  return new Response(`Mira has no frozen version "${asked}".\n\nFrozen versions:\n${list}\n`, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
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
  /**
   * Epoch ms of the clock alarm this object last set, or 0 when none is pending. In memory
   * only: after an eviction it reads 0, and the next message sets the alarm again, which
   * merely replaces the pending one (an object has a single alarm).
   */
  private clockAt = 0
  /** The room's clock is running, for the clock_start and clock_stop lines (not per tick). */
  private clockOn = false
  /** Epoch ms of the last failed presence report line; at most one a minute. */
  private reportErrorAt = -Infinity

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.snapshot = await state.storage.get<RoomSnapshot>('room')
    })
  }

  private readonly reporter = new PresenceReporter(async report => {
    const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(REGISTRY_ID))
      .fetch(new Request('https://registry/report', { method: 'POST', body: JSON.stringify(report) }))
    if (!response.ok) throw new Error('Registry report failed')
  }, () => Date.now(), (error) => {
    if (Date.now() - this.reportErrorAt < 60_000) return
    this.reportErrorAt = Date.now()
    logError('error', error, { where: 'presence', room: this.tag() })
  })

  /** Counting never blocks gameplay; hold the event alive until ordered delivery finishes. */
  private report(room: Room): void {
    const { seed, ...presence } = room.presence()
    this.state.waitUntil(this.reporter.report({ room: room.name, ...presence }, seed))
  }

  /** Only on the registry instance: the counts, loaded from storage on first use. */
  private registryReady: Promise<RoomRegistry> | null = null

  /** The registry instance's two requests; see REGISTRY_ID. */
  private async registryFetch(req: Request, path: string): Promise<Response> {
    this.registryReady ??= this.state.storage.get<Record<string, RegistryEntry>>('counts').then(saved => new RoomRegistry(saved))
    const registry = await this.registryReady
    if (path === '/report' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { room?: unknown; players?: unknown; recipeId?: unknown; active?: unknown } | null
      if (body && typeof body.room === 'string' && typeof body.players === 'number') {
        registry.report(body.room, body.players, Date.now(), body.recipeId, body.active)
        await this.state.storage.put('counts', registry.save())
      }
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify(path === '/presence' ? registry.presence(Date.now()) : registry.totals(Date.now())), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path === '/report' || path === '/totals' || path === '/presence') return this.registryFetch(req, path)
    const name = roomName(new URL(req.url).searchParams.get('room'))
    const room = this.ensureRoom(name)
    const pair = new WebSocketPair()
    const server = pair[1]
    this.state.acceptWebSocket(server)
    server.serializeAttachment({ room: name, at: Date.now() } satisfies Attachment)
    room.connect(this.peer(server))
    logEvent('socket_open', { room: room.tag, sockets: this.state.getWebSockets().length })
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
  }

  webSocketMessage(ws: HibernatingWebSocket, message: string | ArrayBuffer): void {
    const room = this.roomFor(ws)
    if (!room) return
    try {
      const peer = this.peer(ws)
      room.receive(peer, message)
      this.report(room)
      this.keepClock(room)
      const att = ws.deserializeAttachment() as Attachment
      if (!att.info) {
        const info = room.info(peer)
        if (info) ws.serializeAttachment({ ...att, info, token: room.token(peer), ...(room.pausedOf(peer) ? { paused: true } : {}) } satisfies Attachment)
      } else if (room.pausedOf(peer) !== Boolean(att.paused)) {
        // Pausing or resuming: kept with the socket for a hibernation wake. One write per change.
        const { paused: _was, ...rest } = att
        ws.serializeAttachment({ ...rest, ...(room.pausedOf(peer) ? { paused: true } : {}) } satisfies Attachment)
      }
    } catch (error) {
      // Logged, then thrown on as before: the runtime's handling of a failed event is unchanged.
      logError('error', error, { where: 'message', room: room.tag })
      throw error
    }
  }

  webSocketClose(ws: HibernatingWebSocket, code: number, _reason: string, wasClean?: boolean): void {
    const att = ws.deserializeAttachment() as Attachment | null
    logEvent('socket_close', {
      room: this.tag(ws), player: att?.info?.id ?? null, code, clean: wasClean ?? null,
      openMs: att?.at ? Date.now() - att.at : null,
    })
    this.drop(ws)
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed')
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws: HibernatingWebSocket, error?: unknown): void {
    const att = ws.deserializeAttachment() as Attachment | null
    logError('socket_error', error, { room: this.tag(ws), player: att?.info?.id ?? null })
    this.drop(ws)
  }

  private drop(ws: HibernatingWebSocket): void {
    const room = this.roomFor(ws)
    if (!room) return
    room.disconnect(this.peer(ws))
    this.report(room)
    // An empty room forgets its world: the next first player brings theirs.
    if (room.connectionCount === 0) {
      this.stopClock(room, 'empty')
      logEvent('room_cleanup', { room: room.tag, reason: 'empty' })
      this.state.storage.deleteAll()
      this.snapshot = undefined
    } else if (room.heldCount === room.connectionCount) {
      // Nobody is connected, but places are held for players who may rejoin (game.rejoin).
      // Keep the storage for them, and come back when the holds have run out to tidy up:
      // with no sockets there are no messages to make the room notice the time.
      // This replaces any clock alarm: nobody connected means nothing to time.
      this.clockAt = 0
      this.stopClock(room, 'only_held')
      void this.state.storage.setAlarm(Date.now() + (REJOIN_GRACE + 2) * 1000)
    }
  }

  /**
   * Run the room's own clock while it needs one (Room.needsClock): an alarm CLOCK_MS from
   * now, set again from alarm() each time it fires. Alarms are durable and survive an
   * eviction, unlike setTimeout, and each one is a billed request plus one row written, so
   * none is set while the room does not need it and an idle room can hibernate.
   */
  private keepClock(room: Room): void {
    if (this.clockAt || !room.needsClock) return
    this.clockAt = Date.now() + CLOCK_MS
    void this.state.storage.setAlarm(this.clockAt)
    if (!this.clockOn) {
      this.clockOn = true
      logEvent('clock_start', { room: room.tag })
    }
  }

  private stopClock(room: Room, reason: string): void {
    if (!this.clockOn) return
    this.clockOn = false
    logEvent('clock_stop', { room: room.tag, reason })
  }

  /**
   * The holds have run out: if nobody came back, the room is empty and forgets its world.
   *
   * An alarm wakes the object like any event, and after hibernation it wakes with no room in
   * memory although players are still connected (the room is rebuilt from their sockets on
   * the next message). "No room" must therefore never be read as "nobody here": that wiped
   * the storage under two connected players, and the room came back with default settings.
   * Any connected socket means the room is in use: then the alarm is the room's clock
   * (keepClock) and only ticks it, never tidying up.
   */
  async alarm(): Promise<void> {
    try {
      await this.runAlarm()
    } catch (error) {
      // Logged, then thrown on so the runtime retries the alarm as before.
      logError('error', error, { where: 'alarm', room: this.tag() })
      throw error
    }
  }

  private async runAlarm(): Promise<void> {
    this.clockAt = 0
    const sockets = this.state.getWebSockets()
    if (sockets.length > 0) {
      // In use: this is the room's clock (keepClock), not the cleanup. Tick on room time, so
      // the hill scores and races end while every page is quiet, then go again if still needed.
      const room = this.roomFor(sockets[0])
      if (!room) return
      // With sockets open, an alarm is always the clock's: after an eviction this object did
      // not see it start, but must still report it stopping.
      this.clockOn = true
      room.tick()
      this.report(room)
      this.keepClock(room)
      if (!this.clockAt) this.stopClock(room, 'not_needed')
      return
    }
    const room = this.room
    room?.tick()
    if (room) this.report(room)
    if (!room || room.connectionCount === 0) {
      logEvent('room_cleanup', { room: this.tag(), reason: 'holds_expired' })
      await this.state.storage.deleteAll()
      this.snapshot = undefined
    }
  }

  /**
   * This room's log tag on any path, including after an eviction: the room in memory, else the
   * room a socket's attachment names (rebuilding it, as the socket's own handling is about to),
   * else the tag kept in the stored snapshot. "unknown" only for an object with none of these
   * (an alarm on storage already wiped, or a snapshot stored before the tag was kept).
   */
  private tag(ws?: HibernatingWebSocket): string {
    return (ws ? this.roomFor(ws) : this.room)?.tag ?? this.snapshot?.tag ?? 'unknown'
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
      if (att?.info) room.adopt(this.peer(ws), att.info, att.token, att.paused === true)
      else room.connect(this.peer(ws))
    }
    this.room = room
    return room
  }

  private peer(ws: HibernatingWebSocket): Peer {
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
          // A socket the room closes (replaced by its own player's new connection, silent,
          // full) must never be adopted as a player if the object hibernates and wakes before
          // the close completes: forget who it was.
          try {
            const att = ws.deserializeAttachment() as Attachment | null
            if (att?.info) ws.serializeAttachment({ room: att.room, at: att.at } satisfies Attachment)
          } catch {
            // No attachment API on this socket: nothing to forget.
          }
          ws.close(code, reason)
        },
      }
      this.peers.set(ws, p)
    }
    return p
  }
}
