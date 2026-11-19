/**
 * The room server's log lines (server/log.ts), as stored by Workers Logs.
 *
 * Bugs these guard against: a player's typed name, chat or room name reaching stored logs;
 * and a client flooding malformed messages turning into a flood of billed log lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Room } from '../../server/room'
import { RoomDO } from '../../server/worker'
import { roomTag, sha256Hex } from '../../server/log'
import { PROTOCOL_VERSION, type ServerMessage, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

const ROOM = 'zanzibar-quokka-7'
const NAME = 'Quentin Marmalade'
const RENAMED = 'Wilhelmina Teacup'
const CHAT = 'pineapple umbrella secret'

class FakeSocket {
  sent: string[] = []
  constructor(private attachment: unknown) {}
  send(data: unknown): void {
    if (typeof data === 'string') this.sent.push(data)
  }
  close(): void {}
  serializeAttachment(value: unknown): void {
    this.attachment = value
  }
  deserializeAttachment(): unknown {
    return this.attachment
  }
}

let lines: string[]
beforeEach(() => {
  lines = []
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, level).mockImplementation(capture)
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Storage shared by successive objects for one room, as it survives an eviction. */
type Store = Map<string, unknown>
async function durableObject(sockets: FakeSocket[], store: Store = new Map()): Promise<RoomDO> {
  const state = {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => { store.set(key, structuredClone(value)) },
      deleteAll: async () => { store.clear() },
      setAlarm: async () => {},
    },
    waitUntil: () => {},
    acceptWebSocket: () => {},
    getWebSockets: () => sockets,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
  const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) }, ASSETS: { fetch: async () => new Response() } }
  const durable = new RoomDO(state as never, env as never)
  await Promise.resolve() // the constructor's storage read
  await Promise.resolve()
  return durable
}

const hello = (name: string, extra: object = {}) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: { 'game.mode': 1 }, ...extra })
const state = (p: [number, number, number]) =>
  encodeState({ id: 0, t: Date.now() / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike() }).buffer as ArrayBuffer

