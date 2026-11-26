/**
 * Cloudflare Worker: serves the built client from `dist/` and routes `/ws?room=<name>` to one
 * Durable Object per room. The object uses the WebSocket hibernation API, so an idle room
 * costs nothing; everything it needs to wake up again lives in the socket attachments
 * (who each player is) and in storage (parameters, tag state, scores).
 *
 * The Workers runtime types are declared minimally below rather than adding a dependency.
 */
import type { PlayerInfo } from '../shared/protocol'
import { ACTIVE_SAVE_MS, RoomRegistry, type RegistryEntry, STALE_MS } from './registry'
import {
  type AnalyticsSink, cleanClientPost, dataPoint, endRows, GEO_HEADER, geoFromHeader, geoHeader, geoOf,
  POST_MAX_BYTES, postKey, PostLimiter, PRESENCE_SNAPSHOT_MS, readCapped, ROOM_ROWS_PER_MINUTE, RowBudget, type SessionRecord,
} from './analytics'
import { PresenceReporter } from './presenceReporter'
import { ATTACHMENT_PAUSE_MS, CLOCK_MS, type Peer, Room, type RoomSnapshot } from './room'
import { REJOIN_GRACE } from '../src/modes/params'
import { roomName } from './util'
import { channelOf } from '../shared/channel'
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
  /** Launch analytics dataset (server/analytics.ts); absent in tests and local runs that omit it. */
  ANALYTICS?: AnalyticsSink
  /** SHA-256 (hex) of the creator key, a wrangler secret; unset turns the creator role off. */
  CREATOR_KEY_SHA256?: string
  /** Comma-separated names only the creator may take (server/creator.ts); empty is fine. */
  CREATOR_RESERVED_NAMES?: string
}

interface Attachment {
  room: string
  info?: PlayerInfo
  /** The player's rejoin secret (game.rejoin), so it survives hibernation with the socket. */
  token?: string | null
  /** Launch analytics: the player's session (Room.sessionOf) and its version, kept for a wake. */
  session?: SessionRecord
  sv?: number
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
    // Production hosts get exactly what route() answers. Beta hosts (shared/channel.ts) are never
    // indexed and share themselves, not production (forBeta).
    if (channelOf(url.hostname) !== 'beta') return route(req, env, url)
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' } })
    return forBeta(await route(req, env, url), url.origin)
  },
}

/**
 * A beta host's response (beta.mira.cc, a workers.dev address): HTML says noindex, and the page's
 * absolute production addresses (the share card's og:url and og:image in index.html, the
 * unknown-version page's list) name this host instead, so nothing a beta tester shares points at
 * mira.cc. A WebSocket upgrade passes through untouched.
 */
export async function forBeta(res: Response, origin: string): Promise<Response> {
  if (res.status === 101 || (res as { webSocket?: unknown }).webSocket) return res
  const type = res.headers.get('content-type') ?? ''
  const html = /^text\/html\b/i.test(type)
  if (!html && !/^text\/plain\b/i.test(type)) return res
  const headers = new Headers(res.headers)
  if (html) headers.set('x-robots-tag', 'noindex')
  if (!res.body) return new Response(null, { status: res.status, statusText: res.statusText, headers })
  const text = (await res.text()).replaceAll('https://mira.cc/', origin + '/')
  headers.delete('content-length')
  return new Response(text, { status: res.status, statusText: res.statusText, headers })
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/ws') {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket', { status: 426 })
    }
    const name = roomName(url.searchParams.get('room'))
    // Where the connection came from, for analytics: request.cf's country and continent codes
    // and the channel by hostname, never the address. Only this Worker sets the header.
    const headers = new Headers(req.headers)
    headers.set(GEO_HEADER, geoHeader(geoOf((req as Request & { cf?: unknown }).cf, channelOf(url.hostname))))
    return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(new Request(req, { headers }))
  }
  // Client crash and health reports (src/net/analytics.ts): small, rate limited, never awaited.
  if (url.pathname === '/e') return clientPost(req, url, env)
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
}

/** Per isolate, in memory only: see PostLimiter. */
const postLimiter = new PostLimiter(() => Date.now())

/**
 * POST /e?k=<key>: one client crash or health report. Always 204 (413 for a body declared too
 * large); nothing about it reaches play. In order, before any body is read: analytics bound,
 * a valid key, the declared length, the per-key and per-isolate limits. The body is then read
 * with a hard cap that cancels the stream at POST_MAX_BYTES, so no post is ever buffered whole.
 */
