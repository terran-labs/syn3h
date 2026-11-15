import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { BOT_ID_BASE, DEFAULT_COLORS, PROTOCOL_VERSION, type ServerMessage, type WireState, decodeState, encodeState } from '../../shared/protocol'
import { roomName } from '../../server/util'
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

function join(name: string, params: Record<string, number | boolean> = {}, extra: object = {}): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, params, ...extra }))
  const welcome = peer.last('welcome')!
  return { peer, id: welcome.id }
}

function state(p: [number, number, number], v: [number, number, number] = [0, 0, 0], extra: Partial<WireState> = {}): Uint8Array {
  const s: WireState = { id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike(), ...extra }
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

describe('Room identity', () => {
  it('validates vehicle kind and colours at join and on change', () => {
    const a = join('A', {}, { kind: 'buggy-syn3h', colors: ['#FF0000', '#00ff00'] })
    const b = join('B', {}, { kind: 'tank<script>', colors: ['red', 'blue'] })
    const players = b.peer.last('welcome')!.players
    expect(players[0]).toMatchObject({ kind: 'buggy-syn3h', colors: ['#ff0000', '#00ff00'] })
    expect(players[1]).toMatchObject({ kind: 'buggy', colors: DEFAULT_COLORS })
    send(b.peer, { type: 'profile', kind: 'buggy-classic', colors: ['#123456', '#abcdef'] })
    expect(a.peer.last('profile')!.player).toMatchObject({ id: b.id, kind: 'buggy-classic', colors: ['#123456', '#abcdef'] })
    // An unknown kind is rejected; jet, hovercraft and tank are real kinds now.
    send(b.peer, { type: 'profile', kind: 'submarine' })
    expect(a.peer.all('profile').length).toBe(1)
  })

  it('turns room names into safe slugs', () => {
    expect(roomName('My Room!')).toBe('my-room')
    expect(roomName('')).toBe('lobby')
    expect(roomName('x'.repeat(80)).length).toBe(32)
  })
})

describe('Room bots', () => {
  const botState = (n: number, p: [number, number, number]) => state(p, [0, 0, 0], { id: BOT_ID_BASE + n, bot: true })

  it('relays bot states only from the host and announces new bots', () => {
    const host = join('Host')
    const b = join('B')
    room.receive(b.peer, botState(0, [1, 0, 0]))
    expect(host.peer.bin.length).toBe(0)
    room.receive(host.peer, botState(0, [1, 0, 0]))
    expect(b.peer.last('join')!.player).toMatchObject({ id: BOT_ID_BASE, bot: true })
    const got = decodeState(b.peer.bin.at(-1)!)!
    expect(got).toMatchObject({ id: BOT_ID_BASE, bot: true })
    // A late joiner learns about the bot.
    expect(join('Late').peer.last('welcome')!.players.some((p) => p.bot)).toBe(true)
  })

  it('counts rams and laser hits against bots, judged by the host', () => {
    const host = join('Host') // it
    const b = join('B')
    clock += 3100
    room.receive(host.peer, state([0, 0, 0]))
    room.receive(host.peer, botState(0, [0, 0, -30]))
    room.receive(b.peer, state([50, 0, 0]))
    // Host ("it") shoots the bot: only the host may report it.
    send(host.peer, { type: 'fire', shot: { id: 1, o: [0, 0.5, -2], d: [0, 0, -1], boost: 0, t: clock / 1000 } })
    send(b.peer, { type: 'hit', shooter: host.id, shot: 1, victim: BOT_ID_BASE })
    expect(b.peer.last('hit')).toBeUndefined()
    send(host.peer, { type: 'hit', shooter: host.id, shot: 1, victim: BOT_ID_BASE })
    expect(b.peer.last('hit')).toMatchObject({ victim: BOT_ID_BASE })
    expect(b.peer.last('game')!.game.scores[host.id]).toBe(1)

    // Bot touches the host: "it" passes to the bot after the cooldown.
    clock += 3100
    room.receive(host.peer, state([0, 0, 0]))
    room.receive(host.peer, botState(0, [0, 0, -3]))
    send(host.peer, { type: 'ram', other: BOT_ID_BASE })
    expect(b.peer.last('game')).toMatchObject({ event: 'ram', game: { it: BOT_ID_BASE } })
  })

  it('expires bots the host stops sending and passes "it" back to a person', () => {
    const host = join('Host')
    const b = join('B')
    clock += 3100
    room.receive(host.peer, state([0, 0, 0]))
    room.receive(host.peer, botState(0, [0, 0, -3]))
    send(host.peer, { type: 'ram', other: BOT_ID_BASE })
    expect(b.peer.last('game')!.game.it).toBe(BOT_ID_BASE)
    clock += 6000
    send(b.peer, { type: 'ping', t: 1 })
    expect(b.peer.last('leave')).toEqual({ type: 'leave', id: BOT_ID_BASE })
    expect(b.peer.last('game')!.game.it).toBe(host.id)
  })

  it('lets the new host take over bots', () => {
    const host = join('Host')
    const b = join('B')
    room.receive(host.peer, botState(0, [0, 0, 0]))
    room.disconnect(host.peer)
    const c = join('C')
    room.receive(b.peer, botState(0, [5, 0, 0]))
    expect(decodeState(c.peer.bin.at(-1)!)!.p[0]).toBeCloseTo(5)
  })
})

describe('Room paused players', () => {
  it('relays heartbeats but a paused player cannot ram or be rammed', () => {
    const a = join('A')
    const b = join('B')
    clock += 3100
    room.receive(a.peer, state([0, 0, 0], [0, 0, 0], { paused: true }))
    room.receive(b.peer, state([2, 0, 0]))
    expect(decodeState(b.peer.bin.at(-1)!)!.paused).toBe(true)
    send(b.peer, { type: 'ram', other: a.id })
    expect(b.peer.last('game')!.game.it).toBe(a.id)
  })
})

describe('Room King of the Hill', () => {
  const zone = { x: 100, z: 0, inner: 20, outer: 40, yMin: 40, yMax: 80 }
  const inside: [number, number, number] = [130, 50, 0]
  const elsewhere: [number, number, number] = [0, 0, 0]
  const botState = (n: number, p: [number, number, number], v: [number, number, number] = [0, 0, 0]) =>
    state(p, v, { id: BOT_ID_BASE + n, bot: true })
  const moving: [number, number, number] = [5, 0, 0]

  /** Host and B in a KotH room with a zone; returns them after the mode switch. */
  function setup() {
    const host = join('Host')
    const b = join('B')
    send(host.peer, { type: 'param', id: 'game.mode', value: 1 })
    send(host.peer, { type: 'zone', zone })
    return { host, b }
  }
  /** Advance the clock in 250 ms steps, with everyone repeating their positions. */
  function run(seconds: number, positions: [FakePeer, Uint8Array][]) {
    for (let t = 0; t < seconds * 4; t++) {
      clock += 250
      for (const [peer, s] of positions) room.receive(peer, s)
    }
  }

  it('switches rule sets on game.mode and resets scores', () => {
    const host = join('Host')
    const b = join('B')
    clock += 3100
    room.receive(host.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -50]))
    send(host.peer, { type: 'fire', shot: { id: 1, o: [0, 0.5, -2], d: [0, 0, -1], boost: 0, t: clock / 1000 } })
    send(b.peer, { type: 'hit', shooter: host.id, shot: 1 })
    expect(b.peer.last('game')!.game.scores[host.id]).toBe(1)
    send(b.peer, { type: 'param', id: 'game.mode', value: 1 })
    expect(host.peer.last('game')).toMatchObject({ event: 'mode', game: { mode: 1, scores: { [host.id]: 0 } } })
  })

  it('only the host may set the zone, and it is sanity checked', () => {
    const { host, b } = setup()
    expect(b.peer.last('game')!.game.koth.zone).toEqual(zone)
    send(b.peer, { type: 'zone', zone: { ...zone, x: 0 } })
    send(host.peer, { type: 'zone', zone: { ...zone, outer: 1e9 } })
    expect(b.peer.last('game')!.game.koth.zone).toEqual(zone)
  })

  it('scores a point a second for a player alone in the zone', () => {
    const { host, b } = setup()
    run(3, [[host.peer, state(inside)], [b.peer, state(elsewhere)]])
    const g = b.peer.last('game')!.game
    expect(g.koth.holder).toBe(host.id)
    expect(g.scores[host.id]).toBeGreaterThanOrEqual(2)
    expect(g.scores[host.id]).toBeLessThanOrEqual(3)
    expect(b.peer.all('game').some((m) => m.event === 'capture')).toBe(true)
  })

  it('does not score when contested, and respects the height band', () => {
    const { host, b } = setup()
    run(3, [[host.peer, state(inside)], [b.peer, state([100, 50, 30])]])
    let g = host.peer.last('game')!.game
    expect(g.koth.contested).toBe(true)
    expect(g.koth.holder).toBe(0)
    expect(g.scores[host.id]).toBe(0)
    // B under the zone (below yMin) does not count.
    run(2, [[host.peer, state(inside)], [b.peer, state([100, 0, 30])]])
    g = host.peer.last('game')!.game
    expect(g.koth.holder).toBe(host.id)
  })

  it('moving bots contest but never score', () => {
    const { host, b } = setup()
    run(2, [[host.peer, botState(0, inside, moving)], [b.peer, state(elsewhere)]])
    let g = b.peer.last('game')!.game
    expect(g.koth.holder).toBe(0)
    expect(g.scores[BOT_ID_BASE] ?? 0).toBe(0)
    run(3, [[host.peer, botState(0, inside, moving)], [host.peer, state(elsewhere)], [b.peer, state(inside)]])
    g = b.peer.last('game')!.game
    expect(g.koth.contested).toBe(true)
    expect(g.scores[b.id]).toBe(0)
  })

  it('credits a knock-in to the last player to touch, within the window only', () => {
    const { host, b } = setup()
    run(4, [[host.peer, state([0, 0, 0])], [b.peer, state([3, 0, 0])]])
    send(host.peer, { type: 'ram', other: b.id })
    clock += 2000
    send(b.peer, { type: 'died', cause: 'lava' })
    expect(b.peer.last('game')).toMatchObject({ event: 'knock', actor: host.id, target: b.id, game: { scores: { [host.id]: 10 } } })
    expect(b.peer.last('game')!.game.koth.out[b.id]).toBeGreaterThan(clock / 1000)
    // A second death while out is ignored.
    send(b.peer, { type: 'died', cause: 'lava' })
    expect(b.peer.all('game').filter((m) => m.event === 'knock' || m.event === 'died').length).toBe(1)
    // Out players do not hold the hill until they respawn.
    run(1, [[b.peer, state(inside)], [host.peer, state(elsewhere)]])
    expect(host.peer.last('game')!.game.koth.holder).not.toBe(b.id)
    run(3, [[b.peer, state(inside)], [host.peer, state(elsewhere)]])
    expect(host.peer.last('game')!.game.koth.holder).toBe(b.id)

    // Too long after the contact: just a death, no credit.
    run(1, [[host.peer, state([0, 0, 0])], [b.peer, state([3, 0, 0])]])
    send(host.peer, { type: 'ram', other: b.id })
    run(6, [[host.peer, state([0, 0, 0])], [b.peer, state([300, 0, 0])]])
    send(b.peer, { type: 'died', cause: 'fell' })
    expect(b.peer.last('game')).toMatchObject({ event: 'died', actor: b.id })
    expect(b.peer.last('game')!.game.scores[host.id]).toBe(10)
  })

  it('announces a winner at the target, pauses, then resets', () => {
    const { host, b } = setup()
    send(host.peer, { type: 'param', id: 'koth.targetScore', value: 5 })
    run(6, [[host.peer, state(inside)], [b.peer, state(elsewhere)]])
    const win = b.peer.all('game').find((m) => m.event === 'win')!
    expect(win).toMatchObject({ actor: host.id, game: { koth: { winner: host.id } } })
    expect(win.game.scores[host.id]).toBe(5)
    // No scoring during the pause.
    run(3, [[host.peer, state(inside)], [b.peer, state(elsewhere)]])
    expect(b.peer.last('game')!.game.scores[host.id]).toBe(5)
    run(4, [[host.peer, state(inside)], [b.peer, state(elsewhere)]])
    const reset = b.peer.all('game').find((m) => m.event === 'reset')!
    expect(reset.game.scores[host.id]).toBe(0)
    expect(reset.game.koth.winner).toBe(0)
  })
})

