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

describe('Big Red in the room', () => {
  beforeEach(() => { clock = 100_000; room = new Room('test', { now: () => clock }) })

  it('is refused while off, and any unknown kind always is', () => {
    const a = join('A', { 'bigRed.allowed': false })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'fire', shot: shot(1, 'red') })
    send(a.peer, { type: 'fire', shot: shot(2, 'nuke') })
    expect(b.peer.all('fire')).toHaveLength(0)
  })

  it('is relayed when on, on its own slower rate beside the tag beam, and tags like one', () => {
    const a = join('A', { 'game.mode': 0,  'bigRed.allowed': true })
    const b = join('B')
    // Past the newcomer's grace, when a player cannot be tagged.
    clock += 10_000
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'fire', shot: shot(1) })
    send(a.peer, { type: 'fire', shot: shot(2, 'red') })
    expect(b.peer.all('fire').map((m) => m.shot.k)).toEqual([undefined, 'red'])
    clock += 500
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'fire', shot: shot(3, 'red') })
    send(a.peer, { type: 'fire', shot: shot(4) })
    expect(b.peer.all('fire').map((m) => m.shot.id)).toEqual([1, 2, 4])
    // A is "it": B reports the red one touching it, and A scores.
    send(b.peer, { type: 'hit', shooter: a.id, shot: 2 })
    expect(a.peer.all('game').at(-1)).toMatchObject({ event: 'score' })
  })
})
