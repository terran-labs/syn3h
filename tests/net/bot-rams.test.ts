/** Bot-on-bot rams. */
import { beforeEach, describe, expect, it } from 'vitest'
import { Room, type Peer } from '../../server/room'
import { BOT_ID_BASE, MAX_BOTS, PROTOCOL_VERSION, encodeState, decodeState, type ServerMessage, type WireState } from '../../shared/protocol'
import { emptyInputLike } from './helpers'
import { BotRamReporter } from '../../src/net/botRams'

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


// Bot-on-bot rams (the host reports them; src/net/botRams.ts, server/room.ts onRam). Bugs
// caught: an older room crediting the host's own player for a bot's ram (the reporter must stay
// silent until the room's welcome says it understands); a contact reported every step; anyone
// but the host reporting for a bot; a bot's ram on a person counted twice.
describe('bot-on-bot rams, host side', () => {
  const a = {}, b = {}
  it('reports nothing to a room whose welcome does not say botRams (an older room)', () => {
    const r = new BotRamReporter(0.5)
    // Welcome from an older room: no botRams field, so the reporter stays off.
    r.enabled = ({ type: 'welcome' } as { botRams?: true }).botRams === true
    let reports = 0
    for (let i = 0; i < 200; i++) reports += r.step(i * 0.02, [[bot, a, 5], [bot + 1, b, 1]], () => i % 40 < 20).length
    expect(reports).toBe(0)
  })
  it('reports each new contact once, the faster bot as the rammer, spaced like a person\'s rams', () => {
    const r = new BotRamReporter(0.5)
    r.enabled = true
    const out: { bot: number; other: number }[] = []
    for (let i = 0; i < 200; i++) out.push(...r.step(i * 0.02, [[bot, a, 1], [bot + 1, b, 6]], () => i % 50 < 10))
    expect(out.length).toBe(4)
    expect(out.every(x => x.bot === bot + 1 && x.other === bot)).toBe(true)
  })
})

describe('bot-on-bot rams, in the room', () => {
  it('tells every client it understands them', () => {
    const { guest } = setup()
    expect(guest.peer.all('welcome')[0]!.botRams).toBe(true)
  })
  it('in tag, a bot ramming the bot that is it takes the role; neither person is credited', () => {
    const { host, guest } = setup()
    place(host.peer, 1, { bot: true, id: bot + 1 })
    send(host.peer, { type: 'param', id: 'game.mode', value: 0 })
    // First the host's player rams bot 0, which makes it "it"; then time passes (states keep
    // flowing, so nobody is dropped) beyond the tag cooldown.
    const g = () => guest.peer.all('game').at(-1)!.game
    const pass = (seconds: number) => { for (let i = 0; i < seconds * 4; i++) { clock += 250; place(host.peer, 0, { bot: true, id: bot }); place(host.peer, 1, { bot: true, id: bot + 1 }); place(host.peer, 0); place(guest.peer, 20) } }
    pass(5)
    send(host.peer, { type: 'ram', other: bot })
    const firstIt = g().it
    pass(5)
    if (firstIt !== bot) return expect.fail(`setup: expected bot ${bot} to be it, got ${firstIt}`)
    send(host.peer, { type: 'ram', other: bot, bot: bot + 1 })
    expect(g().it).toBe(bot + 1)
    expect(g().it).not.toBe(host.id)
    expect(g().it).not.toBe(guest.id)
  })
  it('refuses a bot ram from anyone but the host, and a bot ram on a person', () => {
    const { host, guest } = setup()
    place(host.peer, 1, { bot: true, id: bot + 1 })
    send(host.peer, { type: 'param', id: 'game.mode', value: 0 })
    const before = guest.peer.all('game').length
    send(guest.peer, { type: 'ram', other: bot, bot: bot + 1 })
    send(host.peer, { type: 'ram', other: guest.id, bot })
    expect(guest.peer.all('game').filter(m => m.event === 'ram').length).toBe(0)
    expect(guest.peer.all('game').length).toBe(before)
  })
})
