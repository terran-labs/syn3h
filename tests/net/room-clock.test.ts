/**
 * The room's own clock (Room.needsClock, CLOCK_MS) and the Worker's alarm that runs it.
 *
 * Bug this guards against: two production releases were rolled back because a player alone on
 * the hill was shown holding it for 15 s and scored 0 or 1 points. The room only ticked when a
 * client message arrived, so quiet or stalled pages stopped the scoring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOCK_MS, type Peer, Room } from '../../server/room'
import { RoomDO } from '../../server/worker'
import { PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.json.push(JSON.parse(data))
  }
  close(): void {}
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
}

const zone = { x: 100, z: 0, inner: 20, outer: 40, yMin: 40, yMax: 80 }
const inside: [number, number, number] = [130, 50, 0]
const elsewhere: [number, number, number] = [0, 0, 0]

let clock = 0
let room: Room

const hello = (name: string, params: Record<string, number | boolean> = {}) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params })
function state(p: [number, number, number], extra: Partial<WireState> = {}): Uint8Array {
  return encodeState({ id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), ...extra })
}
function join(name: string, params: Record<string, number | boolean> = {}): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, hello(name, params))
  return { peer, id: peer.last('welcome')!.id }
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))

/** A and B in King of the Hill with a zone, A on the hill and B away, both having just spoken. */
function hill() {
  const a = join('A', { 'game.mode': 1 })
  const b = join('B')
  send(a.peer, { type: 'zone', zone })
  room.receive(a.peer, state(inside))
  room.receive(b.peer, state(elsewhere))
  return { a, b }
}
/** Room time passes with no client messages at all; only the clock ticks the room. */
function clockOnly(ms: number) {
  for (let t = 0; t < ms; t += CLOCK_MS) {
    clock += CLOCK_MS
    if (room.needsClock) room.tick()
  }
}
const score = (peer: FakePeer, id: number) => peer.last('game')!.game.scores[id] ?? 0

beforeEach(() => {
  clock = 100_000
  room = new Room('clock', { now: () => clock })
})

describe("the room's own clock", () => {
  it('scores a holder alone on the hill with no client messages', () => {
    const { a, b } = hill()
    expect(room.needsClock).toBe(true)
    // A two second stall, then the page speaks again (a teleport, a phone under load): the
    // hill does not flap to nobody, and every second of room time is paid.
    clockOnly(2 * CLOCK_MS)
    expect(b.peer.last('game')!.game.koth.holder).toBe(a.id)
    room.receive(a.peer, state(inside))
    const before = score(b.peer, a.id)
    for (let i = 0; i < 10; i++) {
      clockOnly(CLOCK_MS)
      // The page reports its position about once every two seconds of room time: stalled.
      if (i % 2) room.receive(a.peer, state(inside))
    }
    expect(score(b.peer, a.id) - before).toBeGreaterThanOrEqual(9)
    expect(score(b.peer, a.id) - before).toBeLessThanOrEqual(10)
  })

  it('lets go of a page that has truly stopped, rather than scoring it forever', () => {
    const { a, b } = hill()
    clockOnly(10 * CLOCK_MS)
    expect(b.peer.last('game')!.game.koth.holder).toBe(0)
    expect(score(b.peer, a.id)).toBeLessThanOrEqual(3)
  })

  it('does not score while two are inside', () => {
    const { a, b } = hill()
    room.receive(b.peer, state(inside))
    for (let i = 0; i < 10; i++) {
      clockOnly(CLOCK_MS)
      room.receive(a.peer, state(inside))
      room.receive(b.peer, state(inside))
    }
    expect(b.peer.last('game')!.game.koth.contested).toBe(true)
    expect(score(b.peer, a.id)).toBe(0)
    expect(score(b.peer, b.id)).toBe(0)
  })

  it('a paused holder or a held place does not score', () => {
    const { a, b } = hill()
    room.receive(a.peer, state(inside, { paused: true }))
    for (let i = 0; i < 5; i++) {
      clockOnly(CLOCK_MS)
      room.receive(a.peer, state(inside, { paused: true }))
      room.receive(b.peer, state(elsewhere))
    }
    expect(score(b.peer, a.id)).toBe(0)
    // Back on the hill, then the socket drops: the place is held for a rejoin (game.rejoin)
    // with A's last state inside the zone, and must not keep scoring.
    room.receive(a.peer, state(inside))
    clockOnly(CLOCK_MS)
    room.disconnect(a.peer)
    const before = score(b.peer, a.id)
    for (let i = 0; i < 5; i++) {
      clockOnly(CLOCK_MS)
      room.receive(b.peer, state(elsewhere))
    }
    expect(b.peer.last('game')!.game.koth.holder).toBe(0)
    expect(score(b.peer, a.id)).toBe(before)
  })

  it('counts each moment once when messages and the clock interleave', () => {
    const { a, b } = hill()
    // Ten seconds of room time: states every 50 ms and a clock tick every second between them,
    // sometimes in the same millisecond.
    for (let ms = 0; ms < 10_000; ms += 50) {
      clock += 50
      room.receive(a.peer, state(inside))
      if (ms % 1000 === 0) room.tick()
      if (ms % 2000 === 0) room.tick()
    }
    expect(score(b.peer, a.id)).toBeGreaterThanOrEqual(9)
    expect(score(b.peer, a.id)).toBeLessThanOrEqual(10)
  })

  it('needs no clock with nobody connected and playing, or in Explore', () => {
    expect(room.needsClock).toBe(false)
    const { a, b } = hill()
    expect(room.needsClock).toBe(true)
    room.receive(a.peer, state(inside, { paused: true }))
    room.receive(b.peer, state(elsewhere, { paused: true }))
    expect(room.needsClock).toBe(false)
    room.disconnect(a.peer)
    room.disconnect(b.peer)
    expect(room.needsClock).toBe(false)

    room = new Room('explore', { now: () => clock })
    const c = join('C', { 'game.mode': 0 })
    room.receive(c.peer, state(elsewhere))
    expect(room.needsClock).toBe(false)
  })
})

