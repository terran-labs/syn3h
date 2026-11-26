/**
 * Launch analytics on the server (server/analytics.ts and its hooks in server/room.ts and
 * server/worker.ts). Each test names the bug it catches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AnalyticsSink, cleanClientPost, cleanFacts, dataPoint, GEO_HEADER, geoFromHeader, geoOf, MAX_ROWS_PER_SESSION,
  PostLimiter, CLIENT_POSTS_PER_KEY_PER_MINUTE, CLIENT_POSTS_PER_MINUTE, ROOM_ROWS_PER_MINUTE, roomKind, RowBudget, channelOf,
} from '../../server/analytics'
import { type Peer, Room, type RoomSnapshot } from '../../server/room'
import worker, { RoomDO } from '../../server/worker'
import { sessionPaused } from '../../server/analytics'
import { encodeState, PROTOCOL_VERSION } from '../../shared/protocol'
import { REJOIN_GRACE } from '../../src/modes/params'
import { emptyInputLike } from './helpers'

type Row = { event: string; blobs: string[]; doubles: number[] }
const recorder = () => {
  const rows: Row[] = []
  const sink: AnalyticsSink = { writeDataPoint: (p) => { rows.push({ event: p.blobs![0], blobs: p.blobs!, doubles: p.doubles! }) } }
  return { rows, sink }
}
const AID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'analytics-test-token-12345678'
const hello = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: { 'game.rejoin': true }, ...extra })
const state = (paused: boolean) =>
  encodeState({ id: 0, t: 1, p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused })
const peer = (): Peer => ({ send() {}, close() {} })

/** A room whose analytics go straight to a recorder through the same bounded writer the Worker uses. */
function analyticsRoom(name: string, clock: { now: number }, onPersist?: (s: RoomSnapshot) => void) {
  const { rows, sink } = recorder()
  const budget = new RowBudget(ROOM_ROWS_PER_MINUTE, () => clock.now, sink)
  const room = new Room(name, { now: () => clock.now, onPersist, analytics: (e, c, x) => { budget.write(e, c, x) } })
  return { room, rows }
}
const by = (rows: Row[], event: string) => rows.filter((r) => r.event === event)

afterEach(() => vi.restoreAllMocks())

describe('what is written, and what never is', () => {
  // Bug: a room name (people type them) reaching the dataset, or two branches classifying the
  // same room differently (overflow lobby#2, per-planet public-<recipe>, universes p-...).
  it('classifies rooms by kind, never by name', () => {
    for (const n of ['lobby', 'lobby#2', 'lobby#64', 'public-alpine', 'public-desert-dunes']) expect(roomKind(n)).toBe('public')
    expect(roomKind('p-' + 'a1'.repeat(11))).toBe('universe')
    for (const n of ['friends', 'lobby-2', 'p-short', 'public-', 'publicalpine', 'p-' + 'A'.repeat(22)]) expect(roomKind(n)).toBe('private')
  })

  // Bug: a hostile hello writing arbitrary text (a name, a URL) into the dataset.
  it('keeps only well-formed client facts and campaign tags', () => {
    expect(cleanFacts({ aid: AID, build: '26.11.2500', device: 'phone', backend: 'webgpu', quality: 3, ref: 'email' }))
      .toEqual({ aid: AID, build: '26.11.2500', device: 'phone', backend: 'webgpu', quality: 3, ref: 'email' })
    expect(cleanFacts({ aid: 'Robert', build: '<script>', device: 'toaster', backend: 'cpu', quality: 9, ref: 'https://x.y/?a=b' }))
      .toEqual({ aid: '', build: '', device: '', backend: '', quality: -1, ref: '' })
    expect(cleanFacts({ ref: 'A'.repeat(25) }).ref).toBe('')
  })

  // Bug: an IP address or anything but the two codes leaving request.cf.
  // Region and its code came with the players card (feat/player-info-and-eject); nothing finer, ever.
  it('takes only country, continent and first-level region codes from request.cf', () => {
    expect(geoOf({ country: 'NZ', continent: 'OC', clientTcpRtt: 12, asOrganization: 'ISP', city: 'Wellington' }, 'beta')).toEqual({ country: 'NZ', continent: 'OC', channel: 'beta', region: '', regionCode: '' })
    expect(geoFromHeader('NZ,OC,production')).toEqual({ country: 'NZ', continent: 'OC', channel: 'production', region: '', regionCode: '' })
    expect(geoFromHeader('1.2.3.4,xx,anything')).toEqual({ country: '', continent: '', channel: '', region: '', regionCode: '' })
    expect(channelOf('beta.mira.cc')).toBe('beta')
    expect(channelOf('syn3h-staging.example.workers.dev')).toBe('beta')
    expect(channelOf('mira.cc')).toBe('production')
  })

  it('lays every row out in the documented columns within Analytics Engine limits', () => {
    const p = dataPoint('session_end', { channel: 'production', build: 'b', recipe: 'alpine', roomKind: 'public', device: 'phone', backend: 'webgpu', country: 'NZ', continent: 'OC', aid: AID }, { seconds: 61, activeSeconds: 50, ref: 'email' })
    expect(p.indexes).toEqual(['session_end'])
    expect(p.blobs.length).toBeLessThanOrEqual(20)
    expect(p.doubles.length).toBeLessThanOrEqual(20)
    expect(p.blobs.join('').length).toBeLessThan(16 * 1024)
    expect([p.blobs[0], p.blobs[3], p.blobs[4], p.blobs[9], p.blobs[15], p.doubles[0], p.doubles[1]]).toEqual(['session_end', 'alpine', 'public', AID, 'email', 61, 50])
  })
})

