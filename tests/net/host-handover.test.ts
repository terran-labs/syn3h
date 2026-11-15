/**
 * Host handover while the host is away. The host simulates the bots, so a host whose tab is
 * hidden (its states arrive flagged paused) or whose states have stopped leaves every guest
 * watching the bots freeze and vanish. After HOST_AWAY_MS the room passes host to the
 * longest present guest who is playing, by the same path a leaving host takes.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { BOT_ID_BASE, PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.json.filter((m) => m.type === type) as never
  }
  /** Every 'host' announcement this peer heard, as the new host's id. */
  hosts(): number[] { return this.all('game').filter((m) => m.event === 'host').map((m) => m.game.host) }
}

let clock = 0
let room: Room
const join = (name: string, params: Record<string, number | boolean> = {}, extra: object = {}) => {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, params, ...extra }))
  return { peer, id: peer.last('welcome')!.id }
}
type Joined = ReturnType<typeof join>
const state = (extra: Partial<WireState> = {}) =>
  encodeState({ id: 0, t: clock / 1000, p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), ...extra })
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
/** Who the room says is host, as a newcomer would hear it. */
const hostNow = () => { const peer = new FakePeer(); room.connect(peer); room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'Probe', params: {} })); const host = peer.last('welcome')!.game.host; room.disconnect(peer); return host }

/** How each player behaves while time passes: playing, parked (a paused state each second) or silent. */
type Mode = 'play' | 'park' | 'silent'
/** Advance time in quarter seconds; a playing player sends a state every step, a parked one every second. */
function run(ms: number, players: [Joined, Mode][]) {
  for (let t = 0; t < ms; t += 250) {
    clock += 250
    for (const [p, mode] of players) {
      if (mode === 'play') room.receive(p.peer, state())
      else if (mode === 'park' && clock % 1000 === 0) room.receive(p.peer, state({ paused: true }))
    }
    room.tick()
  }
}

beforeEach(() => {
  clock = 100_000
  room = new Room('handover', { now: () => clock })
})