async function clientPost(req: Request, url: URL, env: Env): Promise<Response> {
  const done = (status = 204) => { void req.body?.cancel().catch(() => {}); return new Response(null, { status, headers: { 'cache-control': 'no-store' } }) }
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: { allow: 'POST' } })
  try {
    if (!env.ANALYTICS) return done()
    const key = postKey(url.searchParams.get('k'))
    if (!key) return done()
    if (Number(req.headers.get('content-length') ?? 0) > POST_MAX_BYTES) return done(413)
    if (!postLimiter.allow(key)) return done()
    const text = await readCapped(req.body, POST_MAX_BYTES)
    if (text === null) return done(413)
    const channel = channelOf(url.hostname)
    const post = cleanClientPost(JSON.parse(text), key, geoOf((req as Request & { cf?: unknown }).cf, channel), channel)
    if (post) env.ANALYTICS.writeDataPoint(dataPoint(post.row.event, post.row.common, post.row.extra))
  } catch { /* a malformed post or a failed write changes nothing */ }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
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
  /** When each socket's attachment last took a pause change (ms): see ATTACHMENT_PAUSE_MS. */
  private readonly pauseWrittenAt = new WeakMap<WebSocket, number>()
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
  /** This world's banishes as stored (server/banish.ts), read before the room is made. */
  private banishes: unknown

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.snapshot = await state.storage.get<RoomSnapshot>('room')
      // Banishes are kept apart from the snapshot (server/banish.ts): a world's reset never clears them.
      this.banishes = await state.storage.get('banishes')
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
    // The channel its players connected through (launch analytics' presence rows), if known.
    this.state.waitUntil(this.reporter.report({ room: room.name, ...presence, ...(this.channel ? { channel: this.channel } : {}) }, seed))
  }

  /** Only on the registry instance: the counts, loaded from storage on first use. */
  private registryReady: Promise<RoomRegistry> | null = null
  /** Only on the registry instance: when the counts were last stored (ms), see ACTIVE_SAVE_MS. */
  private countsSavedAt = -Infinity
  /** Only on the registry instance: when the last presence snapshot was written (ms). */
  private presenceAt = -Infinity
  /**
   * Only on the registry instance, in memory: each room's channel, from its reports, and when.
   * Kept only with the analytics binding; a room reporting nobody is forgotten at once, and the
   * rest are pruned by age (STALE_MS) at most once a minute, snapshot or not.
   */
  private readonly channels = new Map<string, { channel: string; at: number }>()
  private channelsPrunedAt = 0

  private noteChannel(room: string, players: number, channel: unknown): void {
    if (!this.env.ANALYTICS) return
    const now = Date.now()
    if (players <= 0) this.channels.delete(room)
    else if (channel === 'beta' || channel === 'production') this.channels.set(room, { channel, at: now })
    if (now - this.channelsPrunedAt >= 60_000) {
      this.channelsPrunedAt = now
      for (const [r, c] of this.channels) if (now - c.at > STALE_MS) this.channels.delete(r)
    }
  }
  /** On a room: the channel its latest connection came through (GEO_HEADER). */
  private channel = ''

  /**
   * Launch analytics: players and active players per planet, at most once per
   * PRESENCE_SNAPSHOT_MS, on report traffic (no timer: with nobody playing there is nothing
   * to write, and zero is read from the absence). At most one row per planet and channel
   * (a dozen or so), the channel being the one each room's players connected through.
   */
  private presenceSnapshot(registry: RoomRegistry): void {
    const now = Date.now()
    if (!this.env.ANALYTICS || now - this.presenceAt < PRESENCE_SNAPSHOT_MS) return
    this.presenceAt = now
    try {
      // One row per planet and channel (the channel each room's players connected through).
      const groups = new Map<string, { recipe: string; channel: string; players: number; active: number; rooms: number }>()
      for (const [room, e] of registry.live(now)) {
        const channel = this.channels.get(room)?.channel ?? '', recipe = e.recipeId ?? ''
        const g = groups.get(`${recipe} ${channel}`) ?? { recipe, channel, players: 0, active: 0, rooms: 0 }
        g.players += e.players; g.active += e.active ?? e.players; g.rooms++
        groups.set(`${recipe} ${channel}`, g)
      }
      for (const g of [...groups.values()].slice(0, 50)) {
        this.env.ANALYTICS.writeDataPoint(dataPoint('presence', { channel: g.channel, build: '', recipe: g.recipe, roomKind: '', device: '', backend: '', country: '', continent: '', aid: '' },
          { players: g.players, active: g.active, rooms: g.rooms }))
      }
    } catch { /* never affects the registry */ }
  }

  /** Launch analytics rows this room object writes, bounded per minute (server/analytics.ts). */
  // (Class fields initialise before the constructor's parameters are assigned: read env late.)
  private readonly rows = new RowBudget(ROOM_ROWS_PER_MINUTE, () => Date.now(), { writeDataPoint: (p) => this.env.ANALYTICS?.writeDataPoint(p) },
    (error) => logError('error', error, { where: 'analytics', room: this.tag() }))

  /** The registry instance's two requests; see REGISTRY_ID. */
  private async registryFetch(req: Request, path: string): Promise<Response> {
    this.registryReady ??= this.state.storage.get<Record<string, RegistryEntry>>('counts').then(saved => new RoomRegistry(saved))
    const registry = await this.registryReady
    if (path === '/report' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { room?: unknown; players?: unknown; recipeId?: unknown; active?: unknown; channel?: unknown } | null
      if (body && typeof body.room === 'string' && typeof body.players === 'number') {
        const durability = registry.report(body.room, body.players, Date.now(), body.recipeId, body.active)
        this.noteChannel(body.room, body.players, body.channel)
        this.presenceSnapshot(registry)
        if (durability === 'save' || (durability === 'later' && Date.now() - this.countsSavedAt >= ACTIVE_SAVE_MS)) {
          this.countsSavedAt = Date.now()
          await this.state.storage.put('counts', registry.save())
        }
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
    const geo = geoFromHeader(req.headers.get(GEO_HEADER))
    if (geo.channel) this.channel = geo.channel
    room.setGeo(this.peer(server), geo)
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
        if (info) {
          const kept = room.sessionOf(peer)
          ws.serializeAttachment({ ...att, info, token: room.token(peer), ...(room.pausedOf(peer) ? { paused: true } : {}), ...(kept ? { session: kept.session, sv: kept.version } : {}) } satisfies Attachment)
        }
      } else {
        // Cheap checks first (a bit and a number); the session is copied only when a rewrite is due.
        const version = room.sessionVersionOf(peer)
        if ((room.pausedOf(peer) !== Boolean(att.paused) || (version >= 0 && version !== att.sv)) && Date.now() - (this.pauseWrittenAt.get(ws) ?? 0) >= ATTACHMENT_PAUSE_MS) {
          // Pausing, resuming or a vehicle change: kept with the socket for a hibernation wake.
          // At most one rewrite per socket per ATTACHMENT_PAUSE_MS, however fast a client flips;
          // the latest value goes with the first message after that (a paused page sends one a second).
          const kept = room.sessionOf(peer)
          const { paused: _was, session: _s, sv: _v, ...rest } = att
          ws.serializeAttachment({ ...rest, ...(room.pausedOf(peer) ? { paused: true } : {}), ...(kept ? { session: kept.session, sv: kept.version } : {}) } satisfies Attachment)
          this.pauseWrittenAt.set(ws, Date.now())
        }
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
    // Evicted with only held places: they have all expired, so their sessions end here, as of
    // when the room last saved them (Room's analytics comment lists every ending).
    if (!room) this.endRosterSessions()
    if (!room || room.connectionCount === 0) {
      logEvent('room_cleanup', { room: this.tag(), reason: 'holds_expired' })
      await this.state.storage.deleteAll()
      this.snapshot = undefined
    }
  }

  private endRosterSessions(): void {
    try {
      for (const entry of this.snapshot?.roster ?? []) {
        if (!entry.session) continue
        for (const row of endRows(entry.session, entry.at)) this.rows.write(row.event, row.common, row.extra)
      }
    } catch { /* never affects the room */ }
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
    const room = new Room(name, {
      onPersist: (s) => void this.state.storage.put('room', s),
      banishes: this.banishes,
      onBanishes: (list) => void this.state.storage.put('banishes', list),
      // No binding, no analytics work at all: no sessions, copies or extra roster saves.
      analytics: this.env.ANALYTICS ? (event, common, extra) => { this.rows.write(event, common, extra) } : undefined,
      creatorKeySha256: this.env.CREATOR_KEY_SHA256, reservedNames: this.env.CREATOR_RESERVED_NAMES,
    })
    if (this.snapshot) room.restore(this.snapshot)
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.info) room.adopt(this.peer(ws), att.info, att.token, att.paused === true, att.session)
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
