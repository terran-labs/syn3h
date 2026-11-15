/**
 * The room's checks on Bungee cords, from the networking side: a cord may only be tied to
 * something within its reach of its owner, measured round the wrap, and a cord whose owner
 * can no longer hold it is dropped for everyone. (The Bungee's own tests are in
 * tests/weapons/cord-room.test.ts.)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, WRAP_SIZES, type WireState, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  cords() { return this.json.filter((m) => m.type === 'cord').map((m) => (m as Extract<ServerMessage, { type: 'cord' }>).cord) }
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
const state = (p: [number, number, number]) => encodeState({ id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike() } satisfies WireState)
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
/** A small planet (tile 1024 m), cords allowed, 40 m of cord. */
const world = { 'bungee.allowed': true, 'bungee.vehicles': true, 'bungee.length': 40, 'terrain.planetSize': 0 }
const HALF = WRAP_SIZES[0] / 2

beforeEach(() => {
  clock = 100_000
  room = new Room('cord', { now: () => clock })
})

describe('Room cords tied to vehicles', () => {
  it('relays a cord to a vehicle within reach, and refuses one to a vehicle across the world', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    room.receive(c.peer, state([400, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: c.id, r: 30 } })
    expect(b.peer.cords()).toEqual([])
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    expect(c.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }])
    // The one tied to hears it too: its own game is what pulls it.
    expect(b.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }])
  })

  it('needs to know where both vehicles are', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    // Nobody has sent a state yet.
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    expect(c.peer.cords()).toEqual([])
    // A ground anchor needs the owner's position too.
    const d = join('D')
    send(d.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -20], n: [0, 1, 0], r: 20 } })
    expect(c.peer.cords()).toEqual([])
  })

  it('measures reach round the wrap: a vehicle just across the seam can be tied to', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    room.receive(a.peer, state([HALF - 5, 0, 0]))
    room.receive(b.peer, state([-HALF + 15, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 20 } })
    expect(c.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 20 }])
    // And so can the ground there.
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [-HALF + 10, 0, 0], n: [0, 1, 0], r: 15 } })
    expect(c.peer.cords().at(-1)).toEqual({ s: 'on', at: [-HALF + 10, 0, 0], n: [0, 1, 0], r: 15 })
  })

  it('tells everyone a cord is off when its refresh finds the two out of reach', () => {
    const a = join('A', world)
    const b = join('B')
    const c = join('C')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    // B is flung away; A's game keeps refreshing the cord (or a cheat never lets go).
    room.receive(b.peer, state([0, 0, -300]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    expect(c.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }, { s: 'off' }])
    expect(b.peer.cords().at(-1)).toEqual({ s: 'off' })
    // Said once, not on every refused refresh.
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    expect(c.peer.cords()).toHaveLength(2)
  })

  it('drops the cord of a player whose place is being held for a rejoin', () => {
    const a = join('A', { ...world, 'game.rejoin': true }, { resume: 'a'.repeat(32) })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    room.disconnect(a.peer)
    expect(room.heldCount).toBe(1)
    expect(b.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }, { s: 'off' }])
  })

  it('replaces a surface normal that is not a direction', () => {
    const a = join('A', world)
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -20], n: [0, 900, 0], r: 20 } })
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -20], n: [0, 0.6, 0.8], r: 20 } })
    expect(b.peer.cords().map((c) => (c as { n: number[] }).n)).toEqual([[0, 1, 0], [0, 0.6, 0.8]])
  })
})

describe('Room cords whose other end goes away', () => {
  /** A ties to B, C watches. */
  function tied(params: Record<string, number | boolean> = {}) {
    const a = join('A', { ...world, ...params })
    const b = join('B', {}, { resume: 'b'.repeat(32) })
    const c = join('C')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    room.receive(c.peer, state([5, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    return { a, b, c }
  }

  it('drops a cord tied to a player whose place is being held, and refuses its refresh', () => {
    const { a, b, c } = tied({ 'game.rejoin': true })
    room.disconnect(b.peer)
    expect(room.heldCount).toBe(1)
    // Everyone, the owner too: its game must stop pulling toward a vehicle frozen in place.
    expect(c.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }, { s: 'off' }])
    expect(a.peer.cords()).toEqual([{ s: 'off' }])
    // The owner's next refresh, sent before it heard, ties nothing to the held place.
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    room.tick()
    expect(c.peer.cords()).toHaveLength(2)
  })

  it('drops a cord tied to a player who left, said once', () => {
    const { a, b, c } = tied({ 'game.rejoin': false })
    room.disconnect(b.peer)
    expect(room.heldCount).toBe(0)
    expect(c.peer.cords()).toEqual([{ s: 'on', to: b.id, r: 30 }, { s: 'off' }])
    expect(a.peer.cords()).toEqual([{ s: 'off' }])
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
    expect(c.peer.cords()).toHaveLength(2)
  })

})
