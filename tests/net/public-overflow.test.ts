/**
 * Public room overflow (server/registry.ts PublicSeats, server/worker.ts assignPublic).
 *
 * Bugs these guard against, on launch day with hundreds of arrivals at once:
 *  - the seventeenth visitor is refused or plays alone while another public room has people;
 *  - simultaneous arrivals are all sent to the last seat, and some are refused;
 *  - a dropped or reloaded player, or everyone after a deploy, is sent to a different room and
 *    loses their place;
 *  - a stranger is assigned into a room someone named "lobby-2" themselves;
 *  - a client's "that room is full" lingers, or one hostile client empties a room of newcomers;
 *  - a frozen client, or either switch off, behaves differently from before overflow existed;
 *  - a slow or failing registry sends a crowd at a full room.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASSIGN_PATIENCE_MS, ASSIGN_TTL_MS, FLAG_TRUST_MS, FULL_HINT_MS, FULL_HINT_SLACK, HELD_TTL_MS, isPublicRoom, MAX_PUBLIC_ROOMS,
  OFF_CACHE_MS, PUBLIC_ROOM_HEADER, publicRooms, RESERVE_MS, RoomRegistry,
} from '../../server/registry'
import { roomName } from '../../server/util'
import * as entry from '../../server/worker'
import worker, { forgetOverflowCache, RoomDO, roomNameFor } from '../../server/worker'
import { CLOSE_BUSY, MAX_ROOM_PLAYERS, PROTOCOL_VERSION } from '../../shared/protocol'
import { Room } from '../../server/room'

const CAP = MAX_ROOM_PLAYERS

describe('public seat assignment', () => {
  it('fills the public room first, then sends the next arrival to the second public room', () => {
    const r = new RoomRegistry()
    const got = Array.from({ length: CAP + 1 }, (_, i) => r.assign({ cap: CAP }, 1000 + i))
    expect(got.slice(0, CAP).every((room) => room === 'lobby')).toBe(true)
    expect(got[CAP]).toBe('lobby#2')
  })

  it('never seats more than the cap in a room, and seats everyone, for 50 arrivals in ten seconds', () => {
    // A model of the rooms: each enforces the cap as server/room.ts does and reports its count
    // to the registry a little after each arrival, as the presence reporter does.
    const r = new RoomRegistry()
    const rooms = new Map<string, number>()
    const reports: { at: number; room: string }[] = []
    let refused = 0
    for (let i = 0; i < 50; i++) {
      const now = i * 200 // 50 arrivals in ten seconds
      for (const due of reports.filter((x) => x.at <= now)) r.report(due.room, rooms.get(due.room)!, due.at)
      reports.splice(0, reports.length, ...reports.filter((x) => x.at > now))
      const seat = r.assign({ cap: CAP }, now)
      const n = rooms.get(seat) ?? 0
      if (n >= CAP) { refused++; continue }
      rooms.set(seat, n + 1)
      reports.push({ at: now + 150 + (i % 7) * 100, room: seat })
    }
    expect(refused).toBe(0)
    expect(Math.max(...rooms.values())).toBeLessThanOrEqual(CAP)
    expect([...rooms.values()].reduce((a, b) => a + b, 0)).toBe(50)
    // Everyone is with real people: no room of one.
    expect(Math.min(...rooms.values())).toBeGreaterThan(1)
  })

  it('counts held places as taken seats while they can still be held', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP - 2, 0, null, 2)
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby#2')
    // Holds run out while the room hibernates and it never reports again: not held forever.
    r.report('lobby', 0, 10, null, CAP)
    expect(r.assign({ cap: CAP }, 10 + HELD_TTL_MS - 1)).toBe('lobby#2')
    expect(r.assign({ cap: CAP }, 10 + HELD_TTL_MS)).toBe('lobby')
  })

  it("a rise in a room's report uses up its reservations, so seats are not counted twice", () => {
    const r = new RoomRegistry()
    for (let i = 0; i < 4; i++) expect(r.assign({ cap: CAP }, 0)).toBe('lobby')
    r.report('lobby', 4, 100)
    // 4 seated and 0 still reserved: 12 more fit before the second room.
    const next = Array.from({ length: 13 }, () => r.assign({ cap: CAP }, 200))
    expect(next.filter((x) => x === 'lobby')).toHaveLength(12)
    expect(next[12]).toBe('lobby#2')
  })

  it('lets a reservation lapse after RESERVE_MS when its arrival never turns up', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP - 1, 0)
    expect(r.assign({ cap: CAP }, 0)).toBe('lobby')
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby#2')
    r.report('lobby', CAP - 1, RESERVE_MS - 1) // still 15: the arrival is late
    expect(r.assign({ cap: CAP }, RESERVE_MS + 1)).toBe('lobby')
  })

  it('sends a returning player back to their room: the room, not the registry, decides', () => {
    const r = new RoomRegistry()
    r.report('lobby', 3, 0) // the public room has seats again
    r.report('lobby#2', 10, 0)
    expect(r.assign({ cap: CAP, prefer: 'lobby#2' }, 1)).toBe('lobby#2')
    // Full by the registry's count: still sent back (their held place, checked by secret).
    r.report('lobby#2', CAP, 2)
    expect(r.assign({ cap: CAP, prefer: 'lobby#2' }, 3)).toBe('lobby#2')
    // Refused there after all: the retry names it and is seated elsewhere.
    expect(r.assign({ cap: CAP, full: 'lobby#2' }, 4)).toBe('lobby')
  })

  it('sends a returning player back to their room after a restart of every object', () => {
    // Before: two full public rooms. The deploy resets every object; the registry reloads the
    // counts it stored, with no reservations, and everyone reconnects at once.
    const before = new RoomRegistry()
    before.report('lobby', CAP, 0)
    before.report('lobby#2', CAP, 0)
    const after = new RoomRegistry(before.save())
    expect(after.assign({ cap: CAP, prefer: 'lobby#2' }, 1000)).toBe('lobby#2')
    expect(after.assign({ cap: CAP, prefer: 'lobby' }, 1001)).toBe('lobby')
  })

  it('ignores a prefer or full that is not a public room', () => {
    const r = new RoomRegistry()
    for (const name of ['secret-room', 'lobby-2', 'lobby#1', 'lobby#65', 'lobby#02', '../lobby', '']) {
      expect(r.assign({ cap: CAP, prefer: name }, 0)).toBe('lobby')
      expect(r.assign({ cap: CAP, full: name }, 0)).toBe('lobby')
    }
  })

  it('believes a refusal briefly, only for the room it names, and a report overrides it', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP - FULL_HINT_SLACK, 0) // nearly full: a frozen crowd just filled it
    expect(r.assign({ cap: CAP, full: 'lobby' }, 1)).toBe('lobby#2')
    expect(r.assign({ cap: CAP }, 2)).toBe('lobby#2')
    // It expires by itself...
    expect(r.assign({ cap: CAP }, 1 + FULL_HINT_MS)).toBe('lobby')
    // ...and the room's own report ends it at once.
    expect(r.assign({ cap: CAP, full: 'lobby' }, 10)).toBe('lobby#2')
    r.report('lobby', CAP - FULL_HINT_SLACK, 11)
    expect(r.assign({ cap: CAP }, 12)).toBe('lobby')
  })

  it('a hostile hint cannot empty a room that is far from full', () => {
    const r = new RoomRegistry()
    r.report('lobby', 3, 0)
    // The hinting client itself is not sent back to the room it named...
    expect(r.assign({ cap: CAP, full: 'lobby' }, 1)).toBe('lobby#2')
    // ...but nobody else believes it.
    expect(r.assign({ cap: CAP }, 2)).toBe('lobby')
    // A room nobody has reported cannot be marked either.
    expect(r.assign({ cap: CAP, full: 'lobby#3' }, 3)).toBe('lobby')
  })

  it('does not trust counts older than the presence TTL (a room reset by a deploy)', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP, 0)
    expect(r.assign({ cap: CAP }, ASSIGN_TTL_MS - 1)).toBe('lobby#2')
    expect(r.assign({ cap: CAP }, ASSIGN_TTL_MS)).toBe('lobby')
  })

  it("sends everyone to lobby (today's refusal) when every public room is full", () => {
    const r = new RoomRegistry()
    for (const room of publicRooms()) r.report(room, CAP, 0)
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby')
    expect(publicRooms()).toHaveLength(MAX_PUBLIC_ROOMS)
    expect(publicRooms().every((room) => isPublicRoom(room))).toBe(true)
  })

  it('keeps held-only rooms for seating but counts nobody playing in them', () => {
    const r = new RoomRegistry()
    r.report('lobby', 0, 0, 'alpine', 3)
    r.report('lobby#2', 2, 0, 'alpine')
    expect(r.totals(1)).toEqual({ rooms: 1, players: 2 })
    expect(r.presence(1).byRecipe).toEqual([{ recipeId: 'alpine', rooms: 1, players: 2, oldestReportAt: 0 }])
    expect(new RoomRegistry(r.save()).totals(1)).toEqual({ rooms: 1, players: 2 })
    r.report('lobby', 0, 2, 'alpine', 0)
    expect(Object.keys(r.save())).toEqual(['lobby#2'])
  })

  it('an overflow room names itself when it refuses; every other refusal is unchanged on the wire', () => {
    const refusal = (name: string): string => {
      const room = new Room(name, { maxPlayers: 1 })
      const hello = (n: string) => JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name: n, params: {} })
      const first = { send() {}, close() {} }
      room.connect(first); room.receive(first, hello('A'))
      const sent: string[] = []
      const second = { send: (d: string | Uint8Array) => { if (typeof d === 'string') sent.push(d) }, close() {} }
      room.connect(second); room.receive(second, hello('B'))
      return sent.at(-1)!
    }
    expect(refusal('lobby')).toBe('{"type":"error","message":"room is full"}')
    expect(refusal('lobby-2')).toBe('{"type":"error","message":"room is full"}')
    expect(JSON.parse(refusal('lobby#2'))).toEqual({ type: 'error', message: 'room is full', room: 'lobby#2' })
  })

  it('does not recreate a forgotten overflow room for one returning player', () => {
    const r = new RoomRegistry()
    r.report('lobby', 3, 0)
    expect(r.assign({ cap: CAP, prefer: 'lobby#5' }, 1)).toBe('lobby')
  })

  it('switched off, drains: new arrivals go to lobby, returning players keep their overflow room', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP, 0)
    r.report('lobby#2', 9, 0)
    // New arrivals: lobby, as before overflow existed, even though it is full.
    expect(r.assign({ cap: CAP, open: false }, 1)).toBe('lobby')
    // Returning to a room that still exists: kept. To one that has gone: lobby.
    expect(r.assign({ cap: CAP, open: false, prefer: 'lobby#2' }, 2)).toBe('lobby#2')
    expect(r.assign({ cap: CAP, open: false, prefer: 'lobby#3' }, 3)).toBe('lobby')
    // Draining reserves nothing: switched on again, lobby#2 has exactly its 7 free seats.
    const next = Array.from({ length: 8 }, (_, i) => r.assign({ cap: CAP }, 4 + i))
    expect(next.slice(0, 7).every((x) => x === 'lobby#2')).toBe(true)
    expect(next[7]).toBe('lobby#3')
  })

  it('overflow names cannot be typed: no ?room= value becomes one', () => {
    for (const room of publicRooms().slice(1)) {
      expect(room).toContain('#')
      expect(isPublicRoom(roomName(room))).toBe(false)
      expect(roomName(room)).toBe(room.replace('#', '-'))
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The Worker: routing, the namespace, both switches, the timeout.

type Store = Map<string, unknown>
function registryObject(store: Store = new Map()): RoomDO {
  const state = {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => { store.set(key, structuredClone(value)) },
      deleteAll: async () => { store.clear() },
      setAlarm: async () => {},
    },
    waitUntil: () => {},
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
  return new RoomDO(state as never, {} as never)
}
const report = (registry: RoomDO, room: string, players: number) =>
  registry.fetch(new Request('https://registry/report', { method: 'POST', body: JSON.stringify({ room, players, recipeId: null }) }))

const TOKEN = 'test-switch-token-not-a-real-secret'
/** A Worker environment whose rooms record what reaches them; '#status' is a real registry. */
function environment(master: string | undefined, registry: { fetch(req: Request): Promise<Response> } = registryObject()) {
  const reached: { room: string; request: Request }[] = []
  let registryCalls = 0
  const env = {
    PUBLIC_OVERFLOW: master,
    OVERFLOW_TOKEN: TOKEN,
    ASSETS: { fetch: async () => new Response('asset') },
    ROOMS: {
      idFromName: (name: string) => ({ name }),
      get: ({ name }: { name: string }) => ({
        fetch: async (req: Request) => {
          if (name === '#status') { registryCalls++; return registry.fetch(req) }
          reached.push({ room: name, request: req })
          return new Response('room')
        },
      }),
    },
  }
  return { env, reached, calls: () => registryCalls }
}
const join = (query: string, headers: Record<string, string> = {}) =>
  new Request(`https://mira.cc/ws?${query}`, { headers: { Upgrade: 'websocket', ...headers } })
