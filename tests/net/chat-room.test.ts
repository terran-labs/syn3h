/**
 * Chat in the room: the room cleans, limits, filters and names the speaker. Each test names
 * the bug it catches.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { BOT_ID_BASE, PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'
import { CHAT_BURST, CHAT_REFILL_S, MAX_CHAT_LENGTH } from '../../shared/chat'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  closed = false
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void { this.closed = true }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.json.filter((m) => m.type === type) as never
  }
}

let clock = 0
let room: Room
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))

function join(name: string): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  send(peer, { type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: {} })
  const welcome = peer.all('welcome').at(-1)!
  return { peer, id: welcome.id }
}

function botState(id: number): Uint8Array {
  const s: WireState = { id, t: clock / 1000, p: [5, 1, 5], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), bot: true }
  return encodeState(s)
}

beforeEach(() => {
  clock = 100_000
  room = new Room('chat', { now: () => clock })
})

describe('room chat', () => {
  it('relays a line to everyone with the real sender id, whatever the client claims', () => {
    const a = join('Ann'), b = join('Bob')
    send(a.peer, { type: 'chat', text: 'hello', from: b.id, id: b.id })
    for (const p of [a.peer, b.peer]) expect(p.all('chat')).toMatchObject([{ from: a.id, text: 'hello' }])
  })

  it('trims, strips control and invisible characters, limits length and refuses empty lines', () => {
    const a = join('Ann')
    send(a.peer, { type: 'chat', text: '   \u0007hi‮ there​\n ' })
    send(a.peer, { type: 'chat', text: '   ​ \u0000 ' })
    send(a.peer, { type: 'chat', text: 42 })
    send(a.peer, { type: 'chat', text: 'x'.repeat(MAX_CHAT_LENGTH + 50) })
    const lines = a.peer.all('chat').map((m) => m.text)
    expect(lines[0]).toBe('hi there')
    expect(lines[1]).toHaveLength(MAX_CHAT_LENGTH)
    expect(lines).toHaveLength(2)
  })

  it('rate limits each player and tells them when to try again', () => {
    const a = join('Ann'), b = join('Bob')
    for (let i = 0; i < CHAT_BURST + 3; i++) send(a.peer, { type: 'chat', text: `line ${i}` })
    expect(b.peer.all('chat')).toHaveLength(CHAT_BURST)
    const refused = a.peer.all('chat-refused')
    expect(refused.length).toBe(3)
    expect(refused[0]).toMatchObject({ reason: 'rate' })
    expect(refused[0].wait).toBeGreaterThan(0)
    // Another player has their own allowance.
    send(b.peer, { type: 'chat', text: 'me too' })
    expect(a.peer.all('chat').at(-1)).toMatchObject({ from: b.id })
    // After the refill time, one more line gets through.
    clock += CHAT_REFILL_S * 1000
    send(a.peer, { type: 'chat', text: 'later' })
    expect(b.peer.all('chat').at(-1)).toMatchObject({ from: a.id, text: 'later' })
  })

  it('masks filtered words on the way through', () => {
    const a = join('Ann')
    send(a.peer, { type: 'chat', text: 'you are a f@gg0t' })
    expect(a.peer.all('chat')[0].text).toBe('you are a ******')
  })

  it('only the host may turn room chat off, and then nobody can chat', () => {
    const host = join('Host'), guest = join('Guest')
    send(guest.peer, { type: 'param', id: 'chat.on', value: false })
    // The guest is snapped back and chat still works.
    expect(guest.peer.all('param').at(-1)).toMatchObject({ id: 'chat.on', value: true, from: 0 })
    send(guest.peer, { type: 'chat', text: 'still on' })
    expect(host.peer.all('chat')).toHaveLength(1)
    send(host.peer, { type: 'param', id: 'chat.on', value: false })
    send(guest.peer, { type: 'chat', text: 'now off' })
    send(host.peer, { type: 'chat', text: 'host too' })
    expect(host.peer.all('chat')).toHaveLength(1)
    expect(guest.peer.all('chat-refused').at(-1)).toMatchObject({ reason: 'off' })
  })

  it('only the bot simulator may speak for a bot, and only for a live one', () => {
    const host = join('Host'), guest = join('Guest')
    const bot = BOT_ID_BASE + 2
    room.receive(host.peer, botState(bot))
    send(guest.peer, { type: 'chat', text: 'I am a bot', bot })
    send(host.peer, { type: 'chat', text: 'no such bot', bot: BOT_ID_BASE + 9 })
    send(host.peer, { type: 'chat', text: 'not a bot id', bot: guest.id })
    expect(guest.peer.all('chat')).toHaveLength(0)
    send(host.peer, { type: 'chat', text: 'Rocks are just slow clouds.', bot })
    expect(guest.peer.all('chat')).toMatchObject([{ from: bot, text: 'Rocks are just slow clouds.' }])
  })

  it('bot chatter off in the room stops bot lines, and the bots share a rate limit', () => {
    const host = join('Host'), guest = join('Guest')
    const bot = BOT_ID_BASE
    room.receive(host.peer, botState(bot))
    for (let i = 0; i < 20; i++) send(host.peer, { type: 'chat', text: `bot line ${i}`, bot })
    const allowed = guest.peer.all('chat').length
    expect(allowed).toBeGreaterThan(0)
    expect(allowed).toBeLessThan(20)
    clock += 60_000
    room.receive(host.peer, botState(bot))
    send(host.peer, { type: 'param', id: 'bots.chatter', value: false })
    send(host.peer, { type: 'chat', text: 'shh', bot })
    expect(guest.peer.all('chat')).toHaveLength(allowed)
    // People can still chat.
    send(guest.peer, { type: 'chat', text: 'quiet now' })
    expect(guest.peer.all('chat')).toHaveLength(allowed + 1)
  })

  it('a newcomer gets no history, and nothing about chat is in the stored snapshot', () => {
    const snapshots: string[] = []
    room = new Room('chat', { now: () => clock, onPersist: (s) => snapshots.push(JSON.stringify(s)) })
    const a = join('Ann')
    send(a.peer, { type: 'chat', text: 'secret sandwich recipe' })
    const late = join('Late')
    expect(late.peer.all('chat')).toHaveLength(0)
    expect(JSON.stringify(late.peer.json)).not.toContain('sandwich')
    expect(snapshots.join('')).not.toContain('sandwich')
    expect(room.chatLines).toBe(1)
  })

  it('an older client that never sends chat still receives other players\' lines without disruption', () => {
    // An older bundle ignores message types it does not know (its switch has no default),
    // so the only requirement on the room is that a plain JSON line arrives and nothing else
    // about the conversation changes for that peer.
    const old = join('Old'), a = join('Ann')
    send(a.peer, { type: 'chat', text: 'hi old friend' })
    expect(old.peer.all('chat')).toHaveLength(1)
    expect(old.peer.closed).toBe(false)
  })

  it('unknown chat-like messages from a newer client are dropped, as an older room drops chat', () => {
    // An older room has no 'chat' case: the line is dropped and the connection stays up.
    // A newer client's future message type gets the same treatment from this room.
    const a = join('Ann'), b = join('Bob')
    send(a.peer, { type: 'chat-reaction', text: 'wave' })
    expect(b.peer.json.some((m) => (m.type as string) === 'chat-reaction')).toBe(false)
    expect(a.peer.closed).toBe(false)
    send(a.peer, { type: 'chat', text: 'still fine' })
    expect(b.peer.all('chat')).toHaveLength(1)
  })
})
