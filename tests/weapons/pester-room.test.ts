import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.json.filter((m) => m.type === type) as never
  }
}

let clock = 0
let room: Room
function join(name: string, params: Record<string, number | boolean> = {}) {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, params }))
  return { peer, id: peer.all('welcome')[0]!.id }
}
function state(p: [number, number, number]): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false } }
  return encodeState(s)
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
const pester = (id: number, to: number, extra: object = {}) => ({ type: 'fire', shot: { id, o: [0, 1, -2], d: [0, 0.4, -1], boost: 0, t: clock / 1000, k: 'pester', to, ...extra } })

describe('Pesters in the room', () => {
  beforeEach(() => { clock = 100_000; room = new Room('test', { now: () => clock }) })

  function three() {
    const a = join('A', { 'pester.allowed': true })
    const b = join('B')
    const c = join('C')
    clock += 10_000
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -40]))
    room.receive(c.peer, state([0, 0, -900]))
    return { a, b, c }
  }

  it('refuses a launch while Pesters are off', () => {
    const a = join('A')
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -40]))
    send(a.peer, pester(1, b.id))
    expect(b.peer.all('fire')).toHaveLength(0)
  })

  it('relays a launch at a target in range, rebuilt clean', () => {
    const { a, b, c } = three()
    send(a.peer, pester(1, b.id, { boost: 99, junk: 1 }))
    const got = b.peer.all('fire')
    expect(got).toHaveLength(1)
    expect(got[0].shot).toEqual({ id: 1, o: [0, 1, -2], d: expect.any(Array), boost: 0, t: expect.any(Number), k: 'pester', to: b.id })
    // Out of range, yourself, and nobody.
    clock += 2000
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, pester(2, c.id))
    send(a.peer, pester(3, a.id))
    send(a.peer, pester(4, 4242))
    expect(b.peer.all('fire')).toHaveLength(1)
  })

  it('keeps to its recharge and to pester.max out at once', () => {
    const { a, b } = three()
    send(a.peer, pester(1, b.id))
    send(a.peer, pester(2, b.id))
    expect(b.peer.all('fire')).toHaveLength(1)
    for (let i = 2; i <= 5; i++) {
      clock += 1500
      room.receive(a.peer, state([0, 0, 0])); room.receive(b.peer, state([0, 0, -40]))
      send(a.peer, pester(i, b.id))
    }
    expect(b.peer.all('fire').map((m) => m.shot.id)).toEqual([1, 2, 3])
  })

  it('counts a catch only by the vehicle it chased, within its own lifetime', () => {
    const { a, b, c } = three()
    room.receive(c.peer, state([0, 0, -30]))
    send(a.peer, pester(1, b.id))
    // C claims B's Pester: refused.
    send(c.peer, { type: 'hit', shooter: a.id, shot: 1 })
    expect(c.peer.all('hit')).toHaveLength(0)
    send(b.peer, { type: 'hit', shooter: a.id, shot: 1 })
    expect(c.peer.all('hit')).toEqual([{ type: 'hit', shooter: a.id, victim: b.id, shot: 1 }])
    // A is "it": a point for A.
    expect(a.peer.all('game').at(-1)).toMatchObject({ event: 'score' })
  })
})
