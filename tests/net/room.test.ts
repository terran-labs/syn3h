import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, type WireState, decodeState, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  bin: Uint8Array[] = []
  closed = false
  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.json.push(JSON.parse(data))
    else this.bin.push(data)
  }
  close(): void {
    this.closed = true
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
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
  const welcome = peer.last('welcome')!
  return { peer, id: welcome.id }
}

function state(p: [number, number, number], v: [number, number, number] = [0, 0, 0]): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike() }
  return encodeState(s)
}

const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))

beforeEach(() => {
  clock = 100_000
  room = new Room('test', { now: () => clock })
})

describe('Room', () => {
  it('assigns ids and slots and tells everyone about joins', () => {
    const a = join('Ann')
    const b = join('Bob')
    expect(a.id).not.toBe(b.id)
    expect(a.peer.last('welcome')!.slot).toBe(0)
    expect(b.peer.last('welcome')!.slot).toBe(1)
    expect(b.peer.last('welcome')!.players.map((p) => p.name)).toEqual(['Ann', 'Bob'])
    expect(a.peer.last('join')!.player.name).toBe('Bob')
    // The first player becomes "it" by default.
    expect(b.peer.last('welcome')!.game.it).toBe(a.id)
  })

  it('reuses the lowest free slot', () => {
    join('A')
    const b = join('B')
    join('C')
    room.disconnect(b.peer)
    expect(join('D').peer.last('welcome')!.slot).toBe(1)
  })

  it('relays state to others with the sender id stamped by the server', () => {
    const a = join('A')
    const b = join('B')
    const forged = encodeState({ ...decodeState(state([1, 2, 3]))!, id: b.id })
    room.receive(a.peer, forged)
    expect(a.peer.bin.length).toBe(0)
    expect(b.peer.bin.length).toBe(1)
    const got = decodeState(b.peer.bin[0])!
    expect(got.id).toBe(a.id)
    expect(got.p[1]).toBeCloseTo(2)
  })

  it('sends late joiners the last state of everyone present', () => {
    const a = join('A')
    room.receive(a.peer, state([5, 0, 5]))
    const c = join('C')
    expect(c.peer.bin.length).toBe(1)
    expect(decodeState(c.peer.bin[0])!.id).toBe(a.id)
  })

  it('ignores messages before hello', () => {
    const p = new FakePeer()
    room.connect(p)
    room.receive(p, state([0, 0, 0]))
    send(p, { type: 'param', id: 'world.gravity', value: 3 })
    expect(p.json.length).toBe(0)
  })

  it('clamps known shared parameters, stores and rebroadcasts them', () => {
    const a = join('A')
    const b = join('B')
    send(a.peer, { type: 'param', id: 'world.gravity', value: 1000 })
    expect(b.peer.last('param')).toEqual({ type: 'param', id: 'world.gravity', value: 18.81, from: a.id })
    // The sender hears the clamped value too.
    expect(a.peer.last('param')!.value).toBe(18.81)
    expect(join('Late').peer.last('welcome')!.params['world.gravity']).toBe(18.81)
  })

  it('passes unknown ids with a basic type check and rejects junk', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'sky.turbidity', value: 4.5 })
    send(a.peer, { type: 'param', id: 'sky.bad', value: 'x'.repeat(50) })
    send(a.peer, { type: 'param', id: 'bad id with spaces', value: 1 })
    send(a.peer, { type: 'param', id: 'sky.inf', value: 1e300 })
    const params = join('Late').peer.last('welcome')!.params
    expect(params['sky.turbidity']).toBe(4.5)
    expect(params['sky.bad']).toBeUndefined()
    expect(params['bad id with spaces']).toBeUndefined()
    expect(params['sky.inf']).toBeUndefined()
  })

  it('adopts the first player world into an empty room only', () => {
    join('Host', { 'world.seed': 42, 'world.gravity': -5 })
    const late = join('Late', { 'world.seed': 7 })
    const params = late.peer.last('welcome')!.params
    expect(params['world.seed']).toBe(42)
    expect(params['world.gravity']).toBe(0.81)
  })

  it('passes "it" on by ramming, with a cooldown, and checks distance', () => {
    const a = join('A')
    const b = join('B')
    expect(a.peer.last('game')!.game.it).toBe(a.id)
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([3, 0, 0]))

    // Joining counts as a tag, so nothing changes in the first seconds.
    send(b.peer, { type: 'ram', other: a.id })
    expect(b.peer.last('game')!.game.it).toBe(a.id)

    clock += 3100
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([3, 0, 0]))
    send(b.peer, { type: 'ram', other: a.id })
    expect(a.peer.last('game')).toMatchObject({ game: { it: b.id }, event: 'ram' })

    // Cooldown: the immediate counter ram from A's client does nothing.
    send(a.peer, { type: 'ram', other: b.id })
    expect(a.peer.last('game')!.game.it).toBe(b.id)

    clock += 3100
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([300, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id })
    expect(a.peer.last('game')!.game.it).toBe(b.id) // too far apart to be a real ram

    room.receive(b.peer, state([2, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id })
    expect(a.peer.last('game')!.game.it).toBe(a.id)
  })

  it('validates laser shots and applies the tag rules on hits reported by the victim', () => {
    const a = join('A') // it
    const b = join('B')
    clock += 3100
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -50]))
    const shot = (id: number) => ({ id, o: [0, 0.5, -2], d: [0, 0, -1], boost: 0, t: clock / 1000 })

    send(a.peer, { type: 'fire', shot: shot(1) })
    expect(b.peer.last('fire')).toMatchObject({ from: a.id, shot: { id: 1 } })
    expect(a.peer.last('fire')).toBeUndefined()

    // Rate limited.
    send(a.peer, { type: 'fire', shot: shot(2) })
    expect(b.peer.all('fire').length).toBe(1)

    // A shot that never happened cannot be claimed.
    send(b.peer, { type: 'hit', shooter: a.id, shot: 99 })
    expect(b.peer.last('hit')).toBeUndefined()

    // "it" hits B: a point for A.
    send(b.peer, { type: 'hit', shooter: a.id, shot: 1 })
    expect(a.peer.last('hit')).toEqual({ type: 'hit', shooter: a.id, victim: b.id, shot: 1 })
    expect(a.peer.last('game')).toMatchObject({ event: 'score', game: { it: a.id, scores: { [a.id]: 1 } } })
    // The same shot cannot score twice.
    send(b.peer, { type: 'hit', shooter: a.id, shot: 1 })
    expect(a.peer.all('hit').length).toBe(1)

    // B shoots "it" after the cooldown and takes the role.
    clock += 3100
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -50]))
    send(b.peer, { type: 'fire', shot: { id: 1, o: [0, 0.5, -48], d: [0, 0, 1], boost: 0, t: clock / 1000 } })
    send(a.peer, { type: 'hit', shooter: b.id, shot: 1 })
    expect(b.peer.last('game')).toMatchObject({ event: 'laser', game: { it: b.id } })
  })

  it('rejects shots fired from somewhere the shooter is not', () => {
    const a = join('A')
    const b = join('B')
    room.receive(a.peer, state([0, 0, 0]))
    send(a.peer, { type: 'fire', shot: { id: 1, o: [500, 0, 0], d: [0, 0, -1], boost: 0, t: clock / 1000 } })
    expect(b.peer.last('fire')).toBeUndefined()
  })

  it('hands "it" on and announces when a player leaves', () => {
    const a = join('A')
    const b = join('B')
    room.disconnect(a.peer)
    expect(b.peer.last('leave')).toEqual({ type: 'leave', id: a.id })
    expect(b.peer.last('game')).toMatchObject({ event: 'leave', game: { it: b.id } })
    expect(room.playerCount).toBe(1)
    expect(b.peer.last('game')!.game.scores[a.id]).toBeUndefined()
  })

  it('answers pings with the server clock', () => {
    const a = join('A')
    send(a.peer, { type: 'ping', t: 12.5 })
    expect(a.peer.last('pong')).toEqual({ type: 'pong', t: 12.5, serverTime: clock / 1000 })
  })

  it('survives a snapshot and restore', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'laser.speed', value: 300 })
    const snap = room.snapshot()
    const again = new Room('test', { now: () => clock })
    again.restore(snap)
    const p = new FakePeer()
    again.adopt(p, room.info(a.peer)!)
    expect(again.playerCount).toBe(1)
    const late = new FakePeer()
    again.connect(late)
    again.receive(late, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'L', params: {} }))
    const w = late.last('welcome')!
    expect(w.params['laser.speed']).toBe(300)
    expect(w.game.it).toBe(a.id)
    expect(w.id).toBeGreaterThan(a.id)
  })
})

