/**
 * Launch analytics written by our own server into Workers Analytics Engine (wrangler.toml
 * [[analytics_engine_datasets]], binding ANALYTICS, dataset mira_events). Answers the owner's
 * questions: how many people play, for how long, on which worlds and vehicles, from which
 * continents and countries, on phones or desktops, and how healthy it is.
 *
 * Privacy, by construction:
 *  - No IP address is read, kept or logged anywhere here. Geography is request.cf's country
 *    and continent codes, taken by the Worker at the socket upgrade.
 *  - No room name: a room is written as its kind (public, universe, private).
 *  - No player name, chat or other typed text. The anonymous id is random, made in the
 *    browser, tied to nothing, and only ever sent to our own server.
 *  - Crash rows carry a truncated message and file:line frames with query strings removed.
 *
 * Cost, by construction (Analytics Engine bills data points written):
 *  - Nothing per frame or per state message. A session writes on start and end only.
 *  - A player costs at most 2 + VEHICLE_KINDS rows per session (start, end, one row per vehicle
 *    kind used, at most 6), and each room object writes at most ROOM_ROWS_PER_MINUTE rows a
 *    minute whatever its clients do (RowBudget): a reconnect loop cannot flood the dataset.
 *  - The registry writes at most one presence row per planet per PRESENCE_SNAPSHOT_MS.
 *  - Client posts (POST /e) are capped in the page and per key in each Worker isolate.
 *
 * An analytics failure never affects play: writeDataPoint is not awaited, and every write is
 * inside try/catch.
 *
 * Columns (Analytics Engine: blob1..20, double1..20, index1). index1 and blob1 are the event.
 *   blob2 channel, blob3 build, blob4 world recipe, blob5 room kind, blob6 device, blob7
 *   backend, blob8 country, blob9 continent, blob10 anonymous id, blob11 vehicle or kind,
 *   blob12 message, blob13 stack hash, blob14 top frames, blob15 vehicle (crash), blob16 ref,
 *   blob17 error name (shared/crashText.ts: crash rows are structured, never free text).
 *   double1 seconds, double2 active seconds, double3 quality level, double4 count,
 *   double5 players, double6 active players, double7 rooms.
 * Every count must be read as sum(_sample_interval) (Analytics Engine samples under load).
 */
import { VEHICLE_KINDS } from '../shared/protocol'
import { cleanFrames, errorName, reduceMessage } from '../shared/crashText'

/** The binding as this code uses it. */
export interface AnalyticsSink {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export type EventName = 'session_start' | 'session_end' | 'vehicle' | 'presence' | 'room_full' | 'client' | 'crash' | 'dropped'

/** Fields common to rows about one player. Empty strings where unknown. */
export interface Common {
  channel: string
  build: string
  recipe: string
  roomKind: string
  device: string
  backend: string
  country: string
  continent: string
  aid: string
}
export const EMPTY_COMMON: Common = { channel: '', build: '', recipe: '', roomKind: '', device: '', backend: '', country: '', continent: '', aid: '' }

export interface Extra {
  vehicle?: string
  message?: string
  stack?: string
  frames?: string
  crashVehicle?: string
  ref?: string
  errorName?: string
  seconds?: number
  activeSeconds?: number
  quality?: number
  count?: number
  players?: number
  active?: number
  rooms?: number
}

/** One data point in the column layout above. */
export function dataPoint(event: EventName, c: Common, x: Extra = {}): { blobs: string[]; doubles: number[]; indexes: string[] } {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    indexes: [event],
    blobs: [event, c.channel, c.build, c.recipe, c.roomKind, c.device, c.backend, c.country, c.continent, c.aid,
      x.vehicle ?? '', x.message ?? '', x.stack ?? '', x.frames ?? '', x.crashVehicle ?? '', x.ref ?? '', x.errorName ?? ''],
    doubles: [n(x.seconds), n(x.activeSeconds), n(x.quality), n(x.count), n(x.players), n(x.active), n(x.rooms)],
  }
}

/** Rows a room object may write per minute, whatever its clients do. */
export const ROOM_ROWS_PER_MINUTE = 240
/** Rows a session can cost: start, end, and one per vehicle kind. */
export const MAX_ROWS_PER_SESSION = 2 + VEHICLE_KINDS.length

