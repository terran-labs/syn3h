/**
 * The lobby's active count across a room rebuild.
 *
 * Bug this guards against: a release resets every room at once, and a room woken from
 * hibernation is rebuilt from its sockets. Without the pause bit kept with the socket and the
 * room's roster, every paused player read as active until their next state, and a locked
 * phone sends none: the lobby counted them as players to join for minutes.
 */
import { describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_PAUSE_MS, PAUSE_PERSIST_MS, Room, type Peer, type RoomSnapshot } from '../../server/room'
import { RoomDO } from '../../server/worker'
import { encodeState, PROTOCOL_VERSION } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

const TOKEN = 'paused-wake-token-1234567890'
const hello = (name: string, resume?: string) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: { 'game.rejoin': true }, ...(resume ? { resume } : {}) })
const state = (paused: boolean) =>
  encodeState({ id: 0, t: 1, p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused })
const peer = (): Peer => ({ send() {}, close() {} })

describe('paused players stay paused across a rebuild', () => {
  it('adopt: a socket kept as paused counts as paused until its next state', () => {
    const r = new Room('wake')
    const a = peer(), b = peer()
    r.adopt(a, { id: 1, name: 'A', slot: 0, score: 0, kind: 'buggy', colors: ['#000000', '#ffffff'] }, null, true)
    r.adopt(b, { id: 2, name: 'B', slot: 1, score: 0, kind: 'buggy', colors: ['#000000', '#ffffff'] }, null, false)
    expect(r.presence()).toMatchObject({ players: 2, active: 1 })
    r.receive(a, state(false))
    expect(r.presence()).toMatchObject({ players: 2, active: 2 })
  })

  it('restore: a paused player rejoining after a release counts as paused until their next state', () => {
    let saved: RoomSnapshot | undefined
    let now = 1_000_000
    const before = new Room('release', { now: () => now, onPersist: (s) => { saved = s } })
    const a = peer()
    before.connect(a); before.receive(a, hello('A', TOKEN))
    before.receive(a, state(true))
    // Pausing reaches the roster lazily, with the heartbeats (PAUSE_PERSIST_MS).
    for (let t = 0; t < PAUSE_PERSIST_MS; t += 1000) { now += 1000; before.receive(a, state(true)) }
    expect(saved?.roster?.[0]).toMatchObject({ token: TOKEN, paused: true })
    // The release: a new room from storage, nobody connected; A reconnects with its secret.
    const after = new Room('release', { now: () => now })
    after.restore(structuredClone(saved!))
    const again = peer()
    after.connect(again); after.receive(again, hello('A', TOKEN))
    expect(after.presence()).toMatchObject({ players: 1, active: 0 })
    after.receive(again, state(false))
    expect(after.presence()).toMatchObject({ players: 1, active: 1 })
  })

  it('the Worker keeps the pause bit with the socket and adopts with it after a wake', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    class FakeSocket {
      constructor(public attachment: unknown) {}
      send() {}
      close() {}
      serializeAttachment(v: unknown) { this.attachment = v }
      deserializeAttachment() { return this.attachment }
    }
    const reports: { players: number; active?: number }[] = []
    const store = new Map<string, unknown>()
    const make = (sockets: FakeSocket[]) => {
      const state = {
        storage: {
          get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)) },
          deleteAll: async () => { store.clear() }, setAlarm: async () => {},
        },
        waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => sockets,
        blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
      }
      const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async (req: Request) => { reports.push(await req.json()); return new Response(null, { status: 204 }) } }) } }
      return new RoomDO(state as never, env as never)
    }
    // A joined, then paused: the socket's attachment says so.
    const ws = new FakeSocket({ room: 'wake-do', at: 1 })
    const first = make([ws])
    await Promise.resolve(); await Promise.resolve()
    first.webSocketMessage(ws as never, hello('A'))
    first.webSocketMessage(ws as never, state(true) as never)
    expect(ws.attachment).toMatchObject({ paused: true })
    // Hibernation: a new object over the same socket and storage; its first event is a ping.
    const woken = make([ws])
    await Promise.resolve(); await Promise.resolve()
    woken.webSocketMessage(ws as never, JSON.stringify({ type: 'ping', t: 1 }))
    await new Promise((r) => setTimeout(r, 0))
    expect(reports.at(-1)).toMatchObject({ players: 1, active: 0 })
  })
})

describe('pause persistence is bounded, whatever a client sends', () => {
  it('flapping the pause bit 200 times a second writes the room at most once per PAUSE_PERSIST_MS', () => {
    let now = 1_000_000, writes = 0
    const r = new Room('flap', { now: () => now, onPersist: () => { writes++ } })
    const a = peer()
    r.connect(a); r.receive(a, hello('A', TOKEN))
    writes = 0
    // One second: 200 flips (the state budget accepts 70 of them).
    for (let i = 0; i < 200; i++) { now += 5; r.receive(a, state(i % 2 === 0)) }
    expect(writes).toBeLessThanOrEqual(1)
    // A minute of the same: pause-driven writes plus the room's 30 s activity writes.
    writes = 0
    for (let i = 0; i < 200 * 60; i++) { now += 5; r.receive(a, state(i % 2 === 0)) }
    expect(writes).toBeLessThanOrEqual(60_000 / PAUSE_PERSIST_MS + 2)
  })

  it('the latest pause bit still reaches storage within PAUSE_PERSIST_MS of heartbeats', () => {
    let now = 1_000_000
    let saved: RoomSnapshot | undefined
    const r = new Room('lazy', { now: () => now, onPersist: (s) => { saved = s } })
    const a = peer()
    r.connect(a); r.receive(a, hello('A', TOKEN))
    r.receive(a, state(true))
    for (let t = 0; t < PAUSE_PERSIST_MS; t += 1000) { now += 1000; r.receive(a, state(true)) } // heartbeats
    expect(saved?.roster?.[0]).toMatchObject({ paused: true })
  })

  it('flapping rewrites a socket attachment at most once per ATTACHMENT_PAUSE_MS', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let clock = 5_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let rewrites = 0
    const ws = {
      attachment: { room: 'flap-do', at: 1 } as unknown,
      send() {}, close() {},
      serializeAttachment(v: unknown) { rewrites++; this.attachment = v },
      deserializeAttachment() { return this.attachment },
    }
    const state0 = {
      storage: { get: async () => undefined, put: async () => {}, deleteAll: async () => {}, setAlarm: async () => {} },
      waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [ws],
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } }
    const room = new RoomDO(state0 as never, env as never)
    await Promise.resolve(); await Promise.resolve()
    room.webSocketMessage(ws as never, hello('A'))
    rewrites = 0
    for (let i = 0; i < 200; i++) { clock += 5; room.webSocketMessage(ws as never, state(i % 2 === 0) as never) }
    expect(rewrites).toBeLessThanOrEqual(1)
    // Ten seconds of flapping: at most one a second.
    rewrites = 0
    for (let i = 0; i < 2000; i++) { clock += 5; room.webSocketMessage(ws as never, state(i % 2 === 0) as never) }
    expect(rewrites).toBeLessThanOrEqual(10_000 / ATTACHMENT_PAUSE_MS + 1)
    vi.restoreAllMocks()
  })
})