describe('bounded by construction', () => {
  // Bug: a reconnect loop or a crash loop in a room writing without limit (billed per point).
  it('a room object writes at most ROOM_ROWS_PER_MINUTE rows a minute, and says how many it dropped', () => {
    const { rows, sink } = recorder()
    let now = 0
    const budget = new RowBudget(ROOM_ROWS_PER_MINUTE, () => now, sink)
    const c = { channel: '', build: '', recipe: '', roomKind: '', device: '', backend: '', country: '', continent: '', aid: '' }
    for (let i = 0; i < 10_000; i++) { now += 6; budget.write('session_start', c) } // 10,000 in a minute
    expect(rows.length).toBeLessThanOrEqual(2 * ROOM_ROWS_PER_MINUTE + 1)
    now += 60_000; budget.write('session_start', c)
    expect(rows.some((r) => r.event === 'dropped' && r.doubles[3] > 0)).toBe(true)
  })

  // Bug: a write per state message (20 a second per player).
  it('a minute of play at 20 Hz writes nothing but each session start', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('lobby', clock)
    const peers = Array.from({ length: 4 }, () => peer())
    peers.forEach((p, i) => { room.connect(p); room.receive(p, hello('P' + i, { aid: AID })) })
    for (let t = 0; t < 1200; t++) { clock.now += 50; for (const p of peers) room.receive(p, state(t % 400 > 200)) }
    expect(rows.map((r) => r.event)).toEqual(['session_start', 'session_start', 'session_start', 'session_start'])
  })

  it('a session costs at most MAX_ROWS_PER_SESSION rows however many vehicle changes', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('lobby', clock)
    const a = peer()
    room.connect(a); room.receive(a, hello('A'))
    const kinds = ['jet', 'tank', 'hovercraft', 'buggy', 'buggy-classic', 'buggy-syn3h']
    for (let i = 0; i < 300; i++) { clock.now += 2000; room.receive(a, JSON.stringify({ type: 'profile', kind: kinds[i % kinds.length] })) }
    room.disconnect(a) // no secret: leaves at once
    expect(rows.length).toBeLessThanOrEqual(MAX_ROWS_PER_SESSION)
  })
})

