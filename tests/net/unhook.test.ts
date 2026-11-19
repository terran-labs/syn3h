/** Unhook and the play setting (server/room.ts). */
import { beforeEach, describe, expect, it } from 'vitest'
import { Room, type Peer } from '../../server/room'
import { BOT_ID_BASE, MAX_BOTS, PROTOCOL_VERSION, encodeState, decodeState, type ServerMessage, type WireState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  states: WireState[] = []
  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.json.push(JSON.parse(data))
    else { const state = decodeState(data); if (state) this.states.push(state) }
  }
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


// Breaking free of someone else's cord (shared/protocol.ts 'unhook'). Bugs caught: anyone
// cutting a cord that is not on them; a bot's cord not reaching the host to be let go; a
// newer client's "Bots may play with me" upsetting the room, or an older client that never
// sends it being treated as a no.
describe('unhook', () => {
  it('relays a bot cord\'s unhook to the host, from the player it is tied to', () => {
    const { host, guest } = setup()
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    expect(guest.peer.all('cord').length).toBeGreaterThan(0)
    send(guest.peer, { type: 'unhook', from: bot })
    expect(host.peer.all('unhook')).toEqual([{ type: 'unhook', by: guest.id, owner: bot }])
  })
  it('ignores an unhook from someone the cord is not tied to, or for no cord at all', () => {
    const { host, guest } = setup()
    const third = join('Third'); place(third.peer, 10)
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    send(third.peer, { type: 'unhook', from: bot })
    send(guest.peer, { type: 'unhook', from: host.id })
    send(guest.peer, { type: 'unhook', from: 'nobody' })
    expect(host.peer.all('unhook')).toEqual([])
    expect(third.peer.all('error')).toEqual([])
  })
  // Bug caught: a free cut in the games, where a cord on the hill's holder is the play.
  it.each([[0, 'Tag'], [1, 'King of the Hill']])('ignores every unhook in game mode %s (%s)', (mode) => {
    const { host, guest } = setup()
    send(host.peer, { type: 'param', id: 'game.mode', value: mode })
    expect(host.peer.all('game').at(-1)?.game.mode).toBe(mode)
    send(host.peer, { type: 'cord', bot, cord: { s: 'on', to: guest.id, r: 20 } })
    send(guest.peer, { type: 'unhook', from: bot })
    expect(host.peer.all('unhook')).toEqual([])
  })
  it('relays a person\'s cord unhook to that person', () => {
    const { host, guest } = setup()
    send(guest.peer, { type: 'cord', cord: { s: 'on', to: host.id, r: 20 } })
    send(host.peer, { type: 'unhook', from: guest.id })
    expect(guest.peer.all('unhook')).toEqual([{ type: 'unhook', by: host.id, owner: guest.id }])
  })
})

describe('Bots may play with me', () => {
  it('an older hello without the field joins and is treated as yes', () => {
    const { guest } = setup()
    const info = guest.peer.all('welcome')[0]!.players.find((p) => p.id === guest.id)!
    expect(info.play).toBeUndefined()
  })
  it('a newer hello or profile saying no is carried to everyone, and yes again clears it', () => {
    const host = join('Host', world)
    const peer = new FakePeer(); room.connect(peer)
    send(peer, { type: 'hello', v: PROTOCOL_VERSION, name: 'Shy', params: {}, play: false })
    const id = peer.all('welcome')[0]!.id
    expect(host.peer.all('join').find((m) => m.player.id === id)?.player.play).toBe(false)
    send(peer, { type: 'profile', play: true })
    expect(host.peer.all('profile').at(-1)?.player.play).toBeUndefined()
  })
  it('an unknown extra field from a newer client does not upset the room', () => {
    const peer = new FakePeer(); room.connect(peer)
    send(peer, { type: 'hello', v: PROTOCOL_VERSION, name: 'Future', params: {}, play: true, someFutureField: { a: 1 } })
    expect(peer.all('welcome')).toHaveLength(1)
    send(peer, { type: 'profile', play: false, anotherNewThing: 'x' })
    expect(peer.all('error')).toEqual([])
  })
})
