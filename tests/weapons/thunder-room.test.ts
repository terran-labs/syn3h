/**
 * Plasma Thunder's detonations at the room (server/room.ts onDetonate), the one authority on
 * where a shot went off and whom it caught. Bugs these catch: two players disagreeing about a
 * detonation (a second report for the same shot accepted); a proximity fuse that tags in Tag;
 * a fuse claimed before the bolt has armed; an end, or a catch, reported by a client that does
 * not speak for it; the shooter's own vehicle setting off its own fuse; a Plasma Tag shot
 * detonating.
 */
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
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params }))
  return { peer, id: peer.all('welcome')[0]!.id }
}
function state(p: [number, number, number]): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false } }
  return encodeState(s)
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
const shot = (id: number, k?: string) => ({ id, o: [0, 0.5, -2], d: [0, 0, -1], boost: 0, t: clock / 1000, ...(k ? { k } : {}) })

/** A ("it" in Tag) fires Plasma Thunder shot 2 at B, 30 m away. */
function setUp(mode = 0) {
  const a = join('A', { 'game.mode': mode, 'bigRed.allowed': true })
  const b = join('B')
  clock += 10_000
  room.receive(a.peer, state([0, 0, 0]))
  room.receive(b.peer, state([0, 0, -30]))
  send(a.peer, { type: 'fire', shot: shot(2, 'red') })
  return { a, b }
}

describe('Plasma Thunder detonations at the room', () => {
  beforeEach(() => { clock = 100_000; room = new Room('test', { now: () => clock }) })

  it('a contact, reported by the vehicle it touched, bursts there for everyone and counts as a hit', () => {
    const { a, b } = setUp()
    clock += 300
    send(b.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [1, 2, -29], cause: 'contact' })
    for (const peer of [a.peer, b.peer]) expect(peer.all('detonated')).toEqual([{ type: 'detonated', shooter: a.id, shot: 2, at: [1, 2, -29], cause: 'contact', victim: b.id }])
    expect(a.peer.all('hit')).toHaveLength(1)
    expect(a.peer.all('game').at(-1)).toMatchObject({ event: 'score' })
  })

  it('takes the first report for a shot and ignores every later one', () => {
    const { a, b } = setUp()
    clock += 300
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -40], cause: 'end' })
    send(b.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [1, 2, -29], cause: 'fuse' })
    expect(b.peer.all('detonated')).toHaveLength(1)
    expect(b.peer.all('detonated')[0]).toMatchObject({ cause: 'end', at: [0, 0, -40] })
  })

  it('a fuse knocks but never tags in Tag', () => {
    const { a, b } = setUp()
    clock += 300
    send(b.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [1, 2, -29], cause: 'fuse' })
    expect(b.peer.all('detonated')).toHaveLength(1)
    expect(a.peer.all('hit')).toHaveLength(0)
    expect(a.peer.all('game').filter(m => m.event === 'score')).toHaveLength(0)
  })

  it('refuses a fuse before the bolt has armed', () => {
    const { a, b } = setUp()
    send(b.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -3], cause: 'fuse' })
    expect(b.peer.all('detonated')).toHaveLength(0)
  })

  it('takes an end only from the shooter, and a catch never on the shooter\'s own vehicle', () => {
    const { a, b } = setUp()
    clock += 300
    send(b.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -40], cause: 'end' })
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -1], cause: 'fuse' })
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -1], cause: 'contact' })
    expect(b.peer.all('detonated')).toHaveLength(0)
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 0, -40], cause: 'end' })
    expect(b.peer.all('detonated')).toHaveLength(1)
  })

  it('does nothing for a Plasma Tag shot, or a point that is not a point', () => {
    const { a, b } = setUp()
    clock += 400
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'fire', shot: shot(3) })
    clock += 300
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 3, at: [0, 0, -40], cause: 'end' })
    send(a.peer, { type: 'detonate', shooter: a.id, shot: 2, at: [0, 'x', -40], cause: 'end' })
    expect(b.peer.all('detonated')).toHaveLength(0)
  })
})