describe('sessions: start, active time, vehicles, every ordinary ending', () => {
  // Bug: sessions or play time not counted, or paused time counted as active.
  it('writes start and end with time connected, time active and time per vehicle', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('lobby', clock)
    const a = peer()
    room.setGeo(a, geoOf({ country: 'NZ', continent: 'OC' }, 'production'))
    room.connect(a); room.receive(a, hello('A', { aid: AID, build: '26.11.2500', device: 'desktop', backend: 'webgpu', quality: 4, ref: 'email' }))
    clock.now += 60_000; room.receive(a, state(true)) // a minute active, then paused
    clock.now += 30_000; room.receive(a, state(false)) // 30 s paused
    clock.now += 30_000; room.receive(a, JSON.stringify({ type: 'profile', kind: 'jet' }))
    clock.now += 60_000; room.disconnect(a) // no secret: ends now
    const start = by(rows, 'session_start')[0], end = by(rows, 'session_end')[0]
    expect(start.blobs.slice(1, 10)).toEqual(['production', '26.11.2500', start.blobs[3], 'public', 'desktop', 'webgpu', 'NZ', 'OC', AID])
    expect(start.blobs[15]).toBe('email')
    expect(end.doubles[0]).toBe(180) // seconds connected
    expect(end.doubles[1]).toBe(150) // seconds active: 180 less 30 paused
    expect(Object.fromEntries(by(rows, 'vehicle').map((r) => [r.blobs[10], r.doubles[0]]))).toEqual({ buggy: 120, jet: 60 })
    expect(by(rows, 'vehicle').find((r) => r.blobs[10] === 'jet')!.doubles[3]).toBe(1)
    expect(JSON.stringify(rows)).not.toContain('"A"')
  })

  // Bug: frozen clients (no id, no facts) not counted.
  it('counts a frozen client that sends no analytics fields', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('friends', clock)
    const a = peer()
    room.connect(a); room.receive(a, hello('A'))
    expect(by(rows, 'session_start')).toHaveLength(1)
    expect(by(rows, 'session_start')[0].blobs[9]).toBe('')
    expect(by(rows, 'session_start')[0].blobs[4]).toBe('private')
  })

  // Bug: a dropped player's session ending at the hold's expiry (30 s too long), or never.
  it('a dropped player whose place expires ends at the drop; one who rejoins carries on', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('lobby', clock)
    const a = peer(), b = peer()
    room.connect(a); room.receive(a, hello('A', { resume: TOKEN }))
    clock.now += 10_000; room.disconnect(a) // held
    clock.now += 5_000
    room.connect(b); room.receive(b, hello('A', { resume: TOKEN })) // rejoins
    expect(by(rows, 'session_start')).toHaveLength(1)
    clock.now += 20_000; room.disconnect(b) // held again
    clock.now += (REJOIN_GRACE + 1) * 1000; room.tick() // expires
    const end = by(rows, 'session_end')
    expect(end).toHaveLength(1)
    expect(end[0].doubles[0]).toBe(35) // to the second drop, not to the expiry
    expect(end[0].doubles[3]).toBe(1) // one rejoin
  })

  // Bug: a release (every object reset) losing every session's end.
  it('a release: the roster carries the session, and an expired hold still ends it', () => {
    const clock = { now: 1_000_000 }
    let saved: RoomSnapshot | undefined
    const before = analyticsRoom('lobby', clock, (s) => { saved = s })
    const a = peer()
    before.room.connect(a); before.room.receive(a, hello('A', { resume: TOKEN, aid: AID }))
    clock.now += 40_000; before.room.receive(a, state(false)) // the room saves itself on activity
    clock.now += 31_000; before.room.receive(a, state(false))
    expect(saved?.roster?.[0].at).toBe(clock.now) // at most ACTIVE_PERSIST_MS behind, in Explore too
    expect(saved?.roster?.[0].session).toBeTruthy()
    // The release: a new object from storage; A never comes back.
    const after = analyticsRoom('lobby', clock)
    after.room.restore(structuredClone(saved!))
    clock.now += (REJOIN_GRACE + 1) * 1000; after.room.tick()
    const end = by(after.rows, 'session_end')
    expect(end).toHaveLength(1)
    expect(end[0].blobs[9]).toBe(AID)
    expect(end[0].doubles[0]).toBe(71) // as of the last save
  })

  it('a release long enough that holds are not restored still ends the sessions', () => {
    const clock = { now: 1_000_000 }
    let saved: RoomSnapshot | undefined
    const before = analyticsRoom('lobby', clock, (s) => { saved = s })
    const a = peer()
    before.room.connect(a); before.room.receive(a, hello('A', { resume: TOKEN }))
    clock.now += 31_000; before.room.receive(a, state(false))
    clock.now += 10 * 60_000 // the object stays down for ten minutes
    const after = analyticsRoom('lobby', clock)
    after.room.restore(structuredClone(saved!))
    expect(after.room.heldCount).toBe(0)
    expect(by(after.rows, 'session_end')).toHaveLength(1)
    expect(by(after.rows, 'session_end')[0].doubles[0]).toBe(31)
  })

  // Bug: an object evicted with only held places tidying up without ending their sessions.
  it('an evicted object ends its roster sessions when its last alarm fires', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { rows, sink } = recorder()
    const session = { start: 1000, recipe: 'alpine', roomKind: 'public', facts: cleanFacts({ aid: AID }), geo: geoOf({ country: 'NZ', continent: 'OC' }, 'production'),
      activeMs: 5000, activeSince: 0, kindMs: { buggy: 8000 }, switches: {}, kind: 'buggy', kindSince: 9000, rejoins: 0 }
    const snapshot = { params: {}, it: 0, scores: {}, nextId: 2, host: 0, locked: false, modes: 2, days: 2, roster: [{ token: TOKEN, info: { id: 1, name: 'A', slot: 0, score: 0, kind: 'buggy', colors: ['#000000', '#ffffff'] }, at: 9000, session }] }
    const store = new Map<string, unknown>([['room', snapshot]])
    const state0 = {
      storage: { get: async (k: string) => store.get(k), put: async () => {}, deleteAll: async () => { store.clear() }, setAlarm: async () => {} },
      waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const durable = new RoomDO(state0 as never, { ANALYTICS: sink } as never)
    await Promise.resolve(); await Promise.resolve()
    await durable.alarm()
    expect(by(rows, 'session_end')).toHaveLength(1)
    expect(by(rows, 'session_end')[0].doubles[0]).toBe(8)
    expect(by(rows, 'vehicle')[0].blobs[10]).toBe('buggy')
  })

  // Bug: a hibernation wake starting a fresh, shorter session with no facts.
  it('a hibernation wake: the session rides in the socket attachment', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let clock = 5_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const { rows, sink } = recorder()
    const ws = { attachment: { room: 'lobby', at: clock } as unknown, send() {}, close() {}, serializeAttachment(v: unknown) { this.attachment = v }, deserializeAttachment() { return this.attachment } }
    const make = () => {
      const s = {
        storage: { get: async () => undefined, put: async () => {}, deleteAll: async () => {}, setAlarm: async () => {} },
        waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [ws], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
      }
      const env = { ANALYTICS: sink, ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } }
      return new RoomDO(s as never, env as never)
    }
    const first = make()
    await Promise.resolve(); await Promise.resolve()
    first.webSocketMessage(ws as never, hello('A', { aid: AID }))
    clock += 120_000
    // Hibernation: a new object over the same socket; then the player leaves.
    const woken = make()
    await Promise.resolve(); await Promise.resolve()
    woken.webSocketClose(ws as never, 1000, '', true)
    const end = by(rows, 'session_end')
    expect(end).toHaveLength(1)
    expect(end[0].blobs[9]).toBe(AID)
    expect(end[0].doubles[0]).toBeGreaterThanOrEqual(120)
  })

  // Bug: full-room refusals (handoffs to a universe) not counted.
  it('a refusal as full is counted, with no session', () => {
    const clock = { now: 1_000_000 }
    const { rows, sink } = recorder()
    const budget = new RowBudget(ROOM_ROWS_PER_MINUTE, () => clock.now, sink)
    const room = new Room('lobby', { now: () => clock.now, maxPlayers: 1, analytics: (e, c, x) => { budget.write(e, c, x) } })
    const a = peer(), b = peer()
    room.connect(a); room.receive(a, hello('A'))
    room.connect(b); room.receive(b, hello('B', { aid: AID }))
    expect(by(rows, 'room_full')).toHaveLength(1)
    expect(by(rows, 'room_full')[0].blobs[9]).toBe(AID)
    expect(by(rows, 'session_start')).toHaveLength(1)
  })
})