describe('Room host lock', () => {
  it('makes the first player host and lets only the host lock', () => {
    const a = join('A')
    const b = join('B')
    expect(b.peer.last('welcome')!.game).toMatchObject({ host: a.id, locked: false })
    send(b.peer, { type: 'lock', locked: true })
    expect(a.peer.last('game')!.game.locked).toBe(false)
    send(a.peer, { type: 'lock', locked: true })
    expect(b.peer.last('game')).toMatchObject({ event: 'lock', game: { locked: true, host: a.id } })
  })

  it('rejects non host changes while locked and snaps the sender back', () => {
    const a = join('A')
    const b = join('B')
    send(a.peer, { type: 'lock', locked: true })
    send(b.peer, { type: 'param', id: 'world.gravity', value: 3 })
    expect(b.peer.last('param')).toEqual({ type: 'param', id: 'world.gravity', value: 9.81, from: 0 })
    expect(a.peer.last('param')).toBeUndefined()
    // The host still can.
    send(a.peer, { type: 'param', id: 'world.gravity', value: 3 })
    expect(b.peer.last('param')).toEqual({ type: 'param', id: 'world.gravity', value: 3, from: a.id })
    send(a.peer, { type: 'lock', locked: false })
    send(b.peer, { type: 'param', id: 'world.gravity', value: 4 })
    expect(a.peer.last('param')!.value).toBe(4)
  })

  it('passes host to the longest connected player, keeping the lock', () => {
    const a = join('A')
    const b = join('B')
    const c = join('C')
    send(a.peer, { type: 'lock', locked: true })
    room.disconnect(a.peer)
    expect(c.peer.last('game')).toMatchObject({ game: { host: b.id, locked: true } })
    send(c.peer, { type: 'param', id: 'world.gravity', value: 3 })
    expect(c.peer.last('param')!.from).toBe(0)
    send(b.peer, { type: 'lock', locked: false })
    expect(c.peer.last('game')!.game.locked).toBe(false)
  })
})
