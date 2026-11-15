import { beforeEach, describe, expect, it } from 'vitest'
import { Room, type Peer } from '../../server/room'
import { BOT_ID_BASE, MAX_BOTS, PROTOCOL_VERSION, encodeState, type ServerMessage, type WireState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.json.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
  }
}

let room: Room
let clock: number
const bot = BOT_ID_BASE
const world = { 'bigRed.allowed': true, 'pester.allowed': true, 'bungee.allowed': true, 'bungee.vehicles': true, 'yoink.allowed': true }
function send(peer: Peer, msg: object) { room.receive(peer, JSON.stringify(msg)) }
function join(name: string, params: Record<string, number | boolean> = {}, resume?: string) {
  const peer = new FakePeer()
  room.connect(peer)
  send(peer, { type: 'hello', v: PROTOCOL_VERSION, name, params, resume })
  return { peer, id: peer.all('welcome')[0]!.id }
}
function place(peer: Peer, x: number, extra: Partial<WireState> = {}) {
  room.receive(peer, encodeState({ id: 0, t: clock / 1000, p: [x, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), ...extra }))
}
function fire(id: number, actor: number | undefined = bot, extra: object = {}) {
  return { type: 'fire', bot: actor, shot: { id, o: [0, 1, 0], d: [1, 0, 0], boost: 0, t: clock / 1000, k: 'red', ...extra } }
}
function setup(params: Record<string, number | boolean> = {}, resume?: string) {
  const host = join('Host', { ...world, ...params }, resume)
  const guest = join('Guest')
  clock += 4000
  place(host.peer, 0)
  place(guest.peer, 20)
  place(host.peer, 0, { bot: true, id: bot })
  return { host, guest }
}
beforeEach(() => { clock = 100_000; room = new Room('bot-gear', { now: () => clock }) })