describe('client posts and the Worker', () => {
  // Bug: a crash row carrying a player's name, a chat line, a private room, an email or a URL,
  // even from a client that sends them raw (shared/crashText.ts, applied again on the server).
  it('keeps crash rows structured: nothing a person typed survives on the server', () => {
    const geo = geoOf({ country: 'DE', continent: 'EU' }, 'beta')
    const secrets = ['Quentin', 'Marmalade', 'pineapple', 'umbrella', 'p-a1b2c3d4e5f6g7h8i9j0kl', 'quentin@example.com', 'example.com', 'mira.cc', 'secret-room', 'token=abc']
    const raw = {
      type: 'crash', kind: 'error', name: 'TypeError', stack: 'deadbeef', vehicle: 'jet',
      message: 'Cannot read properties of undefined (reading \'Quentin Marmalade\') chat "pineapple umbrella secret" ' +
        'room p-a1b2c3d4e5f6g7h8i9j0kl mail quentin@example.com at https://mira.cc/?room=secret-room&token=abc#x Quentin Marmalade pineapple umbrella 1234567890',
      frames: '/assets/index-a1.js:10:20 < https://evil.example/x.js:1:2 < /assets/b.js?room=secret-room:3:4 < quentin@example.com:1:1 < /src/net/index.ts:5:6',
    }
    const post = cleanClientPost(raw, 'abcdef0123456789', geo, 'beta')!
    const stored = JSON.stringify(post.row)
    for (const secret of secrets) expect(stored).not.toContain(secret)
    expect(post.row.extra.message).toMatch(/^Cannot read properties of undefined/)
    expect(post.row.extra.message!.length).toBeLessThanOrEqual(120)
    expect(post.row.extra.message).toMatch(/^[A-Za-z0-9 .,:_'-]*$/)
    expect(post.row.extra.frames).toBe('/assets/index-a1.js:10:20 < /src/net/index.ts:5:6')
    expect(post.row.extra.errorName).toBe('TypeError')
    expect(cleanClientPost({ ...raw, name: 'Quentin Marmalade' }, 'abcdef0123456789', geo, 'beta')!.row.extra.errorName).toBe('Error')
    expect(post.row.common.country).toBe('DE')
    for (const bad of [{ type: 'crash', kind: 'nuke' }, { type: 'shout' }]) expect(cleanClientPost(bad, 'abcdef0123456789', geo, 'beta')).toBeNull()
    expect(cleanClientPost(raw, 'not-a-key', geo, 'beta')).toBeNull()
  })

  // Bug: a crash loop flooding /e; or the limiter keyed on the network address.
  it('limits posts per client key and per isolate, keyed only by what the client sent', () => {
    let now = 0
    const limiter = new PostLimiter(() => now)
    let allowed = 0
    for (let i = 0; i < 100; i++) if (limiter.allow('abcdef0123456789')) allowed++
    expect(allowed).toBe(CLIENT_POSTS_PER_KEY_PER_MINUTE)
    let total = 0
    for (let k = 0; k < 1000; k++) if (limiter.allow(k.toString(16).padStart(16, '0'))) total++
    expect(total + allowed).toBeLessThanOrEqual(CLIENT_POSTS_PER_MINUTE)
    now += 60_000
    expect(limiter.allow('abcdef0123456789')).toBe(true)
  })

  // Bug: a forged geography header from a caller, or the header not reaching the room.
  it('the Worker sets the room\'s geography from request.cf and replaces any forged header', async () => {
    const reached: Request[] = []
    const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async (r: Request) => { reached.push(r); return new Response('room') } }) } }
    const req = new Request('https://beta.mira.cc/ws?room=lobby', { headers: { Upgrade: 'websocket', [GEO_HEADER]: 'US,NA,production' } })
    Object.defineProperty(req, 'cf', { value: { country: 'NZ', continent: 'OC' } })
    await worker.fetch(req, env as never)
    expect(reached[0].headers.get(GEO_HEADER)).toBe('NZ,OC,beta,,')
  })

  // Bug: /e failing loudly, writing malformed posts, or affecting anything when analytics is off.
  it('POST /e writes one cleaned point, answers 204 for anything, and never throws', async () => {
    const { rows, sink } = recorder()
    const post = (body: string, env: object, key = 'abcdef0123456789') => worker.fetch(new Request(`https://mira.cc/e?k=${key}`, { method: 'POST', body }), env as never)
    expect((await post(JSON.stringify({ type: 'event', kind: 'physics_retry', attempt: 2 }), { ANALYTICS: sink })).status).toBe(204)
    expect(rows).toHaveLength(1)
    expect(rows[0].blobs[10]).toBe('physics_retry')
    expect((await post('not json', { ANALYTICS: sink })).status).toBe(204)
    expect((await post('{"type":"crash","kind":"error"}', { ANALYTICS: sink }, 'nokey')).status).toBe(204)
    expect(rows).toHaveLength(1)
    expect((await post(JSON.stringify({ type: 'event', kind: 'ws_fail' }), {})).status).toBe(204)
    const throwing: AnalyticsSink = { writeDataPoint: () => { throw new Error('dataset down') } }
    expect((await post(JSON.stringify({ type: 'event', kind: 'ws_fail' }), { ANALYTICS: throwing }, 'abcdef0123456780')).status).toBe(204)
  })

  // Bug: a huge post buffered whole before any limit (memory on the Worker), with or without
  // a declared length.
  it('POST /e never reads past its cap: a declared large body is refused unread, an undeclared one is cut off', async () => {
    const { rows, sink } = recorder()
    const declared = new Request('https://mira.cc/e?k=abcdef0123456781', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': String(8 * 1024 * 1024) } })
    expect((await worker.fetch(declared, { ANALYTICS: sink } as never)).status).toBe(413)
    let pulled = 0, cancelled = false
    const chunk = new Uint8Array(64 * 1024).fill(120)
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += chunk.byteLength; if (pulled > 8 * 1024 * 1024) controller.close(); else controller.enqueue(chunk) },
      cancel() { cancelled = true },
    })
    const undeclared = new Request('https://mira.cc/e?k=abcdef0123456782', { method: 'POST', body: endless, duplex: 'half' } as RequestInit)
    const res = await worker.fetch(undeclared, { ANALYTICS: sink } as never)
    expect([204, 413]).toContain(res.status)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(4 * chunk.byteLength) // stopped at the first chunk past 4 KiB
    expect(rows).toHaveLength(0)
  })

  // Bug: an analytics failure breaking a room.
  it('a throwing dataset never affects play', () => {
    const clock = { now: 1_000_000 }
    const sink: AnalyticsSink = { writeDataPoint: () => { throw new Error('dataset down') } }
    const budget = new RowBudget(ROOM_ROWS_PER_MINUTE, () => clock.now, sink)
    const room = new Room('lobby', { now: () => clock.now, analytics: (e, c, x) => { budget.write(e, c, x) } })
    const a = peer()
    room.connect(a)
    expect(() => room.receive(a, hello('A'))).not.toThrow()
    expect(room.presence().players).toBe(1)
    expect(() => room.disconnect(a)).not.toThrow()
  })
})