/**
 * A token bucket of rows per minute. Rows over budget are dropped and counted; the count is
 * written as one "dropped" row when the budget next allows, so a flood is visible but bounded.
 */
export class RowBudget {
  private tokens: number
  private at: number
  private dropped = 0
  constructor(private readonly perMinute: number, private readonly now: () => number, private readonly sink: AnalyticsSink | undefined) {
    this.tokens = perMinute
    this.at = now()
  }

  write(event: EventName, c: Common, x?: Extra): boolean {
    if (!this.sink) return false
    const t = this.now()
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.at) * this.perMinute) / 60_000)
    this.at = t
    if (this.tokens < 1) { this.dropped++; return false }
    try {
      if (this.dropped && this.tokens >= 2) {
        this.tokens--
        this.sink.writeDataPoint(dataPoint('dropped', c, { count: this.dropped }))
        this.dropped = 0
      }
      this.tokens--
      this.sink.writeDataPoint(dataPoint(event, c, x))
      return true
    } catch {
      return false // Analytics never affects play.
    }
  }
}

/**
 * The kind of room, never its name. Public: the public room ("lobby"), overflow public rooms
 * ("lobby#2" ...) and per-planet public rooms ("public-<recipe>"). Universe: a parallel
 * universe ("p-" and 22 base-36 characters, src/net/parallel.ts). Anything else is private.
 */
