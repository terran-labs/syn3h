/**
 * The room's hold on Yoink (grab, carry, fling, gust), from the networking side. The vehicle
 * acted on is moved by its own client on the word of the relayed message, so the room's
 * checks are what stop a modified client. (The Yoink's own tests are in tests/weapons.)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, WRAP_SIZES, type WireState, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

type Yoink = Extract<ServerMessage, { type: 'yoink' }>
class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  yoinks() { return this.json.filter((m): m is Yoink => m.type === 'yoink').map((m) => ({ from: m.from, ...m.y })) }
}
let clock = 0
let room: Room
const join = (name: string, params: Record<string, number | boolean> = {}, extra: object = {}) => {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, params, ...extra }))
  const welcome = peer.json.find((m) => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>
  return { peer, id: welcome.id }
}
const state = (p: [number, number, number], v: [number, number, number] = [0, 0, 0], extra: Partial<WireState> = {}) =>
  encodeState({ id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike(), ...extra } satisfies WireState)
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
/** Yoink on: reach 40 m, carry for at most 4 s, fling 28 m/s, recharge 0.8 s; small planet. */
const world = { 'yoink.allowed': true, 'terrain.planetSize': 0 }
const HALF = WRAP_SIZES[0] / 2
type Joined = ReturnType<typeof join>
/** Advance time, everyone repeating where they are, so nobody goes quiet. */
function run(ms: number, places: [Joined, [number, number, number]][], step = 250) {
  for (let t = 0; t < ms; t += step) {
    clock += step
    for (const [p, at] of places) room.receive(p.peer, state(at))
  }
}

beforeEach(() => {
  clock = 100_000
  room = new Room('yoink', { now: () => clock })
})

describe('Room Yoink carries', () => {
  it('ends a carry itself when the time limit passes, though the holder never lets go', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -20]], [c, [5, 0, 0]]]
    run(250, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(b.peer.yoinks()).toEqual([{ from: a.id, s: 'grab', to: b.id }])
    // A modified client holds on. Four seconds is the room's limit; a little slack, then drop.
    run(5000, places)
    expect(b.peer.yoinks()).toEqual([{ from: a.id, s: 'grab', to: b.id }])
    run(1000, places)
    expect(b.peer.yoinks().at(-1)).toEqual({ from: a.id, s: 'drop', to: b.id })
    expect(c.peer.yoinks().at(-1)).toEqual({ from: a.id, s: 'drop', to: b.id })
    // Said once.
    run(3000, places)
    expect(b.peer.yoinks()).toHaveLength(2)
  })

  it('ends a carry within thirty seconds even when the slider says no limit', () => {
    const a = join('A', { ...world, 'yoink.holdTime': 0 })
    const b = join('B')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -20]]]
    run(250, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    run(29_000, places)
    expect(b.peer.yoinks()).toHaveLength(1)
    run(2000, places)
    expect(b.peer.yoinks().at(-1)).toEqual({ from: a.id, s: 'drop', to: b.id })
  })

  it('ends a carry when the holder drives out of reach, goes quiet, parks or leaves', () => {
    const cases: ((a: Joined, b: Joined) => void)[] = [
      (a, b) => run(500, [[a, [300, 0, 0]], [b, [0, 0, -20]]]),
      (a, b) => run(2000, [[b, [0, 0, -20]]]),
      (a, b) => { clock += 250; room.receive(a.peer, state([0, 0, 0], [0, 0, 0], { paused: true })); room.receive(b.peer, state([0, 0, -20])) },
      (a) => room.disconnect(a.peer),
    ]
    for (const happen of cases) {
      room = new Room('yoink', { now: () => clock })
      const a = join('A', world)
      const b = join('B')
      run(250, [[a, [0, 0, 0]], [b, [0, 0, -20]]])
      send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
      happen(a, b)
      expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'drop'])
    }
  })

  it('drops the carry of a player whose place is held for a rejoin', () => {
    const a = join('A', { ...world, 'game.rejoin': true }, { resume: 'a'.repeat(32) })
    const b = join('B')
    run(250, [[a, [0, 0, 0]], [b, [0, 0, -20]]])
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    room.disconnect(a.peer)
    expect(room.heldCount).toBe(1)
    expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'drop'])
  })

  it('lets one player carry a vehicle at a time, and a player carry one vehicle', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -20]], [c, [5, 0, 0]]]
    run(250, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    // C cannot take B out of A's grip.
    send(c.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(b.peer.yoinks()).toHaveLength(1)
    // After the recharge A grabs C: the room drops B first.
    run(1000, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: c.id } })
    expect(b.peer.yoinks().map((y) => [y.s, y.to])).toEqual([['grab', b.id], ['drop', b.id], ['grab', c.id]])
  })

  it('relays a drop or a fling that ends the sender\'s own carry, and ignores a drop of anything else', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -20]], [c, [5, 0, 0]]]
    run(250, places)
    send(c.peer, { type: 'yoink', y: { s: 'drop', to: b.id } })
    expect(b.peer.yoinks()).toEqual([])
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    send(c.peer, { type: 'yoink', y: { s: 'drop', to: b.id } })
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 5, -28] } })
    expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'fling'])
    // The carry is over: the room has nothing left to end.
    run(8000, places)
    expect(b.peer.yoinks()).toHaveLength(2)
  })
})