describe('the registry presence snapshot', () => {
  // Bug: presence rows stamped with a fixed channel, so beta traffic counted as production.
  it('writes one row per planet and channel, from the channel each room reported', async () => {
    let clock = 9_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const { rows, sink } = recorder()
    const store = new Map<string, unknown>()
    const s = {
      storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v) }, deleteAll: async () => {}, setAlarm: async () => {} },
      waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const registry = new RoomDO(s as never, { ANALYTICS: sink } as never)
    const report = (room: string, players: number, channel: string) =>
      registry.fetch(new Request('https://registry/report', { method: 'POST', body: JSON.stringify({ room, players, active: players, recipeId: 'alpine', channel }) }))
    await report('lobby', 3, 'production')
    await report('p-' + 'a'.repeat(22), 2, 'beta')
    expect(by(rows, 'presence')).toHaveLength(1) // the first report wrote the snapshot of what it knew
    clock += 60_000
    await report('lobby', 4, 'production')
    const latest = by(rows, 'presence').slice(1)
    expect(latest.map((r) => [r.blobs[1], r.blobs[3], r.doubles[4]]).sort()).toEqual([['beta', 'alpine', 2], ['production', 'alpine', 4]])
  })
})

describe('the review\'s other findings', () => {
  // Bug: a structuredClone of the session on every inbound message (320 a second in a full room).
  it('copies a session only when an attachment rewrite is due, not per message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let clock = 7_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const { sink } = recorder()
    const ws = { attachment: { room: 'lobby', at: clock } as unknown, send() {}, close() {}, serializeAttachment(v: unknown) { this.attachment = v }, deserializeAttachment() { return this.attachment } }
    const s0 = {
      storage: { get: async () => undefined, put: async () => {}, deleteAll: async () => {}, setAlarm: async () => {} },
      waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [ws], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const durable = new RoomDO(s0 as never, { ANALYTICS: sink, ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } } as never)
    await Promise.resolve(); await Promise.resolve()
    durable.webSocketMessage(ws as never, hello('A'))
    const copies = vi.spyOn(Room.prototype, 'sessionOf')
    for (let i = 0; i < 1000; i++) { clock += 50; durable.webSocketMessage(ws as never, state(false) as never) }
    expect(copies).not.toHaveBeenCalled()
    clock += 50; durable.webSocketMessage(ws as never, state(true) as never) // a pause: one rewrite is due
    expect(copies).toHaveBeenCalledTimes(1)
  })

  // Bug: analytics work (sessions, copies, extra roster saves) running where there is no binding.
  it('does no analytics work at all without the binding', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let clock = 8_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let puts = 0
    const ws = { attachment: { room: 'lobby', at: clock } as unknown, send() {}, close() {}, serializeAttachment(v: unknown) { this.attachment = v }, deserializeAttachment() { return this.attachment } }
    const s0 = {
      storage: { get: async () => undefined, put: async (k: string) => { if (k === 'room') puts++ }, deleteAll: async () => {}, setAlarm: async () => {} },
      waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [ws], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const durable = new RoomDO(s0 as never, { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } } as never)
    await Promise.resolve(); await Promise.resolve()
    durable.webSocketMessage(ws as never, hello('A', { resume: TOKEN }))
    const copies = vi.spyOn(Room.prototype, 'sessionOf')
    const after = puts
    for (let i = 0; i < 20 * 120; i++) { clock += 50; durable.webSocketMessage(ws as never, state(false) as never) } // two minutes of Explore
    expect(copies).toHaveBeenCalledTimes(0)
    // The room has no analytics writer, so its analytics-only roster save cannot fire; the saves
    // seen are the room's own activity saves (at most one per ACTIVE_PERSIST_MS, 30 s).
    expect((durable as unknown as { room: { analytics?: unknown } }).room.analytics).toBeUndefined()
    expect(puts - after).toBeLessThanOrEqual(4)
    expect((ws.attachment as { session?: unknown }).session).toBeUndefined()
  })

  // Bug: the registry's channel memory growing without bound on a warm registry.
  it('forgets a room\'s channel when it reports nobody, and keeps none without the binding', async () => {
    let clock = 9_500_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const make = (env: object) => {
      const s0 = {
        storage: { get: async () => undefined, put: async () => {}, deleteAll: async () => {}, setAlarm: async () => {} },
        waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
      }
      return new RoomDO(s0 as never, env as never)
    }
    const report = (r: RoomDO, room: string, players: number) =>
      r.fetch(new Request('https://registry/report', { method: 'POST', body: JSON.stringify({ room, players, active: players, recipeId: 'alpine', channel: 'beta' }) }))
    const size = (r: RoomDO) => (r as unknown as { channels: Map<string, unknown> }).channels.size
    const bare = make({})
    for (let i = 0; i < 100; i++) await report(bare, 'room' + i, 1)
    expect(size(bare)).toBe(0)
    const { sink } = recorder()
    const bound = make({ ANALYTICS: sink })
    for (let i = 0; i < 100; i++) await report(bound, 'room' + i, 1)
    expect(size(bound)).toBe(100)
    for (let i = 0; i < 50; i++) await report(bound, 'room' + i, 0)
    expect(size(bound)).toBe(50)
    clock += 11 * 60_000
    await report(bound, 'fresh', 1)
    expect(size(bound)).toBe(1) // the rest aged out
  })

  // Bug: driving after a rejoin not counted as active time until the next pause and resume.
  it('restarts the active clock on a rejoin from the player\'s actual pause state', () => {
    const clock = { now: 1_000_000 }
    const { room, rows } = analyticsRoom('lobby', clock)
    const a = peer(), b = peer()
    room.connect(a); room.receive(a, hello('A', { resume: TOKEN }))
    room.receive(a, state(false))
    clock.now += 60_000; room.disconnect(a) // 60 s active, then dropped
    clock.now += 10_000
    room.connect(b); room.receive(b, hello('A', { resume: TOKEN })) // rejoins, still driving
    room.receive(b, state(false)) // equal to the last state before the drop
    clock.now += 60_000; room.receive(b, state(false))
    clock.now += 0; room.disconnect(b)
    clock.now += (REJOIN_GRACE + 1) * 1000; room.tick()
    const end = by(rows, 'session_end')[0]
    expect(end.doubles[0]).toBe(130) // connected: to the second drop
    expect(end.doubles[1]).toBe(120) // active: both minutes of driving, not the 10 s away
    expect(sessionPaused).toBeTypeOf('function')
  })
})