export function roomKind(name: string): 'public' | 'universe' | 'private' {
  if (name === 'lobby' || /^lobby#\d{1,2}$/.test(name) || /^public-[a-z0-9-]{1,24}$/.test(name)) return 'public'
  if (/^p-[a-z0-9]{22}$/.test(name)) return 'universe'
  return 'private'
}

/**
 * Beta on beta.* and any workers.dev address (the staging Worker); production elsewhere.
 * A copy of feat/beta-channel's rule (shared/channel.ts channelOf), kept here so the two
 * branches do not depend on each other: when both have merged, keep shared/channel.ts and
 * import it here instead.
 */
export function channelOf(hostname: string): 'beta' | 'production' {
  const h = hostname.toLowerCase()
  return h.startsWith('beta.') || h.endsWith('.workers.dev') ? 'beta' : 'production'
}

// ---------------------------------------------------------------------------------------------
// What a client says about itself (hello), and where it is (the Worker, from request.cf).

export interface ClientFacts { aid: string; build: string; device: string; backend: string; quality: number; ref: string }
export const NO_FACTS: ClientFacts = { aid: '', build: '', device: '', backend: '', quality: -1, ref: '' }

const word = (v: unknown, pattern: RegExp): string => (typeof v === 'string' && pattern.test(v) ? v : '')

/** The hello's analytics fields, each checked against a strict shape; anything else is dropped. */
export function cleanFacts(hello: { aid?: unknown; build?: unknown; device?: unknown; backend?: unknown; quality?: unknown; ref?: unknown }): ClientFacts {
  return {
    aid: word(hello.aid, /^[0-9a-f]{32}$/),
    build: word(hello.build, /^[0-9A-Za-z.+_-]{1,40}$/),
    device: word(hello.device, /^(phone|tablet|desktop)$/),
    backend: word(hello.backend, /^(webgpu|webgl2)$/),
    quality: Number.isInteger(hello.quality) && (hello.quality as number) >= 0 && (hello.quality as number) <= 5 ? (hello.quality as number) : -1,
    ref: cleanRef(hello.ref),
  }
}

/** A campaign tag: lower-case letters, digits and dash, at most 24 characters; else empty. */
export function cleanRef(v: unknown): string {
  return word(v, /^[a-z0-9-]{1,24}$/)
}

/** Where a connection came from: request.cf's codes, and the channel by the hostname asked. */
export interface Geo { country: string; continent: string; channel: string }
export const NO_GEO: Geo = { country: '', continent: '', channel: '' }
/** The header in which the Worker passes a connection's Geo to a room object. Stripped from callers. */
export const GEO_HEADER = 'x-mira-geo'

/** request.cf's country (ISO 3166-1 alpha-2, or T1 for Tor, XX unknown) and continent codes only. */
export function geoOf(cf: unknown, channel = ''): Geo {
  const c = (cf ?? {}) as { country?: unknown; continent?: unknown }
  return { country: word(c.country, /^[A-Z][A-Z0-9]$/), continent: word(c.continent, /^[A-Z]{2}$/), channel: word(channel, /^(beta|production)$/) }
}
export const geoHeader = (g: Geo): string => `${g.country},${g.continent},${g.channel}`
export function geoFromHeader(v: string | null): Geo {
  const [country = '', continent = '', channel = ''] = (v ?? '').split(',')
  return geoOf({ country, continent }, channel)
}

// ---------------------------------------------------------------------------------------------
// One player's session: time connected, time active (not paused), time in each vehicle.

/**
 * Serializable, so it survives a hibernation wake (the socket attachment) and a release (the
 * room's roster). Times are server ms.
 */
export interface SessionRecord {
  start: number
  recipe: string
  roomKind: string
  facts: ClientFacts
  geo: Geo
  /** Active ms banked, and since when the player has been active (0: paused now). */
  activeMs: number
  activeSince: number
  /** Ms banked per vehicle kind, switches to each, and the current kind since when. */
  kindMs: Record<string, number>
  switches: Record<string, number>
  kind: string
  kindSince: number
  rejoins: number
}

export function startSession(now: number, recipe: string, roomKind: string, facts: ClientFacts, geo: Geo, kind: string): SessionRecord {
  return { start: now, recipe, roomKind, facts, geo, activeMs: 0, activeSince: now, kindMs: {}, switches: {}, kind, kindSince: now, rejoins: 0 }
}

/** The player paused or resumed (call only on a change; O(1), no writes). */
export function sessionPaused(s: SessionRecord, now: number, paused: boolean): void {
  if (paused && s.activeSince) { s.activeMs += Math.max(0, now - s.activeSince); s.activeSince = 0 }
  else if (!paused && !s.activeSince) s.activeSince = now
}

/** The player changed vehicle. */
export function sessionKind(s: SessionRecord, now: number, kind: string): void {
  if (kind === s.kind) return
  s.kindMs[s.kind] = (s.kindMs[s.kind] ?? 0) + Math.max(0, now - s.kindSince)
  s.switches[kind] = (s.switches[kind] ?? 0) + 1
  s.kind = kind
  s.kindSince = now
}

/** A copy safe to store, with no live clocks: banked up to `now`, clocks restarted at `now`. */
export function sessionSnapshot(s: SessionRecord, now: number): SessionRecord {
  const copy: SessionRecord = structuredClone(s)
  if (copy.activeSince) { copy.activeMs += Math.max(0, now - copy.activeSince); copy.activeSince = now }
  copy.kindMs[copy.kind] = (copy.kindMs[copy.kind] ?? 0) + Math.max(0, now - copy.kindSince)
  copy.kindSince = now
  return copy
}

/** A stored record as read back: anything malformed is null. */
export function cleanSession(v: unknown): SessionRecord | null {
  const s = v as SessionRecord | null
  if (!s || typeof s !== 'object' || !Number.isFinite(s.start) || !Number.isFinite(s.activeMs) || typeof s.kind !== 'string') return null
  return { ...s, facts: cleanFacts(s.facts ?? {}), geo: geoOf(s.geo, s.geo?.channel), kindMs: { ...(s.kindMs ?? {}) }, switches: { ...(s.switches ?? {}) } }
}

/** The rows a session's end writes: session_end and one vehicle row per kind used (bounded). */
export function endRows(s: SessionRecord, now: number): { event: EventName; common: Common; extra: Extra }[] {
  const done = sessionSnapshot(s, now)
  const common = commonOf(done)
  const rows: { event: EventName; common: Common; extra: Extra }[] = [{
    event: 'session_end', common,
    extra: { seconds: (now - done.start) / 1000, activeSeconds: done.activeMs / 1000, quality: done.facts.quality, count: done.rejoins },
  }]
  for (const kind of VEHICLE_KINDS) {
    const ms = done.kindMs[kind] ?? 0
    if (ms > 0 || done.switches[kind]) rows.push({ event: 'vehicle', common, extra: { vehicle: kind, seconds: ms / 1000, count: done.switches[kind] ?? 0 } })
  }
  return rows
}

export function commonOf(s: SessionRecord): Common {
  return {
    channel: s.geo.channel, build: s.facts.build, recipe: s.recipe, roomKind: s.roomKind, device: s.facts.device,
    backend: s.facts.backend, country: s.geo.country, continent: s.geo.continent, aid: s.facts.aid,
  }
}

// ---------------------------------------------------------------------------------------------
// The registry's once-a-minute presence snapshot.

export const PRESENCE_SNAPSHOT_MS = 60_000

// ---------------------------------------------------------------------------------------------
// Client posts: crashes and health events (POST /e).

export const CLIENT_EVENTS = ['physics_retry', 'physics_fail', 'ws_fail'] as const
export const CRASH_TYPES = ['device_lost', 'error', 'rejection', 'physics_wasm', 'ws_connect'] as const
/** Per key (the anonymous id, or the page's own random key) per isolate, per minute. */
export const CLIENT_POSTS_PER_KEY_PER_MINUTE = 10
/** All keys together, per isolate, per minute. */
export const CLIENT_POSTS_PER_MINUTE = 300


export interface ClientPost {
  key: string
  row: { event: EventName; common: Common; extra: Extra }
}

/**
 * A client's POST /e body, cleaned to a row, or null. Accepts only known event and crash types;
 * every field is checked or dropped. Geography and channel come from the Worker, not the body.
 */
export function cleanClientPost(body: unknown, rawKey: unknown, geo: Geo, channel: string): ClientPost | null {
  const b = (body ?? {}) as Record<string, unknown>
  const key = postKey(rawKey)
  if (!key) return null
  const facts = cleanFacts(b)
  const common: Common = {
    channel, build: facts.build, recipe: word(b.recipe, /^[a-z0-9-]{1,32}$/), roomKind: '', device: facts.device,
    backend: facts.backend, country: geo.country, continent: geo.continent, aid: facts.aid,
  }
  if (b.type === 'crash') {
    const kind = word(b.kind, new RegExp(`^(${CRASH_TYPES.join('|')})$`))
    if (!kind) return null
    return { key, row: { event: 'crash', common, extra: {
      vehicle: kind, errorName: errorName(b.name), message: reduceMessage(b.message), stack: word(b.stack, /^[0-9a-f]{8}$/),
      frames: cleanFrames(b.frames), crashVehicle: word(b.vehicle, /^[a-z-]{1,20}$/), quality: facts.quality,
    } } }
  }
  if (b.type === 'event') {
    const kind = word(b.kind, new RegExp(`^(${CLIENT_EVENTS.join('|')})$`))
    if (!kind) return null
    const attempt = Number.isInteger(b.attempt) && (b.attempt as number) >= 0 && (b.attempt as number) < 1000 ? (b.attempt as number) : 0
    return { key, row: { event: 'client', common, extra: { vehicle: kind, seconds: attempt } } }
  }
  return null
}

/** The client's rate key (?k= on /e): its anonymous id or its page's own random key. */
export function postKey(v: unknown): string {
  return word(v, /^[0-9a-f]{16,32}$/)
}

/** A client post's body is read only up to this many bytes; longer posts are abandoned. */
export const POST_MAX_BYTES = 4096

/**
 * The body as text, stopping and cancelling the stream at `max` bytes: null if it is longer.
 * Never buffers more than `max` plus one chunk.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max = POST_MAX_BYTES): Promise<string | null> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) { await reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

/**
 * In-memory, per-isolate limits for client posts. Keys are the client's own random key or
 * anonymous id, never anything derived from the network address. Nothing here is written.
 */
export class PostLimiter {
  private readonly counts = new Map<string, number>()
  private total = 0
  private window = 0
  constructor(private readonly now: () => number) {}

  allow(key: string): boolean {
    const minute = Math.floor(this.now() / 60_000)
    if (minute !== this.window) { this.window = minute; this.counts.clear(); this.total = 0 }
    const n = this.counts.get(key) ?? 0
    if (n >= CLIENT_POSTS_PER_KEY_PER_MINUTE || this.total >= CLIENT_POSTS_PER_MINUTE) return false
    this.counts.set(key, n + 1)
    this.total++
    return true
  }
}