describe('Host-authorized bot gear', () => {
  it('relays bot identity without echo, and gives each actor its own cooldown and shot IDs', () => {
    const { host, guest } = setup()
    place(host.peer, 0, { bot: true, id: bot + 1 })
    send(host.peer, fire(1))
    send(host.peer, fire(2))
    send(host.peer, fire(1, bot + 1))
    // Explicitly omit the actor for a human action.
    const human = fire(1); delete (human as { bot?: number }).bot
    send(host.peer, human)
    expect(guest.peer.all('fire').map((m) => m.from)).toEqual([bot, bot + 1, host.id])
    expect(host.peer.all('fire')).toEqual([])
  })

  it('rejects non-host, human, absent, fractional and malformed actor identities for every gear message', () => {
    const { host, guest } = setup()
    const messages = [fire(1), { type: 'cord', cord: { s: 'on', to: guest.id, r: 20 } }, { type: 'yoink', y: { s: 'grab', to: guest.id } }]
    for (const msg of messages) {
      send(guest.peer, { ...msg, bot })
      for (const id of [host.id, guest.id, bot + 1, bot + 0.5, bot + MAX_BOTS, null, '65280']) send(host.peer, { ...msg, bot: id })
    }
    expect(guest.peer.all('fire')).toEqual([])
    expect(guest.peer.all('cord')).toEqual([])
    expect(guest.peer.all('yoink')).toEqual([])
  })

  it('requires fresh unpaused bot state, even when its host keeps talking', () => {
    const { host, guest } = setup()
    place(host.peer, 0, { bot: true, id: bot, paused: true })
    send(host.peer, fire(1))
    place(host.peer, 0, { bot: true, id: bot })
    clock += 1600
    place(host.peer, 0)
    send(host.peer, fire(2))
    expect(guest.peer.all('fire')).toEqual([])
  })

  it('keeps the host connection message budget shared across bot identities', () => {
    const { host, guest } = setup()
    for (let i = 0; i < 40; i++) send(host.peer, { type: 'ping', t: i })
    send(host.peer, fire(1))
    expect(guest.peer.all('fire')).toEqual([])
    clock += 1000
    place(host.peer, 0, { bot: true, id: bot })
    send(host.peer, fire(1))
    expect(guest.peer.all('fire')).toHaveLength(1)
  })

  it('keeps room gear switches authoritative for bots', () => {
    const { host, guest } = setup({ 'bigRed.allowed': false, 'pester.allowed': false, 'bungee.allowed': false, 'yoink.allowed': false })
    send(host.peer, fire(1))
    send(host.peer, fire(2, bot, { k: 'pester', to: guest.id }))
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    send(host.peer, { type: 'yoink', bot, y: { s: 'grab', to: guest.id } })
    expect(guest.peer.all('fire')).toEqual([])
    expect(guest.peer.all('cord')).toEqual([])
    expect(guest.peer.all('yoink')).toEqual([])
  })

  it('checks bot origin and reach using its own state, including bounded claimed speed', () => {
    const { host, guest } = setup()
    place(host.peer, 400, { bot: true, id: bot, v: [10000, 0, 0] })
    send(host.peer, fire(1))
    send(host.peer, fire(2, bot, { k: 'pester', to: guest.id }))
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    send(host.peer, { type: 'yoink', bot, y: { s: 'grab', to: guest.id } })
    expect(guest.peer.all('fire')).toEqual([])
    expect(guest.peer.all('cord')).toEqual([])
    expect(guest.peer.all('yoink')).toEqual([])
  })

  it('retains Pester target and lifetime enforcement for bot shooters', () => {
    const { host, guest } = setup()
    send(host.peer, fire(1, bot, { k: 'pester', to: guest.id }))
    send(host.peer, { type: 'hit', shooter: bot, shot: 1 })
    expect(guest.peer.all('hit')).toEqual([])
    send(guest.peer, { type: 'hit', shooter: bot, shot: 1 })
    expect(guest.peer.all('hit')).toEqual([{ type: 'hit', shooter: bot, victim: guest.id, shot: 1 }])
    clock += 2000
    place(host.peer, 0, { bot: true, id: bot })
    send(host.peer, fire(2, bot, { k: 'pester', to: guest.id }))
    for (let i = 0; i < 20; i++) {
      clock += 1000
      place(host.peer, 0, { bot: true, id: bot })
      place(guest.peer, 20)
    }
    send(guest.peer, { type: 'hit', shooter: bot, shot: 2 })
    expect(guest.peer.all('hit')).toHaveLength(1)
  })

  it('allows only one human or bot carrier, and ends bot carries on the server clock', () => {
    const { host, guest } = setup()
    send(host.peer, { type: 'yoink', bot, y: { s: 'grab', to: guest.id } })
    send(host.peer, { type: 'yoink', y: { s: 'grab', to: guest.id } })
    expect(guest.peer.all('yoink').map((m) => m.from)).toEqual([bot])
    for (let i = 0; i < 7; i++) {
      clock += 1000
      place(host.peer, 0, { bot: true, id: bot })
      place(guest.peer, 20)
    }
    expect(guest.peer.all('yoink').at(-1)).toMatchObject({ from: bot, y: { s: 'drop' } })
    expect(host.peer.all('yoink').at(-1)).toMatchObject({ from: bot, y: { s: 'drop' } })
  })

  it('forces bot cord corrections to the host too, and expires bots without incoming messages', () => {
    const { host, guest } = setup()
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    place(guest.peer, 400)
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    expect(host.peer.all('cord').at(-1)).toMatchObject({ from: bot, cord: { s: 'off' } })
    place(guest.peer, 20)
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    clock += 5100
    room.tick()
    expect(guest.peer.all('cord').at(-1)).toMatchObject({ from: bot, cord: { s: 'off' } })
    expect(guest.peer.all('leave')).toContainEqual({ type: 'leave', id: bot })
  })

  it('clears bot actions on host transfer and requires a fresh roster from the successor', () => {
    const { host, guest } = setup()
    const observer = join('Observer')
    send(host.peer, { type: 'yoink', bot, y: { s: 'grab', to: guest.id } })
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    room.disconnect(host.peer)
    expect(guest.peer.all('yoink').at(-1)).toMatchObject({ from: bot, y: { s: 'drop' } })
    expect(guest.peer.all('cord').at(-1)).toMatchObject({ from: bot, cord: { s: 'off' } })
    send(guest.peer, fire(1))
    expect(observer.peer.all('fire')).toEqual([])
    place(guest.peer, 0, { bot: true, id: bot })
    send(guest.peer, fire(1))
    expect(observer.peer.all('fire').at(-1)).toMatchObject({ from: bot })
  })

  it('clears bots on held host disconnect while retaining human identity, host and lock on rejoin', () => {
    const token = 'a'.repeat(32)
    const { host, guest } = setup({ 'game.rejoin': true }, token)
    const third = join('Third')
    place(third.peer, 30)
    send(guest.peer, { type: 'yoink', y: { s: 'grab', to: third.id } })
    send(host.peer, { type: 'lock', locked: true })
    send(host.peer, { type: 'yoink', bot, y: { s: 'grab', to: guest.id } })
    room.disconnect(host.peer)
    expect(room.heldCount).toBe(1)
    expect(guest.peer.all('leave').map((m) => m.id)).toEqual([bot])
    expect(third.peer.all('yoink').filter((m) => m.from === guest.id)).toEqual([{ type: 'yoink', from: guest.id, y: { s: 'grab', to: third.id } }])
    const resumed = join('Host', {}, token)
    expect(resumed.id).toBe(host.id)
    expect(resumed.peer.all('welcome')[0]!.game).toMatchObject({ host: host.id, locked: true })
    send(resumed.peer, fire(1))
    expect(guest.peer.all('fire')).toEqual([])
    place(resumed.peer, 0, { bot: true, id: bot })
    send(resumed.peer, fire(1))
    expect(guest.peer.all('fire').at(-1)).toMatchObject({ from: bot })
  })
})
