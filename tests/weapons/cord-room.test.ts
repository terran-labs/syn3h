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

function join(name: string, params: Record<string, number | boolean> = {}): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, params }))
  const welcome = peer.all('welcome')[0]!
  return { peer, id: welcome.id }
}

function state(p: [number, number, number]): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false } }
  return encodeState(s)
}

const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))

beforeEach(() => {
  clock = 100_000
  room = new Room('test', { now: () => clock })
})

describe('Bungee cords in the room', () => {
  it('relays nothing while the Bungee is off', () => {
    const a = join('A', { 'bungee.allowed': false })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 20 } })
    expect(b.peer.all('cord')).toHaveLength(0)
  })

  it('relays a checked cord to everyone else, stamped with the sender and time', () => {
    const a = join('A', { 'bungee.allowed': true })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'cord', cord: { s: 'hook', o: [0, 1, -1], d: [0, 0, -160], t: clock / 1000, extra: 'dropped' } })
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 29.5 } })
    send(a.peer, { type: 'cord', cord: { s: 'off' } })
    const got = b.peer.all('cord')
    expect(got.map((m) => m.cord.s)).toEqual(['hook', 'on', 'off'])
    expect(got[0]).toMatchObject({ from: a.id, cord: { s: 'hook', o: [0, 1, -1] } })
    expect('extra' in got[0].cord).toBe(false)
    expect(got[1].cord).toEqual({ s: 'on', to: b.id, r: 29.5 })
    expect(a.peer.all('cord')).toHaveLength(0)
  })

  it('rejects hooks from elsewhere, out of reach anchors, cords to nobody and to yourself', () => {
    const a = join('A', { 'bungee.allowed': true })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'hook', o: [400, 0, 0], d: [0, 0, -160], t: clock / 1000 } })
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -900], r: 20 } })
    send(a.peer, { type: 'cord', cord: { s: 'on', to: 9999, r: 20 } })
    send(a.peer, { type: 'cord', cord: { s: 'on', to: a.id, r: 20 } })
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -40], r: 5000 } })
    send(a.peer, { type: 'cord', cord: { s: 'spin' } })
    expect(b.peer.all('cord')).toHaveLength(0)
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -40], r: 40 } })
    expect(b.peer.all('cord')[0].cord).toEqual({ s: 'on', at: [0, 0, -40], n: [0, 1, 0], r: 40 })
  })

  it('holds vehicle cords back when the host allows only ground anchors', () => {
    const a = join('A', { 'bungee.allowed': true, 'bungee.vehicles': false })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 20 } })
    expect(b.peer.all('cord')).toHaveLength(0)
  })
})
