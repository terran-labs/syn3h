/**
 * Renaming in play: an optional `name` on the profile message (shared/protocol.ts). The room
 * treats it as it treats a name at hello, limits how often it may change, and changes nothing
 * else about the player.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, RENAME_INTERVAL_MS, type PlayerInfo, type ServerMessage } from '../../shared/protocol'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.json.filter(m => m.type === type) as never }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined { return this.all(type).at(-1) }
}

let clock = 0
let room: Room
const SECRET = 'rename-secret-0123456789'
function join(name: string, extra: object = {}): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: {}, ...extra }))
  return { peer, id: peer.last('welcome')!.id }
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
const roster = (peer: FakePeer) => peer.last('profile')?.player

beforeEach(() => { clock = 100_000; room = new Room('test', { now: () => clock }) })

describe('rename in play', () => {
  it('cleans and de-duplicates the new name as at hello, and tells everyone', () => {
    const a = join('Ann'), b = join('Bob')
    send(b.peer, { type: 'profile', name: '  <Zib>wick\u0007  ' })
    expect(roster(a.peer)).toMatchObject({ id: b.id, name: 'Zibwick' })
    expect(roster(b.peer)).toMatchObject({ id: b.id, name: 'Zibwick' })
    clock += RENAME_INTERVAL_MS
    send(b.peer, { type: 'profile', name: 'ann' })
    expect(roster(a.peer)!.name).toBe('ann 2')
    // Renaming to your own name does not collide with yourself.
    clock += RENAME_INTERVAL_MS
    send(b.peer, { type: 'profile', name: 'ann 2' })
    expect(roster(a.peer)!.name).toBe('ann 2')
  })

  it('changes only the name: id, host, score, vehicle, colours and rejoin secret stay', () => {
    const a = join('Ann', { kind: 'jet', colors: ['#112233', '#445566'], resume: SECRET }), b = join('Bob')
    const before = { ...b.peer.last('welcome')!.players.find(p => p.id === a.id)! }
    expect(b.peer.last('welcome')!.game.host).toBe(a.id)
    send(a.peer, { type: 'profile', name: 'Pippo' })
    expect(roster(b.peer)).toEqual({ ...before, name: 'Pippo' } satisfies PlayerInfo)
    // A dropout and rejoin with the same secret is the same player, still host, with the new name.
    room.disconnect(a.peer)
    clock += 1000
    const back = join('Ann', { resume: SECRET }), welcome = back.peer.last('welcome')!
    expect(back.id).toBe(a.id)
    expect(welcome.game.host).toBe(a.id)
    expect(welcome.players.find(p => p.id === a.id)!.name).toBe('Pippo')
  })

  it('takes one rename per interval; a later one in the window is ignored and the sender told its name', () => {
    const a = join('Ann'), b = join('Bob')
    send(b.peer, { type: 'profile', name: 'One' })
    const seen = a.peer.all('profile').length
    for (let i = 0; i < 20; i++) { clock += 50; send(b.peer, { type: 'profile', name: `Spam ${i}` }) }
    // Nobody else hears the flood.
    expect(a.peer.all('profile').length).toBe(seen)
    expect(roster(a.peer)!.name).toBe('One')
    // The sender is told the name it still has.
    expect(roster(b.peer)!.name).toBe('One')
    clock += RENAME_INTERVAL_MS
    send(b.peer, { type: 'profile', name: 'Two' })
    expect(roster(a.peer)!.name).toBe('Two')
  })

  it('a rate-limited rename still applies colours sent with it', () => {
    const a = join('Ann'), b = join('Bob')
    send(b.peer, { type: 'profile', name: 'One' })
    send(b.peer, { type: 'profile', name: 'Two', colors: ['#aa0000', '#00aa00'] })
    expect(roster(a.peer)).toMatchObject({ name: 'One', colors: ['#aa0000', '#00aa00'] })
  })

  it('a profile without a name, as an older client sends, leaves the name alone', () => {
    const a = join('Ann'), b = join('Bob')
    send(b.peer, { type: 'profile', colors: ['#aa0000', '#00aa00'] })
    expect(roster(a.peer)).toMatchObject({ name: 'Bob', colors: ['#aa0000', '#00aa00'] })
  })

  // An older client's handler replaces its roster entry with `player` (src/net/index.ts before
  // this change did exactly `players.set(msg.player.id, msg.player)`), so the broadcast must be
  // a whole, ordinary PlayerInfo in the message shape it already knows.
  it('the broadcast an older client receives is the existing profile message with a full PlayerInfo', () => {
    const a = join('Ann'), b = join('Bob')
    send(b.peer, { type: 'profile', name: 'Pippo' })
    const msg = a.peer.last('profile')!
    expect(Object.keys(msg).sort()).toEqual(['player', 'type'])
    expect(Object.keys(msg.player).sort()).toEqual(Object.keys(b.peer.last('welcome')!.players.find(p => p.id === b.id)!).sort())
  })
})
