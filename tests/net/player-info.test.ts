/**
 * The players card's facts and the host's powers (feat/player-info-and-eject). Each case names
 * its bug:
 * - geoOf letting anything finer than a first-level region out of the Worker;
 * - a player who turned location off still shown with it, to anyone;
 * - free text accepted as a device;
 * - a plain host in a public world, or anyone not a moderator, ejecting or muting by forging the
 *   message;
 * - an ejected player rejoining inside the window, or a "none" eject still turned away;
 * - a banish list that silently drops a permanent banish when full;
 * - a host change announced twice, or without who had it;
 * - a bot trait outside 0..1 or unknown kept, or overrides lost when the host changes;
 * - a room-muted player's chat still relayed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { geoOf, geoFromHeader, geoHeader, type Geo } from '../../server/analytics'
import { BANISH_CAP, BanishList } from '../../server/banish'
import { BOT_ID_BASE, CLOSE_EJECTED, PROTOCOL_VERSION, type ServerMessage, type WireState, encodeState } from '../../shared/protocol'
import { canModerate } from '../../shared/moderation'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  closed: number | null = null
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(code?: number): void { this.closed = code ?? 1000 }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.json.filter(m => m.type === type) as never }
}
const TEXAS: Geo = geoOf({ country: 'US', continent: 'NA', region: 'Texas', regionCode: 'TX' }, 'production')
let clock = 0
let room: Room
let saved: unknown
function join(name: string, extra: object = {}, geo: Geo = TEXAS): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  room.setGeo(peer, geo)
  room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: {}, ...extra }))
  return { peer, id: peer.last('welcome')?.id ?? 0 }
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
const roster = (peer: FakePeer, id: number) => {
  let info = peer.last('welcome')?.players.find(p => p.id === id)
  for (const m of peer.json) if ((m.type === 'profile' || m.type === 'join') && m.player.id === id) info = m.player
  return info
}
const make = (name: string) => { room = new Room(name, { now: () => clock, banishes: saved, onBanishes: list => { saved = list } }) }
beforeEach(() => { clock = 100_000; saved = undefined })

describe('location never finer than a first-level region', () => {
  it('lets only country, continent, region and region code out of a full request.cf', () => {
    const cf = {
      country: 'US', continent: 'NA', region: 'Texas', regionCode: 'TX', city: 'Austin', postalCode: '78701', metroCode: '635',
      latitude: '30.27', longitude: '-97.74', timezone: 'America/Chicago', asn: 7922, asOrganization: 'Comcast', colo: 'DFW',
      clientTcpRtt: 12, httpProtocol: 'HTTP/2', tlsVersion: 'TLSv1.3', isEUCountry: '0',
    }
    const g = geoOf(cf, 'production')
    expect(Object.keys(g).sort()).toEqual(['channel', 'continent', 'country', 'region', 'regionCode'])
    expect(g).toMatchObject({ country: 'US', region: 'Texas', regionCode: 'TX' })
    const text = JSON.stringify(geoFromHeader(geoHeader(g)))
    for (const leak of ['Austin', '78701', '30.27', '97.74', 'Chicago', '7922', 'Comcast', 'DFW']) expect(text).not.toContain(leak)
    // Odd region names survive the header; anything that is not a name is dropped.
    expect(geoFromHeader(geoHeader(geoOf({ country: 'FR', region: 'Île-de-France' }))).region).toBe('Île-de-France')
    expect(geoOf({ country: 'US', region: '<b>Texas</b>' }).region).toBe('')
  })
  it('puts region and country on the roster, and nothing when the player turns it off', () => {
    make('friends')
    const a = join('A'), b = join('B', { shareLocation: false })
    expect(roster(a.peer, a.id)).toMatchObject({ country: 'US', region: 'Texas' })
    expect(roster(a.peer, b.id)?.country).toBeUndefined(); expect(roster(a.peer, b.id)?.region).toBeUndefined()
    send(a.peer, { type: 'profile', shareLocation: false })
    for (const p of [a, b]) { expect(roster(p.peer, a.id)?.country).toBeUndefined(); expect(roster(p.peer, a.id)?.region).toBeUndefined() }
    send(a.peer, { type: 'profile', shareLocation: true })
    expect(roster(b.peer, a.id)).toMatchObject({ country: 'US', region: 'Texas' })
    // No region known: country only.
    const c = join('C', {}, geoOf({ country: 'JP' }))
    expect(roster(a.peer, c.id)).toMatchObject({ country: 'JP' }); expect(roster(a.peer, c.id)?.region).toBeUndefined()
  })
  it('keeps only the fixed device words and a strict model', () => {
    make('friends')
    const a = join('A', { deviceLabel: 'Android phone', deviceModel: 'Pixel 9' })
    const b = join('B', { deviceLabel: 'iPhone 18 Pro Max', deviceModel: 'whatever' })
    expect(roster(a.peer, a.id)).toMatchObject({ deviceLabel: 'Android phone', deviceModel: 'Pixel 9' })
    expect(roster(a.peer, b.id)?.deviceLabel).toBeUndefined(); expect(roster(a.peer, b.id)?.deviceModel).toBeUndefined()
  })
})

describe('who may moderate', () => {
  it('is the host in a private room or universe, a creator anywhere, never on oneself or a creator', () => {
    const host = { id: 1, host: true }, guest = { id: 2, host: false }, creator = { id: 3, host: false, role: 'creator' as const }
    expect(canModerate(host, guest, 'private')).toEqual({ ok: true, reason: 'host-private' })
    expect(canModerate(host, guest, 'universe').ok).toBe(true)
    expect(canModerate(host, guest, 'public')).toEqual({ ok: false, reason: 'public-world' })
    expect(canModerate(guest, host, 'private')).toEqual({ ok: false, reason: 'not-host' })
    expect(canModerate(creator, guest, 'public')).toEqual({ ok: true, reason: 'creator' })
    expect(canModerate(host, creator, 'private')).toEqual({ ok: false, reason: 'target-creator' })
    expect(canModerate(host, host, 'private').reason).toBe('self')
  })
  it('refuses a forged eject or mute from a non-moderator, and a plain host\'s in a public world', () => {
    make('friends')
    const host = join('Host'), guest = join('Guest'), other = join('Other')
    send(guest.peer, { type: 'eject', id: other.id, banish: 'permanent' })
    send(guest.peer, { type: 'mute', id: other.id, muted: true })
    expect(other.peer.closed).toBeNull(); expect(roster(host.peer, other.id)?.muted).toBeUndefined()
    make('public-alpine')
    const first = join('First'), stranger = join('Stranger')
    send(first.peer, { type: 'eject', id: stranger.id, banish: 'permanent' })
    send(first.peer, { type: 'mute', id: stranger.id, muted: true })
    expect(stranger.peer.closed).toBeNull(); expect(roster(first.peer, stranger.id)?.muted).toBeUndefined()
    expect(first.peer.last('welcome')?.roomKind).toBe('public')
  })
})

describe('eject and banish', () => {
  it('ejects with the chosen banish, keeps them out of this world for it, and lets "none" come straight back', () => {
    make('friends')
    const host = join('Host'), guest = join('Guest', { aid: 'a'.repeat(32) })
    send(host.peer, { type: 'eject', id: guest.id, banish: '30m' })
    expect(guest.peer.last('ejected')).toMatchObject({ by: host.id, banish: '30m', seconds: 1800 })
    expect(guest.peer.closed).toBe(CLOSE_EJECTED)
    expect(host.peer.last('game')).toMatchObject({ event: 'eject', actor: host.id, target: guest.id })
    // Back within the window, even from a new tab (no rejoin secret): turned away, told how long.
    clock += 29 * 60_000
    const again = join('Guest', { aid: 'a'.repeat(32) })
    expect(again.peer.last('welcome')).toBeUndefined(); expect(again.peer.closed).toBe(CLOSE_EJECTED)
    expect(again.peer.last('ejected')).toMatchObject({ banish: '30m', seconds: 60 })
    clock += 2 * 60_000
    expect(join('Guest', { aid: 'a'.repeat(32) }).peer.last('welcome')).toBeDefined()
    // "none": removed, and may rejoin at once. (A fresh room: the long wait above left the first host silent, and the room let them go.)
    make('friends')
    const host2 = join('Host'), b = join('B', { aid: 'b'.repeat(32) })
    send(host2.peer, { type: 'eject', id: b.id, banish: 'none' })
    expect(b.peer.last('ejected')).toMatchObject({ banish: 'none', seconds: 0 })
    expect(join('B', { aid: 'b'.repeat(32) }).peer.last('welcome')).toBeDefined()
  })
  it('keeps a permanent banish across the room emptying and being made again from storage', () => {
    make('friends')
    const host = join('Host'), guest = join('Guest', { aid: 'c'.repeat(32) })
    send(host.peer, { type: 'eject', id: guest.id, banish: 'permanent' })
    make('friends') // a new room object, as after hibernation or a release: only the banish storage carries over
    clock += 365 * 86_400_000
    expect(join('Guest', { aid: 'c'.repeat(32) }).peer.last('ejected')).toMatchObject({ banish: 'permanent', seconds: null })
  })
  it('lists banishes to moderators only, without identities, and lifts one', () => {
    make('friends')
    const host = join('Host'), guest = join('Guest', { aid: 'd'.repeat(32) }), other = join('Other')
    send(host.peer, { type: 'eject', id: guest.id, banish: '24h' })
    send(other.peer, { type: 'banishes' }); expect(other.peer.last('banishes')).toBeUndefined()
    send(host.peer, { type: 'banishes' })
    const list = host.peer.last('banishes')!.list
    expect(list).toEqual([{ ref: expect.any(String), name: 'Guest', seconds: 86_400 }]); expect(JSON.stringify(list)).not.toContain('dddd')
    send(host.peer, { type: 'unbanish', ref: list[0].ref })
    expect(join('Guest', { aid: 'd'.repeat(32) }).peer.last('welcome')).toBeDefined()
  })
  it('refuses a new permanent banish when the list is full of them, rather than dropping one', () => {
    let n = 0
    const list = new BanishList([], () => 0, () => `r${n++}`)
    for (let i = 0; i < BANISH_CAP; i++) expect(list.add({ aid: `p${i}`, name: 'x', until: null })).not.toBe('full')
    expect(list.add({ aid: 'new', name: 'x', until: null })).toBe('full')
    expect(list.add({ aid: 'timed', name: 'x', until: 1000 })).toBe('full')
    expect(list.list()).toHaveLength(BANISH_CAP)
  })
})

describe('host changes and room mute', () => {
  it('announces a host change once, with who had it and why', () => {
    make('friends')
    const host = join('Host'), next = join('Next'), third = join('Third')
    room.disconnect(host.peer)
    clock += 60_000; (room as unknown as { tick?: (n: number) => void }).tick?.(clock)
    const events = third.peer.all('game').filter(m => m.event === 'host')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actor: next.id, from: host.id })
  })
  it('stops relaying a room-muted player\'s chat and tells them why', () => {
    make('friends')
    const host = join('Host'), guest = join('Guest')
    send(host.peer, { type: 'mute', id: guest.id, muted: true })
    expect(roster(host.peer, guest.id)?.muted).toBe(true)
    send(guest.peer, { type: 'chat', text: 'hello' })
    expect(host.peer.all('chat').filter(m => m.from === guest.id)).toHaveLength(0)
    expect(guest.peer.last('chat-refused')?.reason).toBe('muted')
  })
})

describe('bot personality overrides', () => {
  const botState = (id: number) => encodeState({ id, t: clock / 1000, p: [1, 0, 1], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), bot: true } as WireState)
  it('clamps to 0..1, drops unknown traits, and keeps them across a host change', () => {
    make('friends')
    const host = join('Host'), other = join('Other')
    room.receive(host.peer, botState(BOT_ID_BASE))
    send(other.peer, { type: 'bot-traits', bot: BOT_ID_BASE, traits: { boldness: 1 } })
    expect(host.peer.last('bot-traits')).toBeUndefined()
    send(host.peer, { type: 'bot-traits', bot: BOT_ID_BASE, traits: { boldness: 7, mischief: -2, evil: 1 } })
    expect(other.peer.last('bot-traits')).toEqual({ type: 'bot-traits', bot: BOT_ID_BASE, traits: { boldness: 1, mischief: 0 } })
    room.disconnect(host.peer); clock += 60_000
    const late = join('Late')
    expect(late.peer.last('welcome')?.botTraits).toEqual({ [BOT_ID_BASE]: { boldness: 1, mischief: 0 } })
    expect(room.snapshot().botTraits).toEqual({ [BOT_ID_BASE]: { boldness: 1, mischief: 0 } })
  })
})