describe('Room King of the Hill with bots', () => {
  const zone = { x: 100, z: 0, inner: 20, outer: 40, yMin: 40, yMax: 80 }
  const inside: [number, number, number] = [130, 50, 0]
  const bot = (p: [number, number, number], v: [number, number, number] = [0, 0, 0]) =>
    state(p, v, { id: BOT_ID_BASE, bot: true })
  function run(seconds: number, positions: [FakePeer, Uint8Array][]) {
    for (let t = 0; t < seconds * 4; t++) {
      clock += 250
      for (const [peer, s] of positions) room.receive(peer, s)
    }
  }

  it('a parked bot does not block the hill', () => {
    const host = join('Host')
    const b = join('B')
    send(host.peer, { type: 'param', id: 'game.mode', value: 1 })
    send(host.peer, { type: 'zone', zone })
    run(3, [[host.peer, bot([128, 50, 4])], [host.peer, state([0, 0, 0])], [b.peer, state(inside)]])
    const g = host.peer.last('game')!.game
    expect(g.koth.holder).toBe(b.id)
    expect(g.scores[b.id]).toBeGreaterThanOrEqual(2)
  })

  it('knocking a bot into the lava earns the bonus; only the host may report it', () => {
    const host = join('Host')
    const b = join('B')
    send(host.peer, { type: 'param', id: 'game.mode', value: 1 })
    run(1, [[host.peer, bot([3, 0, 0], [3, 0, 0])], [host.peer, state([50, 0, 0])], [b.peer, state([0, 0, 0])]])
    send(b.peer, { type: 'ram', other: BOT_ID_BASE })
    send(b.peer, { type: 'died', cause: 'lava', bot: BOT_ID_BASE })
    expect(host.peer.all('game').some((m) => m.event === 'knock')).toBe(false)
    send(host.peer, { type: 'died', cause: 'lava', bot: BOT_ID_BASE })
    expect(host.peer.last('game')).toMatchObject({ event: 'knock', actor: b.id, target: BOT_ID_BASE, game: { scores: { [b.id]: 10 } } })
    expect(host.peer.last('game')!.game.koth.out[BOT_ID_BASE]).toBeGreaterThan(0)
  })
})