/** The Worker's Durable Object with a fake runtime: sockets, storage and its single alarm. */
describe('RoomDO runs the clock with its alarm', () => {
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
    lastGame(): Extract<ServerMessage, { type: 'game' }> {
      const games = this.sent.map((s) => JSON.parse(s) as ServerMessage).filter((m) => m.type === 'game')
      return games[games.length - 1] as never
    }
  }
  let sockets: FakeSocket[]
  let alarms: number[]
  let durable: RoomDO

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    sockets = []
    alarms = []
    const state = {
      storage: {
        get: async () => undefined,
        put: async () => {},
        deleteAll: async () => {},
        setAlarm: async (at: number) => { alarms.push(at) },
      },
      waitUntil: () => {},
      acceptWebSocket: () => {},
      getWebSockets: () => sockets,
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
    const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) }, ASSETS: { fetch: async () => new Response() } }
    durable = new RoomDO(state as never, env as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const now = () => Date.now()
  const msgState = (p: [number, number, number]) =>
    encodeState({ id: 0, t: now() / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike() }).buffer as ArrayBuffer

  it('keeps scoring on alarms alone, and schedules nothing once nobody needs it', async () => {
    const a = new FakeSocket({ room: 'hill' })
    const b = new FakeSocket({ room: 'hill' })
    sockets.push(a, b)
    durable.webSocketMessage(a as never, hello('A', { 'game.mode': 1 }))
    durable.webSocketMessage(b as never, hello('B'))
    expect(alarms).toEqual([])
    durable.webSocketMessage(a as never, JSON.stringify({ type: 'zone', zone }))
    durable.webSocketMessage(a as never, msgState(inside))
    durable.webSocketMessage(b as never, msgState(elsewhere))
    // One alarm, however many messages arrive before it fires.
    expect(alarms).toEqual([now() + CLOCK_MS])
    const aId = (JSON.parse(a.sent[0]) as Extract<ServerMessage, { type: 'welcome' }>).id

    // Pages fall quiet; the room's alarm carries on, a second apart. A speaks every other
    // second (a stalled page), B not at all after its pause below.
    durable.webSocketMessage(b as never, encodeState({ id: 0, t: now() / 1000, p: elsewhere, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused: true }).buffer as ArrayBuffer)
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(alarms[alarms.length - 1])
      await durable.alarm()
      if (i % 2) durable.webSocketMessage(a as never, msgState(inside))
    }
    expect(alarms.length).toBe(11)
    expect(b.lastGame().game.koth.holder).toBe(aId)
    expect(b.lastGame().game.scores[aId]).toBeGreaterThanOrEqual(9)

    // A pauses too: nobody is playing, so the next alarm is the last.
    durable.webSocketMessage(a as never, encodeState({ id: 0, t: now() / 1000, p: inside, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused: true }).buffer as ArrayBuffer)
    vi.setSystemTime(alarms[alarms.length - 1])
    await durable.alarm()
    const count = alarms.length
    durable.webSocketMessage(a as never, encodeState({ id: 0, t: now() / 1000, p: inside, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused: true }).buffer as ArrayBuffer)
    expect(alarms.length).toBe(count)
  })

  it('an Explore room never sets an alarm while players are connected', () => {
    const a = new FakeSocket({ room: 'explore' })
    sockets.push(a)
    durable.webSocketMessage(a as never, hello('A', { 'game.mode': 0 }))
    for (let i = 0; i < 20; i++) durable.webSocketMessage(a as never, msgState(elsewhere))
    expect(alarms).toEqual([])
  })
})