describe('Room host handover while the host is away', () => {
  /** Host A and guest B, both playing for a second. */
  function two() {
    const a = join('A', { 'game.rejoin': false })
    const b = join('B')
    run(1000, [[a, 'play'], [b, 'play']])
    return { a, b }
  }

  it('passes host from a parked host to a playing guest after three seconds, and not before', () => {
    const { a, b } = two()
    // The first paused state arrives a second in: three seconds from then, and no sooner.
    run(1000, [[a, 'park'], [b, 'play']])
    run(2750, [[a, 'park'], [b, 'play']])
    expect(b.peer.hosts()).toEqual([])
    run(750, [[a, 'park'], [b, 'play']])
    expect(b.peer.hosts()).toEqual([b.id])
    expect(a.peer.hosts()).toEqual([b.id])
    expect(hostNow()).toBe(b.id)
  })

  it('passes host from a host whose states simply stop', () => {
    const { a, b } = two()
    run(2750, [[b, 'play']])
    expect(b.peer.hosts()).toEqual([])
    run(750, [[b, 'play']])
    expect(b.peer.hosts()).toEqual([b.id])
  })

  it('keeps the host through brief gaps and short pauses', () => {
    const { a, b } = two()
    for (let i = 0; i < 4; i++) {
      run(2500, [[b, 'play']])
      run(500, [[a, 'play'], [b, 'play']])
      run(2000, [[a, 'park'], [b, 'play']])
      run(500, [[a, 'play'], [b, 'play']])
    }
    expect(b.peer.hosts()).toEqual([])
    expect(hostNow()).toBe(a.id)
  })

  it('keeps the host when nobody else is playing, also once it is back', () => {
    const { a, b } = two()
    run(10_000, [[a, 'park'], [b, 'park']])
    expect(b.peer.hosts()).toEqual([])
    run(10_000, [[b, 'park']])
    expect(b.peer.hosts()).toEqual([])
    run(1000, [[a, 'play'], [b, 'play']])
    expect(b.peer.hosts()).toEqual([])
    expect(hostNow()).toBe(a.id)
  })

  it('passes over a parked guest and a held one, to one who is playing', () => {
    const a = join('A', { 'game.rejoin': true })
    const held = join('Held', {}, { resume: 'h'.repeat(32) })
    const parked = join('Parked')
    const d = join('D')
    run(1000, [[a, 'play'], [held, 'play'], [parked, 'play'], [d, 'play']])
    room.disconnect(held.peer)
    expect(room.heldCount).toBe(1)
    run(5000, [[a, 'park'], [parked, 'park'], [d, 'play']])
    expect(d.peer.hosts()).toEqual([d.id])
  })

  it('passes host to the playing guest who has been in the room longest', () => {
    const a = join('A', { 'game.rejoin': false })
    const b = join('B')
    const c = join('C')
    run(1000, [[a, 'play'], [c, 'play'], [b, 'play']])
    run(5000, [[a, 'park'], [c, 'play'], [b, 'play']])
    expect(c.peer.hosts()).toEqual([b.id])
  })

  it('takes the old host\'s bots away, then accepts bots only from the new host', () => {
    const { a, b } = two()
    room.receive(a.peer, state({ bot: true, id: BOT_ID_BASE }))
    expect(b.peer.all('join').map((m) => m.player.id)).toContain(BOT_ID_BASE)
    run(5000, [[a, 'park'], [b, 'play']])
    expect(b.peer.hosts()).toEqual([b.id])
    expect(b.peer.all('leave')).toEqual([{ type: 'leave', id: BOT_ID_BASE }])
    // The old host is back and still simulating: its bots are refused.
    room.receive(a.peer, state())
    room.receive(a.peer, state({ bot: true, id: BOT_ID_BASE + 1 }))
    expect(b.peer.all('join').map((m) => m.player.id)).not.toContain(BOT_ID_BASE + 1)
    // The new host's are taken.
    room.receive(b.peer, state({ bot: true, id: BOT_ID_BASE + 2 }))
    expect(a.peer.all('join').map((m) => m.player.id)).toContain(BOT_ID_BASE + 2)
  })

  it('does not hand host back to the old host when it returns, and announces the handover once', () => {
    const { a, b } = two()
    run(5000, [[a, 'park'], [b, 'play']])
    run(20_000, [[a, 'play'], [b, 'play']])
    expect(hostNow()).toBe(b.id)
    expect(a.peer.hosts()).toEqual([b.id])
    expect(b.peer.hosts()).toEqual([b.id])
    // The old host is an ordinary guest: it cannot lock.
    send(a.peer, { type: 'lock', locked: true })
    expect(b.peer.last('game')!.game.locked).toBe(false)
  })

  it('keeps the lock, the hill zone and the scores, as when a host leaves', () => {
    const a = join('A', { 'game.rejoin': false })
    const b = join('B')
    send(a.peer, { type: 'param', id: 'game.mode', value: 1 })
    send(a.peer, { type: 'zone', zone: { x: 0, z: 0, inner: 10, outer: 30, yMin: -10, yMax: 50 } })
    send(a.peer, { type: 'lock', locked: true })
    run(1000, [[a, 'play'], [b, 'play']])
    const before = b.peer.last('game')!.game
    run(5000, [[a, 'park'], [b, 'play']])
    const game = b.peer.all('game').find((m) => m.event === 'host')!.game
    expect(game).toMatchObject({ host: b.id, locked: true, koth: { zone: before.koth.zone } })
    expect(game.scores[a.id]).toBe(before.scores[a.id])
    // The new host holds the lock now.
    send(b.peer, { type: 'lock', locked: false })
    expect(a.peer.last('game')).toMatchObject({ event: 'lock', game: { locked: false } })
  })

  it('leaves a host held for a rejoin as host until its hold runs out, as before', () => {
    const a = join('A', { 'game.rejoin': true }, { resume: 'a'.repeat(32) })
    const b = join('B')
    run(1000, [[a, 'play'], [b, 'play']])
    room.receive(a.peer, state({ bot: true, id: BOT_ID_BASE }))
    room.disconnect(a.peer)
    // Held: the bots go at once, but the place, and host with it, are kept for the grace time.
    expect(b.peer.all('leave')).toEqual([{ type: 'leave', id: BOT_ID_BASE }])
    run(10_000, [[b, 'play']])
    expect(b.peer.hosts()).toEqual([])
    expect(hostNow()).toBe(a.id)
    // When the hold runs out it is an ordinary leave, and host passes then.
    run(21_000, [[b, 'play']])
    expect(b.peer.hosts()).toEqual([b.id])
  })

  it('does not take host from a host back from a held place before it has had time to send', () => {
    const a = join('A', { 'game.rejoin': true }, { resume: 'a'.repeat(32) })
    const b = join('B')
    run(1000, [[a, 'play'], [b, 'play']])
    room.disconnect(a.peer)
    run(5000, [[b, 'play']])
    const back = join('A', {}, { resume: 'a'.repeat(32) })
    expect(back.id).toBe(a.id)
    // Its first state is a message like any other: the tick before it must not see five seconds of silence.
    room.receive(back.peer, state())
    run(10_000, [[back, 'play'], [b, 'play']])
    expect(b.peer.hosts()).toEqual([])
    expect(hostNow()).toBe(a.id)
  })
})