const flip = (env: object, on: boolean, token = TOKEN) =>
  worker.fetch(new Request('https://mira.cc/overflow', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ on }) }), env as never)

/** Node cannot build a 101 response or a WebSocketPair: stand-ins that record the busy close. */
function stubSockets() {
  const closed: { code: number; sent: string[] }[] = []
  class Pair {
    0 = {}
    1: { accept(): void; send(s: string): void; close(code: number): void }
    constructor() {
      const record = { code: 0, sent: [] as string[] }
      closed.push(record)
      this[1] = { accept() {}, send: (s) => { record.sent.push(s) }, close: (code) => { record.code = code } }
    }
  }
  const Real = Response
  class Upgradable extends Real {
    constructor(body?: BodyInit | null, init?: ResponseInit) { super(body, init?.status === 101 ? { ...init, status: 200 } : init) }
  }
  vi.stubGlobal('WebSocketPair', Pair)
  vi.stubGlobal('Response', Upgradable)
  return closed
}

describe('public overflow in the Worker', () => {
  beforeEach(() => forgetOverflowCache())
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('exports only what workerd accepts from an entry module (handlers, classes, functions)', () => {
    for (const [name, value] of Object.entries(entry)) {
      if (name !== 'default') expect([name, typeof value]).toEqual([name, 'function'])
    }
  })

  it('master switch off: the request reaches lobby untouched and the registry is never asked', async () => {
    for (const master of [undefined, 'off', 'on']) {
      const { env, reached, calls } = environment(master)
      const req = join('room=lobby&assign=1')
      await worker.fetch(req, env as never)
      expect(reached).toEqual([{ room: 'lobby', request: req }])
      expect(calls()).toBe(0)
    }
  })

  it('runtime flag off (the default): lobby untouched, and the isolate stops asking for a while', async () => {
    const { env, reached, calls } = environment('runtime')
    const first = join('room=lobby&assign=1')
    await worker.fetch(first, env as never)
    expect(reached[0]).toEqual({ room: 'lobby', request: first })
    expect(calls()).toBe(1)
    for (let i = 0; i < 20; i++) await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(calls()).toBe(1)
    expect(reached.every((r) => r.room === 'lobby' && !r.request.headers.has(PUBLIC_ROOM_HEADER))).toBe(true)
    expect(OFF_CACHE_MS).toBeGreaterThan(0)
  })

  it('the switch needs the secret, and with it on the seventeenth arrival goes to the second public room', async () => {
    const { env, reached } = environment('runtime')
    expect((await flip(env, true, 'wrong')).status).toBe(404)
    expect((await worker.fetch(new Request('https://mira.cc/overflow'), env as never)).status).toBe(404)
    expect(await (await flip(env, true)).json()).toEqual({ master: true, on: true })
    for (let i = 0; i <= CAP; i++) await worker.fetch(join('room=lobby&assign=1'), env as never)
    // The first sixteen see exactly today's request.
    expect(reached.slice(0, CAP).every((r) => r.room === 'lobby' && !r.request.headers.has(PUBLIC_ROOM_HEADER))).toBe(true)
    const last = reached[CAP]
    expect(last.room).toBe('lobby#2')
    // The room object is told its own name, so its welcome says lobby#2.
    expect(roomNameFor(last.request)).toBe('lobby#2')
    expect(last.request.headers.get('Upgrade')).toBe('websocket')
    // Off again: back to lobby for everyone.
    await flip(env, false)
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.at(-1)!.room).toBe('lobby')
  })

  it("a frozen client (no assign) gets today's behaviour with overflow on", async () => {
    const { env, reached } = environment('runtime')
    await flip(env, true)
    for (let i = 0; i <= CAP; i++) await worker.fetch(join('room=lobby'), env as never)
    expect(reached.every((r) => r.room === 'lobby')).toBe(true)
  })

  it('a room someone named lobby-2 is never assigned into, and stays theirs', async () => {
    const { env, reached } = environment('runtime')
    await flip(env, true)
    // A legacy player is in their own "lobby-2"; the public room fills up.
    await worker.fetch(join('room=lobby-2'), env as never)
    for (let i = 0; i <= CAP; i++) await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.at(-1)!.room).toBe('lobby#2')
    expect(reached.filter((r) => r.room === 'lobby-2')).toHaveLength(1)
    // An invite to "lobby-2" (or a typed lobby#2) still reaches the named room, even with a
    // forged header and assignment asked for.
    for (const query of ['room=lobby-2', 'room=lobby-2&assign=1&prefer=lobby%232', 'room=lobby%232']) {
      await worker.fetch(join(query, { [PUBLIC_ROOM_HEADER]: 'lobby#2' }), env as never)
      const got = reached.at(-1)!
      expect(got.room).toBe('lobby-2')
      expect(got.request.headers.has(PUBLIC_ROOM_HEADER)).toBe(false)
      expect(roomNameFor(got.request)).toBe('lobby-2')
    }
    // A forged header cannot name the public room's object either.
    await worker.fetch(join('room=lobby', { [PUBLIC_ROOM_HEADER]: 'lobby#3' }), env as never)
    expect(roomNameFor(reached.at(-1)!.request)).toBe('lobby')
  })

  it('a reconnect returns to its room while lobby has seats, and after a restart', async () => {
    const store: Store = new Map<string, unknown>([['overflow', true]])
    const registry = registryObject(store)
    const { env, reached } = environment('runtime', registry)
    await report(registry, 'lobby', 4)
    await report(registry, 'lobby#2', 9)
    await worker.fetch(join('room=lobby&assign=1&prefer=lobby%232'), env as never)
    expect(reached.at(-1)!.room).toBe('lobby#2')
    // Both full, then every object restarts (a new registry object over the same storage).
    await report(registry, 'lobby', CAP)
    await report(registry, 'lobby#2', CAP)
    const restarted = environment('runtime', registryObject(store))
    await worker.fetch(join('room=lobby&assign=1&prefer=lobby%232'), restarted.env as never)
    expect(restarted.reached.map((r) => r.room)).toEqual(['lobby#2'])
  })

  it('switched off, the Worker drains: a returning overflow player keeps their room while lobby is full', async () => {
    const store: Store = new Map<string, unknown>([['overflow', false]])
    const registry = registryObject(store)
    const { env, reached, calls } = environment('runtime', registry)
    await report(registry, 'lobby', CAP)
    await report(registry, 'lobby#2', 9)
    await worker.fetch(join('room=lobby&assign=1'), env as never) // warms the "off" cache
    expect(reached.at(-1)!.room).toBe('lobby')
    const asked = calls()
    // A new arrival with the cache warm: lobby, no question asked.
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(calls()).toBe(asked)
    // A returning overflow player still asks, and goes back to their room.
    await worker.fetch(join('room=lobby&assign=1&prefer=lobby%232'), env as never)
    expect(calls()).toBe(asked + 1)
    expect(reached.at(-1)!.room).toBe('lobby#2')
  })

  it('fails open to lobby when the registry is unreachable and the flag is off or unknown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const down = environment('runtime', { fetch: async () => { throw new Error('registry down') } })
    await worker.fetch(join('room=lobby&assign=1'), down.env as never)
    // A returning player goes back to their room: the room decides.
    await worker.fetch(join('room=lobby&assign=1&prefer=lobby%232'), down.env as never)
    expect(down.reached.map((r) => r.room)).toEqual(['lobby', 'lobby#2'])
  })

  it('closes a new client as busy (to retry once) when overflow is on and the registry fails', async () => {
    const closed = stubSockets()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // The isolate has heard "on" from a working registry, which then goes wrong three ways.
    const real = registryObject(new Map<string, unknown>([['overflow', true]]))
    let mode: 'real' | 'slow' | 'failing' | 'nonsense' = 'real'
    const { env, reached } = environment('runtime', {
      fetch: (req) => mode === 'real' ? real.fetch(req)
        : mode === 'slow' ? new Promise<Response>(() => {})
        : mode === 'failing' ? Promise.reject(new Error('registry down'))
        : Promise.resolve(new Response('../etc', { headers: { 'x-overflow': 'on' } })),
    })
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.map((r) => r.room)).toEqual(['lobby'])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mode = 'slow'
    const pending = worker.fetch(join('room=lobby&assign=1'), env as never)
    await vi.advanceTimersByTimeAsync(ASSIGN_PATIENCE_MS)
    await pending
    vi.useRealTimers()
    mode = 'failing'
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    mode = 'nonsense'
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    // Nobody more was sent to a room blind; each was told "busy" and closed with CLOSE_BUSY.
    expect(reached).toHaveLength(1)
    expect(closed.map((c) => c.code)).toEqual([CLOSE_BUSY, CLOSE_BUSY, CLOSE_BUSY])
    expect(closed.every((c) => JSON.parse(c.sent[0]).type === 'error')).toBe(true)
    expect(FLAG_TRUST_MS).toBeGreaterThan(ASSIGN_PATIENCE_MS)
  })

  it('uses a valid seat that arrives after the patience period (a late timer), and logs it as late', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line) })
    const real = registryObject(new Map<string, unknown>([['overflow', true]]))
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let slow = false
    const { env, reached } = environment('runtime', {
      // When slow, the answer is valid but comes 1.7 s on the clock, before the (delayed) timer.
      fetch: async (req) => { if (slow) clock += 1700; return real.fetch(req) },
    })
    for (let i = 0; i < CAP; i++) await worker.fetch(join('room=lobby&assign=1'), env as never)
    slow = true
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.map((r) => r.room).at(-1)).toBe('lobby#2')
    expect(reached).toHaveLength(CAP + 1)
    expect(lines.filter((l) => l.includes('"assign_slow"') && l.includes('"outcome":"late"'))).toHaveLength(1)
  })

})
