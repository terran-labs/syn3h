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

function durableObject(sockets: FakeSocket[]): RoomDO {
  const state = {
    storage: { get: async () => undefined, put: async () => {}, deleteAll: async () => {}, setAlarm: async () => {} },
    waitUntil: () => {},
    acceptWebSocket: () => {},
    getWebSockets: () => sockets,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
  const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) }, ASSETS: { fetch: async () => new Response() } }
  return new RoomDO(state as never, env as never)
}

const hello = (name: string, extra: object = {}) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: { 'game.mode': 1 }, ...extra })
const state = (p: [number, number, number]) =>
  encodeState({ id: 0, t: Date.now() / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike() }).buffer as ArrayBuffer

describe('room log lines', () => {
  it('never contain a typed room name, player name or chat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const a = new FakeSocket({ room: ROOM, at: Date.now() })
    const b = new FakeSocket({ room: ROOM, at: Date.now() })
    const sockets = [a, b]
    const room = durableObject(sockets)
    room.webSocketMessage(a as never, hello(NAME, { resume: 'secret-token-aaaaaaaa' }))
    room.webSocketMessage(b as never, hello(NAME))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'zone', zone: { x: 100, z: 0, inner: 20, outer: 40, yMin: 40, yMax: 80 } }))
    room.webSocketMessage(a as never, state([130, 50, 0]))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'chat', text: CHAT }))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'profile', name: RENAMED }))
    room.webSocketMessage(a as never, JSON.stringify({ type: 'param', id: 'game.mode', value: 0 }))
    // A malformed message that carries the typed text: logged without its content.
    room.webSocketMessage(b as never, `{"type": "chat", "text": "${CHAT}`)
    sockets.splice(0, 1)
    room.webSocketClose(a as never, 1001, 'going away', true)
    sockets.splice(0, 1)
    room.webSocketClose(b as never, 1006, '', false)
    // The held place runs out with nobody back: the cleanup alarm tidies up.
    vi.setSystemTime(Date.now() + 10 * 60_000)
    await room.alarm()
    vi.useRealTimers()

    // The players heard each other's names and chat: the logs must not have.
    expect(b.sent.some((m) => m.includes(CHAT))).toBe(true)
    const events = lines.map((l) => JSON.parse(l) as { event: string; room?: string })
    for (const e of ['socket_close', 'hello', 'mode', 'hill_capture', 'place_held', 'malformed', 'room_cleanup']) {
      expect(events.map((x) => x.event)).toContain(e)
    }
    // Each line is one JSON object whose first key is its event name.
    for (const line of lines) expect(Object.keys(JSON.parse(line))[0]).toBe('event')
    expect(events.filter((e) => e.room).every((e) => e.room === roomTag(ROOM))).toBe(true)
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