describe('room log lines', () => {
  it('never contain a typed room name, player name or chat, and always carry the tag', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const store: Store = new Map()
    const a = new FakeSocket({ room: ROOM, at: Date.now() })
    const b = new FakeSocket({ room: ROOM, at: Date.now() })
    const c = new FakeSocket({ room: ROOM, at: Date.now() })
    const sockets = [a, b, c]
    let room = await durableObject(sockets, store)
    room.webSocketMessage(a as never, hello(NAME, { resume: 'secret-token-aaaaaaaa' }))
    room.webSocketMessage(b as never, hello(NAME))
    room.webSocketMessage(c as never, hello(RENAMED, { resume: 'secret-token-cccccccc' }))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'zone', zone: { x: 100, z: 0, inner: 20, outer: 40, yMin: 40, yMax: 80 } }))
    room.webSocketMessage(a as never, state([130, 50, 0]))
    // Into the lava and out again: logged as the player's number only.
    room.webSocketMessage(b as never, JSON.stringify({ type: 'stuck', held: true }))
    room.webSocketMessage(b as never, JSON.stringify({ type: 'freed' }))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'chat', text: CHAT }))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'profile', name: RENAMED }))
    // A malformed message that carries the typed text: logged without its content.
    room.webSocketMessage(b as never, `{"type": "chat", "text": "${CHAT}`)
    sockets.splice(sockets.indexOf(a), 1)
    room.webSocketClose(a as never, 1001, 'going away', true)
    // Back for its held place, with its record of the drop: anything typed that a modified
    // client tucks into it (a name as the reason, the room as an extra field) is not logged.
    const back = new FakeSocket({ room: ROOM, at: Date.now() })
    sockets.push(back)
    room = await durableObject(sockets, store)
    room.webSocketMessage(back as never, hello(NAME, { resume: 'secret-token-aaaaaaaa', drop: { code: 1006, reason: NAME, clean: false, wasOpen: true, openMs: 120000.4, rxMs: 31, txMs: 12, vis: 'hidden', hiddenMs: 900, frozenMs: -1, online: true, frameMs: 4200, room: ROOM, name: RENAMED } }))
    sockets.splice(sockets.indexOf(back), 1)
    room.webSocketClose(back as never, 1001, 'going away', true)

    // Evicted with the clock running: the next object knows nothing in memory. Its clock
    // alarm rebuilds the room from the sockets and finds nobody playing.
    room = await durableObject(sockets, store)
    vi.setSystemTime(Date.now() + 1000)
    await room.alarm()
    // Evicted again: a close is the first thing the next object hears.
    room = await durableObject(sockets, store)
    sockets.splice(sockets.indexOf(c), 1)
    room.webSocketClose(c as never, 1006, '', false)
    room = await durableObject(sockets, store)
    sockets.splice(sockets.indexOf(b), 1)
    room.webSocketClose(b as never, 1000, '', true)
    // Evicted with only held places: the cleanup alarm wakes an object with no sockets and no
    // room in memory, only the stored snapshot.
    room = await durableObject(sockets, store)
    vi.setSystemTime(Date.now() + 10 * 60_000)
    await room.alarm()
    vi.useRealTimers()

    // The players heard each other's names and chat: the logs must not have.
    expect(b.sent.some((m) => m.includes(CHAT))).toBe(true)
    const events = lines.map((l) => JSON.parse(l) as { event: string; room?: unknown })
    const rejoin = events.find((x) => x.event === 'rejoin') as Record<string, unknown> | undefined
    expect(rejoin).toMatchObject({ dropCode: 1006, dropReason: 'other', dropVis: 'hidden', dropOpenMs: 120000, dropFrameMs: 4200, dropOnline: true })
    expect(Object.keys(rejoin!).filter((k) => k.startsWith('drop')).sort()).toEqual(['dropClean', 'dropCode', 'dropFrameMs', 'dropFrozenMs', 'dropHiddenMs', 'dropOnline', 'dropOpenMs', 'dropReason', 'dropRxMs', 'dropTxMs', 'dropVis', 'dropWasOpen'])
    for (const e of ['socket_close', 'hello', 'mode', 'hill_capture', 'clock_start', 'clock_stop', 'place_held', 'malformed', 'room_cleanup', 'lava_stuck', 'lava_freed']) {
      expect(events.map((x) => x.event)).toContain(e)
    }
    // Each line is one JSON object whose first key is its event name, and names its room by
    // the tag, never null, on every path including after an eviction.
    for (const line of lines) expect(Object.keys(JSON.parse(line))[0]).toBe('event')
    for (const e of events) expect(e.room, JSON.stringify(e)).toBe(roomTag(ROOM))
    expect(roomTag(ROOM)).toMatch(/^[0-9a-f]{8}$/)
    const all = lines.join('\n').toLowerCase()
    for (const typed of [ROOM, NAME, RENAMED, CHAT, 'quentin', 'wilhelmina', 'pineapple', 'zanzibar', 'secret-token']) {
      expect(all).not.toContain(typed.toLowerCase())
    }
  })

  it('a burst of malformed messages logs at most one line per connection per minute', () => {
    let clock = 100_000
    const room = new Room(ROOM, { now: () => clock })
    const peers = [0, 1].map(() => {
      const peer = { json: [] as ServerMessage[], send() {}, close() {} }
      room.connect(peer)
      room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name: NAME, params: {} }))
      return peer
    })
    lines = []
    for (let i = 0; i < 500; i++) {
      for (const peer of peers) {
        room.receive(peer, '{not json')
        room.receive(peer, JSON.stringify({ type: 'no-such-message' }))
        room.receive(peer, new Uint8Array(7))
      }
      clock += 50
    }
    // 25 s of flooding from two connections: one line each.
    expect(lines.length).toBe(2)
    clock += 60_000
    room.receive(peers[0], '{not json')
    expect(lines.length).toBe(3)
    expect(lines.every((l) => JSON.parse(l).event === 'malformed')).toBe(true)
  })

  it('tags the public room as public and others by SHA-256', () => {
    expect(roomTag('lobby')).toBe('public')
    for (const s of ['', 'a', ROOM, 'x'.repeat(200), 'späß-ü']) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'))
    }
    expect(roomTag(ROOM)).toBe(createHash('sha256').update(ROOM).digest('hex').slice(0, 8))
  })
})
