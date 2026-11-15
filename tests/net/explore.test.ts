/**
 * Explore is the default: a room is not a game until a player chooses one.
 * Owner's rule of 15 November 2026: "You also need to have an Explore game mode, which is
 * the default. Tag and hill should only be enabled if the user chooses them."
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room, type RoomSnapshot } from '../../server/room'
import {
  BOT_ID_BASE, MODE_EXPLORE, MODE_KOTH, MODE_TAG, PROTOCOL_VERSION, type ServerMessage, type TagEvent, type WireState, encodeState,
} from '../../shared/protocol'
import { gameMode } from '../../src/modes/params'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  closed = false
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void { this.closed = true }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.json.filter((m) => m.type === type) as never }
}

let clock = 0
let room: Room

function join(name: string, params: Record<string, number | boolean> = {}, target: Room = room) {
  const peer = new FakePeer()
  target.connect(peer)
  target.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params }))
  return { peer, id: peer.last('welcome')!.id }
}
const state = (p: [number, number, number], v: [number, number, number] = [0, 0, 0], extra: Partial<WireState> = {}) =>
  encodeState({ id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike(), ...extra })
const send = (peer: Peer, msg: object, target: Room = room) => target.receive(peer, JSON.stringify(msg))

/** Events that mean a game is being played. 'mode', 'host', 'lock' and 'leave' are room news. */
const GAME_EVENTS: TagEvent[] = ['default', 'ram', 'laser', 'score', 'capture', 'contest', 'free', 'stuck', 'dunk', 'win', 'reset']

beforeEach(() => {
  clock = 100_000
  room = new Room('explore', { now: () => clock })
})

describe('Explore, the default mode', () => {
  it('is what the mode parameter defaults to, with the old numbers kept for Tag and the hill', () => {
    expect(gameMode.def.default).toBe(MODE_EXPLORE)
    expect([MODE_TAG, MODE_KOTH, MODE_EXPLORE]).toEqual([0, 1, 2])
  })

  it('is the mode of a new room: nobody is it, no hill, no scores, and joining is not news of a game', () => {
    const a = join('A')
    const b = join('B')
    for (const p of [a, b]) {
      const g = p.peer.last('welcome')!.game
      expect(g.mode).toBe(MODE_EXPLORE)
      expect(g.it).toBe(0)
      expect(g.koth.holder).toBe(0)
      expect(Object.values(g.scores).every((s) => s === 0)).toBe(true)
    }
    // The first player used to be told it was "it" by default.
    for (const g of [...a.peer.all('game'), ...b.peer.all('game')]) {
      expect(g.event).toBeUndefined()
      expect(g.game.it).toBe(0)
    }
  })

  it('stays that way when the first player brings a world that says nothing about the mode', () => {
    const a = join('A', { 'world.gravity': 5 })
    expect(a.peer.last('welcome')!.game.mode).toBe(MODE_EXPLORE)
  })

  it('plays no game through ten minutes of two players and bots using every tool', () => {
    const world = {
      'terrain.planetSize': 0, 'pester.allowed': true, 'bigRed.allowed': true, 'yoink.allowed': true,
      'bungee.allowed': true, 'bungee.vehicles': true, 'bungee.length': 40,
    }
    const a = join('A', world)
    const b = join('B')
    const bot = BOT_ID_BASE
    let shot = 0
    let relayedHits = 0
    let relayedShoves = 0
    // Half-second steps for ten minutes. A drives past B again and again; the host's bot sits
    // nearby. Every few seconds one of the tools is used, on a player or on the bot.
    for (let step = 0; step < 1200; step++) {
      clock += 500
      const x = (step % 20) - 10
      room.receive(a.peer, state([x, 0, 0], [20, 0, 0]))
      room.receive(b.peer, state([0, 0, -6]))
      room.receive(a.peer, state([8, 0, -8], [3, 0, 0], { id: bot, bot: true }))
      const hitsBefore = b.peer.all('hit').length
      const shovesBefore = b.peer.all('shove').length
      switch (step % 12) {
        case 0: // Ram, with the push the rammer would have given.
          send(a.peer, { type: 'ram', other: b.id, push: [8, 0, 0] })
          break
        case 2: // Tag beam, and the victim says it was hit.
          send(a.peer, { type: 'fire', shot: { id: ++shot, o: [x, 0.5, 0], d: [0, 0, -1], boost: 0, t: clock / 1000 } })
          send(b.peer, { type: 'hit', shooter: a.id, shot })
          break
        case 3: // Big Red.
          send(a.peer, { type: 'fire', shot: { id: ++shot, o: [x, 0.5, 0], d: [0, 0, -1], boost: 0, t: clock / 1000, k: 'red' } })
          send(b.peer, { type: 'hit', shooter: a.id, shot })
          break
        case 4: // A Pester sent after B, which catches it.
          send(a.peer, { type: 'fire', shot: { id: ++shot, o: [x, 1, 0], d: [0, 0.4, -1], boost: 0, t: clock / 1000, k: 'pester', to: b.id } })
          send(b.peer, { type: 'hit', shooter: a.id, shot })
          break
        case 5: // A beam at the bot, judged by the host.
          send(b.peer, { type: 'fire', shot: { id: ++shot, o: [0, 0.5, -6], d: [1, 0, 0], boost: 0, t: clock / 1000 } })
          send(a.peer, { type: 'hit', shooter: b.id, shot, victim: bot })
          break
        case 6: // Bungee cord to B, then let go.
          send(a.peer, { type: 'cord', cord: { s: 'on', to: b.id, r: 30 } })
          break
        case 7:
          send(a.peer, { type: 'cord', cord: { s: 'off' } })
          break
        case 8: // Yoink: grab B, fling it.
          send(a.peer, { type: 'yoink', y: { s: 'grab', to: b.id } })
          break
        case 9:
          send(a.peer, { type: 'yoink', y: { s: 'fling', to: b.id, v: [0, 5, -20] } })
          break
        case 10: // B rams the bot and the host reports its own ram on B.
          send(b.peer, { type: 'ram', other: bot })
          send(a.peer, { type: 'ram', other: b.id })
          break
        case 11: // A vehicle reports itself stuck in lava (a hill rule).
          send(b.peer, { type: 'stuck' })
          break
      }
      relayedHits += b.peer.all('hit').length - hitsBefore
      relayedShoves += b.peer.all('shove').length - shovesBefore
    }
    // The tools still work as toys: hits are relayed (the clients shove on them) and so are rams' pushes.
    expect(relayedHits).toBeGreaterThan(100)
    expect(relayedShoves).toBeGreaterThan(10)
    expect(a.peer.all('cord').length + b.peer.all('cord').length).toBeGreaterThan(50)
    expect(b.peer.all('yoink').length).toBeGreaterThan(10)
    // And nothing was a game: no tag, score, capture, dunk or win, nobody ever "it", no points.
    for (const peer of [a.peer, b.peer]) {
      for (const g of peer.all('game')) {
        expect(GAME_EVENTS).not.toContain(g.event)
        expect(g.game.mode).toBe(MODE_EXPLORE)
        expect(g.game.it).toBe(0)
        expect(g.game.koth.holder).toBe(0)
        expect(Object.values(g.game.scores).every((s) => s === 0)).toBe(true)
      }
    }
    const end = join('C').peer.last('welcome')!
    expect(end.game.it).toBe(0)
    expect(Object.values(end.game.scores).every((s) => s === 0)).toBe(true)
    expect(end.players.every((p) => p.score === 0)).toBe(true)
  })
})

