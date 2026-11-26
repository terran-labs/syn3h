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
import { cleanFeatureCodes, GPU_VENDORS, MODEL_PATTERN } from '../shared/gpu'

/** The binding as this code uses it. */
export interface AnalyticsSink {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export type EventName = 'session_start' | 'session_end' | 'vehicle' | 'presence' | 'room_full' | 'client' | 'crash' | 'dropped' | 'device' | 'perf'

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
  /** Device and perf rows: blobs 11 to 20 and doubles 1 to 20 given whole (DEVICE_COLUMNS, PERF_COLUMNS). */
  b?: string[]
  d?: number[]
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
  const common = [event, c.channel, c.build, c.recipe, c.roomKind, c.device, c.backend, c.country, c.continent, c.aid]
  return {
    indexes: [event],
    blobs: x.b ? [...common, ...x.b.slice(0, 10)] : [...common,
      x.vehicle ?? '', x.message ?? '', x.stack ?? '', x.frames ?? '', x.crashVehicle ?? '', x.ref ?? '', x.errorName ?? ''],
    doubles: x.d ? x.d.slice(0, 20).map(n) : [n(x.seconds), n(x.activeSeconds), n(x.quality), n(x.count), n(x.players), n(x.active), n(x.rooms)],
  }
}

/** Rows a room object may write per minute, whatever its clients do. */
export const ROOM_ROWS_PER_MINUTE = 240
/** Rows a session can cost in its room: start, its device row, end, and one per vehicle kind. */
export const MAX_ROWS_PER_SESSION = 3 + VEHICLE_KINDS.length

/**
 * A token bucket of rows per minute. Rows over budget are dropped and counted; the count is
 * written as one "dropped" row when the budget next allows, so a flood is visible but bounded.
 */
