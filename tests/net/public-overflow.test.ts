/**
 * Public room overflow (server/registry.ts PublicSeats, server/worker.ts assignPublic).
 *
 * Bugs these guard against, on launch day with hundreds of arrivals at once:
 *  - the seventeenth visitor is refused or plays alone while another public room has people;
 *  - simultaneous arrivals are all sent to the last seat, and some are refused;
 *  - a dropped or reloaded player is sent to a different room and loses their place;
 *  - a frozen client, or either switch off, behaves differently from before overflow existed;
 *  - a slow or failing registry stops anyone from joining.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSIGN_TTL_MS, isPublicRoom, MAX_PUBLIC_ROOMS, publicRooms, RESERVE_MS, RoomRegistry } from '../../server/registry'
import worker, { ASSIGN_TIMEOUT_MS, forgetOverflowCache, OFF_CACHE_MS, RoomDO } from '../../server/worker'
import { MAX_ROOM_PLAYERS } from '../../shared/protocol'

const CAP = MAX_ROOM_PLAYERS

describe('public seat assignment', () => {
  it('fills the public room first, then sends the next arrival to lobby-2', () => {
    const r = new RoomRegistry()
    const got = Array.from({ length: CAP + 1 }, (_, i) => r.assign({ cap: CAP }, 1000 + i))
    expect(got.slice(0, CAP).every((room) => room === 'lobby')).toBe(true)
    expect(got[CAP]).toBe('lobby-2')
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

  it('counts held places as taken seats', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP - 2, 0, null, 2)
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby-2')
  })

  it('a rise in a room\'s report uses up its reservations, so seats are not counted twice', () => {
    const r = new RoomRegistry()
    for (let i = 0; i < 4; i++) expect(r.assign({ cap: CAP }, 0)).toBe('lobby')
    r.report('lobby', 4, 100)
    // 4 seated and 0 still reserved: 12 more fit before lobby-2.
    const next = Array.from({ length: 13 }, () => r.assign({ cap: CAP }, 200))
    expect(next.filter((x) => x === 'lobby')).toHaveLength(12)
    expect(next[12]).toBe('lobby-2')
  })

  it('lets a reservation lapse after RESERVE_MS when its arrival never turns up', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP - 1, 0)
    expect(r.assign({ cap: CAP }, 0)).toBe('lobby')
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby-2')
    r.report('lobby', CAP - 1, RESERVE_MS - 1) // still 15: the arrival is late
    expect(r.assign({ cap: CAP }, RESERVE_MS + 1)).toBe('lobby')
  })

  it('returns a reconnecting or reloading player to the room they were given', () => {
    const r = new RoomRegistry()
    r.report('lobby', 3, 0) // the public room has seats again
    r.report('lobby-2', 10, 0)
    expect(r.assign({ cap: CAP, prefer: 'lobby-2' }, 1)).toBe('lobby-2')
    // Their own held place in a full room: kept for them (the room checks the secret).
    r.report('lobby-2', CAP - 1, 2, null, 1)
    expect(r.assign({ cap: CAP, prefer: 'lobby-2' }, 3)).toBe('lobby-2')
    // Full with nobody held: a fresh assignment instead.
    r.report('lobby-2', CAP, 4)
    expect(r.assign({ cap: CAP, prefer: 'lobby-2' }, 5)).toBe('lobby')
  })

  it('ignores a prefer that is not a public room', () => {
    const r = new RoomRegistry()
    for (const prefer of ['secret-room', 'lobby-1', 'lobby-65', 'lobby-02', '../lobby', '']) {
      expect(r.assign({ cap: CAP, prefer }, 0)).toBe('lobby')
    }
  })

  it('skips a room the client was just refused by, until that room reports again', () => {
    const r = new RoomRegistry()
    r.report('lobby', 3, 0) // the registry thinks lobby has seats; a frozen crowd filled it
    expect(r.assign({ cap: CAP, full: 'lobby' }, 1)).toBe('lobby-2')
    expect(r.assign({ cap: CAP }, 2)).toBe('lobby-2')
    r.report('lobby', 5, 3)
    expect(r.assign({ cap: CAP }, 4)).toBe('lobby')
  })

  it('does not trust counts older than the presence TTL (a room reset by a deploy)', () => {
    const r = new RoomRegistry()
    r.report('lobby', CAP, 0)
    expect(r.assign({ cap: CAP }, ASSIGN_TTL_MS - 1)).toBe('lobby-2')
    expect(r.assign({ cap: CAP }, ASSIGN_TTL_MS)).toBe('lobby')
  })

  it('sends everyone to lobby (today\'s refusal) when every public room is full', () => {
    const r = new RoomRegistry()
    for (const room of publicRooms()) r.report(room, CAP, 0)
    expect(r.assign({ cap: CAP }, 1)).toBe('lobby')
    expect(publicRooms()).toHaveLength(MAX_PUBLIC_ROOMS)
    expect(publicRooms().every((room) => isPublicRoom(room))).toBe(true)
  })

  it('keeps held-only rooms for seating but counts nobody playing in them', () => {
    const r = new RoomRegistry()
    r.report('lobby', 0, 0, 'alpine', 3)
    r.report('lobby-2', 2, 0, 'alpine')
    expect(r.totals(1)).toEqual({ rooms: 1, players: 2 })
    expect(r.presence(1).byRecipe).toEqual([{ recipeId: 'alpine', rooms: 1, players: 2, oldestReportAt: 0 }])
    expect(new RoomRegistry(r.save()).totals(1)).toEqual({ rooms: 1, players: 2 })
    r.report('lobby', 0, 2, 'alpine', 0)
    expect(Object.keys(r.save())).toEqual(['lobby-2'])
  })
})

// ---------------------------------------------------------------------------------------------
// The Worker: routing, both switches, the timeout.

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
const join = (query: string) => new Request(`https://mira.cc/ws?${query}`, { headers: { Upgrade: 'websocket' } })
const flip = (env: object, on: boolean, token = TOKEN) =>
  worker.fetch(new Request('https://mira.cc/overflow', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ on }) }), env as never)

describe('public overflow in the Worker', () => {
  beforeEach(() => forgetOverflowCache())
  afterEach(() => vi.useRealTimers())

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
    expect(reached.every((r) => r.room === 'lobby' && new URL(r.request.url).searchParams.get('room') === 'lobby')).toBe(true)
    expect(OFF_CACHE_MS).toBeGreaterThan(0)
  })

  it('the switch needs the secret, and with it on the seventeenth arrival goes to lobby-2', async () => {
    const { env, reached } = environment('runtime')
    expect((await flip(env, true, 'wrong')).status).toBe(404)
    expect((await worker.fetch(new Request('https://mira.cc/overflow'), env as never)).status).toBe(404)
    expect(await (await flip(env, true)).json()).toEqual({ master: true, on: true })
    for (let i = 0; i <= CAP; i++) await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.slice(0, CAP).every((r) => r.room === 'lobby')).toBe(true)
    const last = reached[CAP]
    expect(last.room).toBe('lobby-2')
    // The room object is told its own name, so its welcome says lobby-2.
    expect(new URL(last.request.url).searchParams.get('room')).toBe('lobby-2')
    expect(last.request.headers.get('Upgrade')).toBe('websocket')
    // Off again: back to lobby for everyone.
    await flip(env, false)
    await worker.fetch(join('room=lobby&assign=1'), env as never)
    expect(reached.at(-1)!.room).toBe('lobby')
  })

  it('a frozen client (no assign) gets today\'s behaviour with overflow on', async () => {
    const { env, reached } = environment('runtime')
    await flip(env, true)
    for (let i = 0; i <= CAP; i++) await worker.fetch(join('room=lobby'), env as never)
    expect(reached.every((r) => r.room === 'lobby')).toBe(true)
  })

  it('named rooms are never reassigned', async () => {
    const { env, reached } = environment('runtime')
    await flip(env, true)
    await worker.fetch(join('room=friends&assign=1'), env as never)
    await worker.fetch(join('room=lobby-2&assign=1&prefer=lobby-3'), env as never)
    expect(reached.map((r) => r.room)).toEqual(['friends', 'lobby-2'])
  })

  it('a reconnect with prefer returns to its room while lobby has seats', async () => {
    const store: Store = new Map([['overflow', true]])
    const registry = registryObject(store)
    const { env, reached } = environment('runtime', registry)
    await registry.fetch(new Request('https://registry/report', { method: 'POST', body: JSON.stringify({ room: 'lobby', players: 4, recipeId: null }) }))
    await worker.fetch(join('room=lobby&assign=1&prefer=lobby-2'), env as never)
    expect(reached[0].room).toBe('lobby-2')
  })

  it('falls back to lobby when the registry is slow or failing', async () => {
    vi.useFakeTimers()
    const slow = environment('runtime', { fetch: () => new Promise<Response>(() => {}) })
    const pending = worker.fetch(join('room=lobby&assign=1'), slow.env as never)
    await vi.advanceTimersByTimeAsync(ASSIGN_TIMEOUT_MS)
    await pending
    expect(slow.reached.map((r) => r.room)).toEqual(['lobby'])
    vi.useRealTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = environment('runtime', { fetch: async () => { throw new Error('registry down') } })
    await worker.fetch(join('room=lobby&assign=1'), failing.env as never)
    const nonsense = environment('runtime', { fetch: async () => new Response('../etc') })
    await worker.fetch(join('room=lobby&assign=1'), nonsense.env as never)
    expect([...failing.reached, ...nonsense.reached].map((r) => r.room)).toEqual(['lobby', 'lobby'])
  })
})