describe('Choosing a game', () => {
  it('starts Tag when a player chooses it, announces it, and names somebody "it"', () => {
    const a = join('A')
    const b = join('B')
    clock += 11_000
    room.receive(a.peer, state([0, 0, 0], [20, 0, 0]))
    room.receive(b.peer, state([0, 0, -4]))
    send(b.peer, { type: 'param', id: 'game.mode', value: MODE_TAG })
    const started = a.peer.last('game')!
    expect(started).toMatchObject({ event: 'mode', actor: b.id, game: { mode: MODE_TAG } })
    expect([a.id, b.id]).toContain(started.game.it)
    // And then it is a game: a ram passes "it".
    const it = started.game.it
    const [from, to] = it === a.id ? [a, b] : [b, a]
    send(from.peer, { type: 'ram', other: to.id })
    expect(a.peer.last('game')).toMatchObject({ event: 'ram', game: { it: to.id } })
  })

  it('starts King of the Hill when chosen', () => {
    const a = join('A')
    send(a.peer, { type: 'param', id: 'game.mode', value: MODE_KOTH })
    expect(a.peer.last('game')).toMatchObject({ event: 'mode', game: { mode: MODE_KOTH, it: 0 } })
  })

  it('returns to Explore when the game is left: nobody is it and the scores are cleared', () => {
    const a = join('A', { 'game.mode': MODE_TAG })
    const b = join('B')
    clock += 11_000
    room.receive(a.peer, state([0, 0, 0]))
    room.receive(b.peer, state([0, 0, -30]))
    send(a.peer, { type: 'fire', shot: { id: 1, o: [0, 0.5, -2], d: [0, 0, -1], boost: 0, t: clock / 1000 } })
    send(b.peer, { type: 'hit', shooter: a.id, shot: 1 })
    expect(b.peer.last('game')!.game.scores[a.id]).toBe(1)
    send(a.peer, { type: 'param', id: 'game.mode', value: MODE_EXPLORE })
    expect(b.peer.last('game')).toMatchObject({ event: 'mode', game: { mode: MODE_EXPLORE, it: 0, scores: { [a.id]: 0 } } })
    // A ram now means nothing.
    send(a.peer, { type: 'ram', other: b.id })
    expect(b.peer.last('game')!.event).toBe('mode')
  })

  it('lets only the host choose while the room is locked', () => {
    const a = join('A')
    const b = join('B')
    send(a.peer, { type: 'lock', locked: true })
    send(b.peer, { type: 'param', id: 'game.mode', value: MODE_TAG })
    expect(a.peer.last('game')!.game.mode).toBe(MODE_EXPLORE)
    send(a.peer, { type: 'param', id: 'game.mode', value: MODE_TAG })
    expect(b.peer.last('game')!.game.mode).toBe(MODE_TAG)
  })

  it('honours a first player who arrives having chosen Tag or the hill (a shared link)', () => {
    expect(join('A', { 'game.mode': MODE_TAG }).peer.last('welcome')!.game).toMatchObject({ mode: MODE_TAG })
    const other = new Room('explore2', { now: () => clock })
    expect(join('A', { 'game.mode': MODE_KOTH }, other).peer.last('welcome')!.game.mode).toBe(MODE_KOTH)
  })

  it('goes back to Explore when an idle room resets, not to a game', () => {
    const a = join('A', { 'game.mode': MODE_TAG })
    for (let t = 0; t < 6 * 60; t++) { clock += 1000; room.receive(a.peer, state([0, 0, 0], [0, 0, 0], { paused: true })) }
    expect(a.peer.last('reset')!.game.mode).toBe(MODE_EXPLORE)
  })
})