export class RowBudget {
  private tokens: number
  private at: number
  private dropped = 0
  /** Told of the first failed write only (a log line; a failing dataset must not flood logs). */
  private failed = false
  constructor(private readonly perMinute: number, private readonly now: () => number, private readonly sink: AnalyticsSink | undefined,
    private readonly onFirstFailure: (error: unknown) => void = () => {}) {
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
    } catch (error) {
      // Analytics never affects play. The first failure is reported once, so a binding that
      // does not work (on a room object, say) shows in the logs instead of losing rows silently.
      if (!this.failed) { this.failed = true; try { this.onFirstFailure(error) } catch { /* nothing */ } }
      return false
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

/** Beta on beta.* and any workers.dev address (the staging Worker); production elsewhere: shared/channel.ts, the one rule. */
export { channelOf } from '../shared/channel'

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
/**
 * Where a connection comes from, never finer than a first-level region (a US state): the roster
 * shows "Texas, USA" (feat/player-info-and-eject), analytics counts country and continent. geoOf
 * is the one allowlist: city, postal code, coordinates, timezone, ASN, IP and the rest of
 * request.cf never get past it.
 */
export interface Geo { country: string; continent: string; channel: string; region: string; regionCode: string }
export const NO_GEO: Geo = { country: '', continent: '', channel: '', region: '', regionCode: '' }
/** The header in which the Worker passes a connection's Geo to a room object. Stripped from callers. */
export const GEO_HEADER = 'x-mira-geo'

/** request.cf's country (ISO 3166-1 alpha-2, or T1 for Tor, XX unknown) and continent codes only. */
export function geoOf(cf: unknown, channel = ''): Geo {
  const c = (cf ?? {}) as { country?: unknown; continent?: unknown; region?: unknown; regionCode?: unknown }
  return {
    country: word(c.country, /^[A-Z][A-Z0-9]$/), continent: word(c.continent, /^[A-Z]{2}$/), channel: word(channel, /^(beta|production)$/),
    region: word(c.region, /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]{0,39}$/u), regionCode: word(c.regionCode, /^[A-Z0-9]{1,3}$/),
  }
}
// The region is percent-encoded: a header carries bytes, and region names are not always Latin-1.
export const geoHeader = (g: Geo): string => `${g.country},${g.continent},${g.channel},${g.regionCode},${encodeURIComponent(g.region)}`
export function geoFromHeader(v: string | null): Geo {
  const [country = '', continent = '', channel = '', regionCode = '', region = ''] = (v ?? '').split(',')
  let name = ''
  try { name = decodeURIComponent(region) } catch { /* a malformed header names no region */ }
  return geoOf({ country, continent, regionCode, region: name }, channel)
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
  if (b.type === 'perf') {
    const perf = cleanPerf(b.perf)
    return perf ? { key, row: { event: 'perf', common, extra: perf } } : null
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

// ---------------------------------------------------------------------------------------------
// Device and rendering (the owner: "what share of players can run feature X, and how well does
// the game actually run for them"). One device row per session, from the hello; at most one
// perf row per page, posted by the client. Every field is an enum, a strict pattern or a
// bucketed number; anything else is dropped.
//
// Deliberately NOT collected: canvas, WebGL-readback or audio fingerprints; font lists; the
// full user agent; OS and browser versions; exact screen pixels (100 px buckets only);
// timezone and languages; battery; network information; plugins; raw GPU driver strings (a
// cleaned model family only, shared/gpu.ts); Android model names (display-only on the
// players card, shared/device.ts).

/** Device row: blobs 11 to 20, then doubles 1 to 8. */
export const DEVICE_COLUMNS = {
  blobs: ['gpuVendor', 'gpuModel', 'gpuSource', 'backendReason', 'adapterProbe', 'features', 'gamut', 'hdr', 'pointer', 'motion'],
  doubles: ['memoryGB', 'cores', 'startLevel', 'maxTexture', 'cssWidth100', 'cssHeight100', 'dpr', 'reserved'],
} as const
/** Perf row: blobs 11 and 12, then doubles 1 to 12. */
export const PERF_COLUMNS = {
  blobs: ['gpuVendor', 'gpuModel'],
  doubles: ['startLevel', 'settledLevel', 'auto', 'medianMs', 'p95Ms', 'windows', 'shadowQuality', 'liquidGlass', 'postTier', 'longFrames', 'fpsCeiling', 'playSeconds'],
} as const

const BACKEND_REASONS = ['forced-webgl2', 'webgpu', 'adapter-timeout', 'adapter-missing', 'webgpu-unsupported', 'webgpu-start-timeout', 'webgpu-start-failed', 'webgpu-device-failed']
const PROBES = ['available', 'fallback', 'missing', 'timeout', 'rejected', 'unsupported']
const oneOf = (v: unknown, list: readonly string[]): string => (typeof v === 'string' && list.includes(v) ? v : '')
const num = (v: unknown, ok: (n: number) => boolean): number => (typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : 0)
const intIn = (lo: number, hi: number) => (n: number) => Number.isInteger(n) && n >= lo && n <= hi
const step = (s: number, lo: number, hi: number) => (n: number) => n >= lo && n <= hi && Math.abs(n / s - Math.round(n / s)) < 1e-9

/** The hello's `dev` object, cleaned to the device row's columns, or null when absent. */
export function cleanDevice(v: unknown): { b: string[]; d: number[] } | null {
  if (!v || typeof v !== 'object') return null
  const x = v as Record<string, unknown>
  const vendor = oneOf(x.vendor, GPU_VENDORS) || 'unknown'
  const model = typeof x.model === 'string' && MODEL_PATTERN.test(x.model) ? x.model : ''
  return {
    b: [vendor, model, oneOf(x.source, ['webgpu', 'webgl', 'none']), oneOf(x.reason, BACKEND_REASONS), oneOf(x.probe, PROBES),
      cleanFeatureCodes(x.features) ?? '', oneOf(x.gamut, ['srgb', 'p3', 'rec2020']), oneOf(x.hdr, ['high', 'standard']),
      oneOf(x.pointer, ['coarse', 'fine', 'none']), oneOf(x.motion, ['reduce', 'no-preference'])],
    d: [
      num(x.mem, (n) => [0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(n)), num(x.cores, intIn(1, 256)), num(x.start, intIn(0, 5)),
      num(x.maxTex, (n) => [2048, 4096, 8192, 16384, 32768].includes(n)), num(x.w, intIn(1, 100)), num(x.h, intIn(1, 100)),
      num(x.dpr, step(0.25, 0.25, 6)), 0,
    ],
  }
}

/** A client's perf post, cleaned to the perf row's columns, or null. */
export function cleanPerf(v: unknown): { b: string[]; d: number[] } | null {
  if (!v || typeof v !== 'object') return null
  const x = v as Record<string, unknown>
  const windows = num(x.windows, intIn(1, 100000))
  if (!windows) return null
  return {
    b: [oneOf(x.vendor, GPU_VENDORS) || 'unknown', typeof x.model === 'string' && MODEL_PATTERN.test(x.model) ? x.model : ''],
    d: [
      num(x.start, intIn(0, 5)), num(x.settled, intIn(0, 5)), num(x.auto, intIn(0, 1)), num(x.medianMs, step(0.5, 0.5, 1000)),
      num(x.p95Ms, intIn(1, 5000)), windows, num(x.shadow, intIn(0, 5)), num(x.glass, intIn(0, 1)), num(x.post, intIn(0, 5)),
      num(x.longFrames, intIn(0, 1_000_000)), num(x.fps, (n) => [30, 60, 90, 120, 144].includes(n)), num(x.seconds, intIn(0, 86_400)),
    ],
  }
}