describe('Room Yoink flings and gusts', () => {
  it('rations gusts to one per sender and target per recharge: they cannot be stacked', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -10]], [c, [5, 0, 0]]]
    run(250, places)
    for (let i = 0; i < 30; i++) send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 2, -18] } })
    expect(b.peer.yoinks()).toHaveLength(1)
    // One gust reaches several vehicles in its cone: each target has its own ration.
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: c.id, v: [18, 2, 0] } })
    expect(c.peer.yoinks().filter((y) => y.to === c.id)).toHaveLength(1)
    run(500, places)
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 2, -18] } })
    expect(b.peer.yoinks().filter((y) => y.to === b.id)).toHaveLength(1)
    run(500, places)
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 2, -18] } })
    expect(b.peer.yoinks().filter((y) => y.to === b.id)).toHaveLength(2)
  })

  it('rations grabs by the recharge too', () => {
    const a = join('A', world)
    const b = join('B')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -10]]]
    run(250, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    send(a.peer, { type: 'yoink', y: { s: 'drop', to: b.id } })
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'drop'])
    run(1000, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'drop', 'grab'])
  })

  it('does not let a sender raise its fling limit by claiming an absurd speed of its own', () => {
    const a = join('A', world)
    const b = join('B')
    // A's state says it is doing 5000 m/s. Only 60 m/s of that counts: 28 x 1.25 + 60 + 5 = 100.
    clock += 250
    room.receive(a.peer, state([0, 0, 0], [0, 0, -5000]))
    room.receive(b.peer, state([0, 0, -10]))
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 0, -400] } })
    expect(b.peer.yoinks()).toEqual([])
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 0, -99] } })
    expect(b.peer.yoinks()).toHaveLength(1)
  })

  it('acts only on a vehicle that is placed, playing and within reach, round the wrap', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    // Nobody placed yet.
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    clock += 250
    room.receive(a.peer, state([HALF - 5, 0, 0]))
    // B parked (a hidden tab): frozen on its owner's screen, it cannot be carried.
    room.receive(b.peer, state([-HALF + 15, 0, 0], [0, 0, 0], { paused: true }))
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(c.peer.yoinks()).toEqual([])
    // B playing, 20 m away across the seam: in reach.
    room.receive(b.peer, state([-HALF + 15, 0, 0]))
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(c.peer.yoinks()).toEqual([{ from: a.id, s: 'grab', to: b.id }])
    // A sender whose own states stopped two seconds ago is not believed.
    clock += 2000
    room.receive(b.peer, state([-HALF + 15, 0, 0]))
    room.receive(c.peer, state([0, 0, 0]))
    const before = c.peer.yoinks().length
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: c.id, v: [1, 0, 0] } })
    expect(c.peer.yoinks().filter((y) => y.s === 'fling')).toEqual([])
    expect(c.peer.yoinks().length).toBeGreaterThanOrEqual(before)
  })
})

describe('Room Yoink carries whose other end goes away', () => {
  it('drops the carry of a vehicle whose place is held for a rejoin', () => {
    const a = join('A', { ...world, 'game.rejoin': true })
    const b = join('B', {}, { resume: 'b'.repeat(32) })
    const c = join('C')
    run(250, [[a, [0, 0, 0]], [b, [0, 0, -20]], [c, [5, 0, 0]]])
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    room.disconnect(b.peer)
    expect(room.heldCount).toBe(1)
    run(250, [[a, [0, 0, 0]], [c, [5, 0, 0]]])
    expect(c.peer.yoinks().map((y) => [y.s, y.to])).toEqual([['grab', b.id], ['drop', b.id]])
    expect(a.peer.yoinks()).toEqual([{ from: a.id, s: 'drop', to: b.id }])
    // Nor can the held place be grabbed again.
    run(1000, [[a, [0, 0, 0]], [c, [5, 0, 0]]])
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(c.peer.yoinks()).toHaveLength(2)
  })

  it('drops a carry when the host switches Yoink off', () => {
    const a = join('A', world)
    const b = join('B')
    const places: [Joined, [number, number, number]][] = [[a, [0, 0, 0]], [b, [0, 0, -20]]]
    run(250, places)
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    send(a.peer, { type: 'param', id: 'yoink.allowed', value: false })
    run(250, places)
    expect(b.peer.yoinks().map((y) => y.s)).toEqual(['grab', 'drop'])
    run(1000, places)
    expect(b.peer.yoinks()).toHaveLength(2)
  })
})