describe('Room idle reset', () => {
  const GRAVITY_DEFAULT = () => new Room('fresh').snapshot().params['world.gravity']
  const parked = (p: Peer) => room.receive(p, state([0, 0, 0], [0, 0, 0], { paused: true }))
  const live = (p: Peer) => room.receive(p, state([0, 0, 0]))

  it('keeps the world while someone plays, even past the idle limit', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'sun.timeOfDay', value: 23 })
    for (let t = 0; t < 7 * 60; t++) { clock += 1000; live(a.peer) }
    expect(join('B').peer.last('welcome')!.params['sun.timeOfDay']).toBe(23)
  })

  it('forgets a world held only by a hidden tab, and the next visitor brings theirs', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'sun.timeOfDay', value: 23 })
    send(a.peer, { type: 'param', id: 'world.gravity', value: 3 })
    // A's tab is hidden: heartbeats only.
    for (let t = 0; t < 4 * 60; t++) { clock += 1000; parked(a.peer) }
    expect(a.peer.last('reset')).toBeUndefined()
    // Five minutes from the end of the 10 s join grace.
    for (let t = 0; t < 71; t++) { clock += 1000; parked(a.peer) }
    const reset = a.peer.last('reset')!
    expect(reset.reason).toBe('idle')
    expect(reset.params['world.gravity']).toBe(GRAVITY_DEFAULT())
    expect(reset.params['sun.timeOfDay']).toBeUndefined()
    // Only once per idle spell.
    for (let t = 0; t < 400; t++) { clock += 1000; parked(a.peer) }
    expect(a.peer.all('reset')).toHaveLength(1)
    // The next visitor brings their own world, and the parked player is told.
    const b = join('B', { 'sun.timeOfDay': 12 })
    expect(b.peer.last('welcome')!.params['sun.timeOfDay']).toBe(12)
    expect(a.peer.last('reset')).toMatchObject({ reason: 'join', params: { 'sun.timeOfDay': 12 } })
  })

  it('resets 15 s after the last active player leaves, but not on a quick reload', () => {
    const a = join('A')
    const b = join('B')
    send(a.peer, { type: 'param', id: 'world.gravity', value: 3 })
    clock += 20_000
    parked(b.peer)
    live(a.peer)
    room.disconnect(a.peer)
    // A reloads within a few seconds and finds the world as it was.
    clock += 3000
    parked(b.peer)
    const back = join('A2')
    expect(back.peer.last('welcome')!.params['world.gravity']).toBe(3)
    room.disconnect(back.peer)
    for (let t = 0; t < 14; t++) { clock += 1000; parked(b.peer) }
    expect(b.peer.last('reset')).toBeUndefined()
    clock += 2000
    parked(b.peer)
    expect(b.peer.last('reset')!.params['world.gravity']).toBe(GRAVITY_DEFAULT())
  })

  it('resets mode, scores, lock and hill with the world', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'game.mode', value: 1 })
    send(a.peer, { type: 'lock', locked: true })
    for (let t = 0; t < 6 * 60; t++) { clock += 1000; parked(a.peer) }
    const g = a.peer.last('reset')!.game
    expect(g.mode).toBe(0)
    expect(g.locked).toBe(false)
    expect(g.koth.zone).toBeNull()
  })

  it('lets the host, or anyone while unlocked, reset the world to defaults', () => {
    const a = join('A')
    const b = join('B')
    send(a.peer, { type: 'param', id: 'world.gravity', value: 3 })
    send(a.peer, { type: 'lock', locked: true })
    send(b.peer, { type: 'reset' })
    expect(a.peer.last('reset')).toBeUndefined()
    send(a.peer, { type: 'reset' })
    expect(b.peer.last('reset')).toMatchObject({ reason: 'host', from: a.id })
    expect(b.peer.last('reset')!.params['world.gravity']).toBe(GRAVITY_DEFAULT())
    // A host reset is not an idle one: a newcomer gets the defaults, not their own world.
    expect(join('C', { 'world.gravity': 9 }).peer.last('welcome')!.params['world.gravity']).toBe(GRAVITY_DEFAULT())
    // Unlocked (the reset unlocks), anyone may.
    send(b.peer, { type: 'reset' })
    expect(a.peer.last('reset')).toMatchObject({ from: b.id })
  })

  it('a Durable Object woken tomorrow does not restore tonight\'s world', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'world.gravity', value: 3 })
    live(a.peer)
    parked(a.peer)
    const snap = room.snapshot()
    // Hibernated with a parked socket; a visitor arrives the next morning.
    clock += 10 * 3600_000
    const again = new Room('test', { now: () => clock })
    again.restore(snap)
    const hidden = new FakePeer()
    again.adopt(hidden, room.info(a.peer)!)
    const late = new FakePeer()
    again.connect(late)
    again.receive(late, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'L', params: { 'world.gravity': 7 } }))
    expect(late.last('welcome')!.params['world.gravity']).toBe(7)
    expect(hidden.last('reset')).toMatchObject({ reason: 'join' })
    // A snapshot that recent activity keeps fresh still restores.
    const busy = new Room('test', { now: () => clock })
    busy.restore({ ...snap, activeAt: clock - 60_000 })
    const p2 = new FakePeer()
    busy.adopt(p2, room.info(a.peer)!)
    const late2 = new FakePeer()
    busy.connect(late2)
    busy.receive(late2, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'M', params: { 'world.gravity': 7 } }))
    expect(late2.last('welcome')!.params['world.gravity']).toBe(3)
  })
})
