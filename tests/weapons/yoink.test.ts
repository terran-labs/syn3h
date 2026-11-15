import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'
import { gustPush, holdAccel, type V3 } from '../../src/weapons/yoink/hold'

const DT = 1 / 50
const G = 9.81

describe('Yoink carry', () => {
  const t = { omega: 3.2, zeta: 0.9, maxAccel: 3 * G, gravity: G }

  it('lifts a vehicle to the carry point and holds it there against gravity', () => {
    let p: V3 = [0, 0, 0], v: V3 = [0, 0, 0]
    for (let i = 0; i < 4 / DT; i++) {
      const a = holdAccel(p, v, [0, 5, -8], [0, 0, 0], t)
      for (let k = 0; k < 3; k++) v[k] += (a[k] - (k === 1 ? G : 0)) * DT
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT]
    }
    expect(p[1]).toBeCloseTo(5, 1)
    expect(p[2]).toBeCloseTo(-8, 1)
  })

  it('follows a holder driving at 25 m/s seen 250 ms late, without swinging wild', () => {
    let p: V3 = [0, 0, 0], v: V3 = [0, 0, 0]
    let worst = 0
    for (let i = 0; i < 8 / DT; i++) {
      const time = i * DT
      // The holder as seen late, carried forward by its known lag: exactly right at constant speed.
      const seen = 25 * (time - 0.25) + 25 * 0.25
      const a = holdAccel(p, v, [0, 3, seen - 8], [0, 0, 25], t)
      for (let k = 0; k < 3; k++) v[k] += (a[k] - (k === 1 ? G : 0)) * DT
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT]
      // p has moved on one step, to time + DT.
      if (time > 4) worst = Math.max(worst, Math.abs(p[2] - (25 * (time + DT) - 8)))
    }
    expect(worst).toBeLessThan(0.5)
  })

  it('never pushes harder than the grip', () => {
    const a = holdAccel([0, 0, 0], [0, 0, 0], [1000, 0, 0], [0, 0, 0], t)
    expect(Math.hypot(...a)).toBeCloseTo(t.maxAccel)
  })

  it('gusts strongest up close and not at all past reach', () => {
    expect(gustPush([0, 0, -1], 2, 18, 14)![2]).toBeLessThan(-10)
    expect(gustPush([0, 0, -1], 17, 18, 14)![2]).toBeGreaterThan(-1)
    expect(gustPush([0, 0, -1], 20, 18, 14)).toBeNull()
  })
})

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

describe('Yoink in the room', () => {
  beforeEach(() => { clock = 100_000; room = new Room('test', { now: () => clock }) })

  it('relays grabs and flings within reach, and nothing while Yoink is off', () => {
    const a = join('A', { 'yoink.allowed': false })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -20]))
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    expect(b.peer.all('yoink')).toHaveLength(0)
    send(a.peer, { type: 'param', id: 'yoink.allowed', value: true })
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id, junk: 1 } })
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 5, -28] } })
    expect(b.peer.all('yoink').map((m) => m.y)).toEqual([{ s: 'grab', to: b.id }, { s: 'fling', to: b.id, v: [0, 5, -28] }])
    expect(b.peer.all('yoink')[0].from).toBe(a.id)
  })

  it('rejects far targets, yourself, nobody, and flings faster than the room allows', () => {
    const a = join('A', { 'yoink.allowed': true })
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -500]))
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: a.id } })
    send(a.peer, { type: 'yoink', y: { s: 'grab', to: 4242 } })
    room.receive(b.peer, state([0, 0, -20]))
    send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 0, -900] } })
    send(a.peer, { type: 'yoink', y: { s: 'yeet', to: b.id } })
    expect(b.peer.all('yoink')).toHaveLength(0)
  })
})
