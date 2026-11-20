/**
 * The sever rule in the room (the owner's, 19 November 2026): hitting a player who is grappling
 * you with another weapon severs their cord. The room drops the cord with the cord 'off' every
 * client already obeys, owner included. Bugs it catches: a grappler in the games has no way to
 * be stopped; a bystander's shot cuts someone else's cord; an old client keeps a severed cord.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { BOT_ID_BASE, PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  offs(from: number): number {
    return this.json.filter((m) => m.type === 'cord' && m.from === from && m.cord.s === 'off').length
  }
}

let clock = 0
let room: Room
const world = { 'bungee.allowed': true, 'yoink.allowed': true }

function join(name: string, params: Record<string, number | boolean> = {}): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params }))
  const welcome = peer.json.find((m) => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>
  return { peer, id: welcome.id }
}

function state(p: [number, number, number], extra: Partial<WireState> = {}): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false }, ...extra }
  return encodeState(s)
}

const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
/** A shot from the shooter's own place (the room refuses one from elsewhere). */
const shot = (id: number, from: [number, number, number]) => ({ id, o: [from[0], from[1] + 0.5, from[2]], d: [0, 0, 1], boost: 0, t: clock / 1000 })

beforeEach(() => {
  clock = 100_000
  room = new Room('sever', { now: () => clock })
})

/** A grapples B; C stands by. Everyone placed and responding. */
function three() {
  const a = join('A', world)
  const b = join('B')
  const c = join('C')
  clock += 3100
  room.receive(a.peer, state([0, 0, 0]))
  room.receive(b.peer, state([0, 0, -30]))
  room.receive(c.peer, state([10, 0, -10]))
  send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 29 } })
  return { a, b, c }
}

describe('severing a cord in the room', () => {
  it('drops the cord, for everyone and its owner, when the player it is tied to hits the grappler', () => {
    const { a, b, c } = three()
    send(b.peer, { type: 'fire', shot: shot(1, [0, 0, -30]) })
    send(a.peer, { type: 'hit', shooter: b.id, shot: 1 })
    for (const p of [a, b, c]) expect(p.peer.offs(a.id)).toBe(1)
  })

  it('leaves it alone when someone else hits the grappler', () => {
    const { a, b, c } = three()
    send(c.peer, { type: 'fire', shot: shot(1, [10, 0, -10]) })
    send(a.peer, { type: 'hit', shooter: c.id, shot: 1 })
    for (const p of [a, b, c]) expect(p.peer.offs(a.id)).toBe(0)
  })

  it('leaves a ground cord alone', () => {
    const a = join('A', world)
    const b = join('B')
    clock += 3100
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'cord', cord: { s: 'on', at: [0, 0, -20], n: [0, 1, 0], r: 20 } })
    send(b.peer, { type: 'fire', shot: shot(1, [0, 0, -30]) })
    send(a.peer, { type: 'hit', shooter: b.id, shot: 1 })
    expect(b.peer.offs(a.id)).toBe(0)
  })

  it('drops it on a Yoink grab from the player it is tied to', () => {
    const { a, b, c } = three()
    send(b.peer, { type: 'yoink', y: { s: 'grab', to: a.id } })
    for (const p of [a, b, c]) expect(p.peer.offs(a.id)).toBe(1)
  })

  it("drops a bot's cord when the person it holds hits the bot, judged by the host", () => {
    const host = join('Host', world)
    const guest = join('Guest')
    clock += 3100
    room.receive(host.peer, state([50, 0, 0]))
    room.receive(guest.peer, state([0, 0, -30]))
    room.receive(host.peer, state([0, 0, 0], { id: BOT_ID_BASE, bot: true }))
    send(host.peer, { type: 'cord', bot: BOT_ID_BASE, cord: { s: 'on', to: guest.id, r: 29 } })
    expect(guest.peer.json.some((m) => m.type === 'cord' && m.from === BOT_ID_BASE && m.cord.s === 'on')).toBe(true)
    send(guest.peer, { type: 'fire', shot: shot(1, [0, 0, -30]) })
    send(host.peer, { type: 'hit', shooter: guest.id, shot: 1, victim: BOT_ID_BASE })
    expect(guest.peer.offs(BOT_ID_BASE)).toBe(1)
    expect(host.peer.offs(BOT_ID_BASE)).toBe(1)
  })
})