describe('Rooms and clients from before Explore', () => {
  const stored = (extra: Partial<RoomSnapshot>): RoomSnapshot => {
    const fresh = new Room('old', { now: () => clock })
    join('A', {}, fresh)
    return { ...fresh.snapshot(), ...extra }
  }

  it('reads a room stored when Tag was the default as Explore, not as a game of Tag', () => {
    // What a room server before this change stored: mode 0 because nothing else existed
    // to be the default, and no `modes` marker.
    const old = stored({})
    old.params = { ...old.params, 'game.mode': MODE_TAG }
    old.scores = { 1: 9 }
    delete old.modes
    const again = new Room('old', { now: () => clock })
    again.restore(old)
    const w = join('Back', {}, again).peer.last('welcome')!
    expect(w.game.mode).toBe(MODE_EXPLORE)
    expect(w.game.it).toBe(0)
    expect(w.params['game.mode']).toBe(MODE_EXPLORE)
    expect(Object.values(w.game.scores).every(score => score === 0)).toBe(true)
  })

  it('keeps a hill somebody chose in such a room, and a Tag chosen since the change', () => {
    const hill = stored({})
    hill.params = { ...hill.params, 'game.mode': MODE_KOTH }
    delete hill.modes
    const a = new Room('old', { now: () => clock })
    a.restore(hill)
    expect(join('Back', {}, a).peer.last('welcome')!.game.mode).toBe(MODE_KOTH)

    const chosen = new Room('new', { now: () => clock })
    const p = join('A', { 'game.mode': MODE_TAG }, chosen)
    const snap = chosen.snapshot()
    expect(snap.modes).toBe(2)
    const b = new Room('new', { now: () => clock })
    b.restore(snap)
    b.adopt(new FakePeer(), chosen.info(p.peer)!)
    expect(join('Late', {}, b).peer.last('welcome')!.game.mode).toBe(MODE_TAG)
  })

  it('accepts frozen protocol-2 clients without starting their default Tag or reloading', () => {
    const peer = new FakePeer()
    room.connect(peer)
    room.receive(peer, JSON.stringify({ type: 'hello', v: 2, name: 'Old', params: { 'game.mode': 0 } }))
    expect(PROTOCOL_VERSION).toBe(2)
    expect(peer.last('welcome')!.game.mode).toBe(MODE_EXPLORE)
    expect(peer.last('error')).toBeUndefined()
    expect(peer.closed).toBe(false)
    expect(join('New').peer.last('welcome')!.game.mode).toBe(MODE_EXPLORE)
    send(peer, { type: 'param', id: 'game.mode', value: MODE_TAG })
    expect(peer.last('game')!.game.mode).toBe(MODE_TAG)
  })
})
