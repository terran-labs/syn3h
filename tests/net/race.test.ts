import { beforeEach, describe, expect, it } from 'vitest'
import { Room, type Peer } from '../../server/room'
import { BOT_ID_BASE, PROTOCOL_VERSION, encodeState, type RaceState, type RaceUpdate, type ServerMessage } from '../../shared/protocol'
import { emptyInputLike } from './helpers'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array) { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close() {}
  all<T extends ServerMessage['type']>(type: T) { return this.json.filter(m => m.type === type) as Extract<ServerMessage, { type: T }>[] }
  race() { return this.all('race').at(-1)?.race ?? null }
}
let room: Room, clock: number
let host: FakePeer, guest: FakePeer, hostId: number
const bot = BOT_ID_BASE
function send(peer: Peer, msg: object) { room.receive(peer, JSON.stringify(msg)) }
function join(name: string) {
  const peer = new FakePeer(); room.connect(peer)
  send(peer, { type: 'hello', v: PROTOCOL_VERSION, name, params: {} })
  return peer
}
function place(peer: Peer, id = 0, x = 0, paused = false) {
  room.receive(peer, encodeState({ id, bot: id >= bot, t: clock / 1000, p: [x, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused }))
}
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 500) {
    clock += Math.min(left, 500)
    place(host); place(host, bot); place(host, bot + 1); place(guest)
  }
}
function proposal(extra: Partial<RaceUpdate> = {}): RaceUpdate {
  return { id: 'race-one', revision: 1, phase: 'countdown', remainingMs: 5000,
    destination: { label: 'Ridge', x: 100, y: 0, z: 0, radius: 10 },
    participants: [hostId, bot, bot + 1].map(id => ({ id, name: 'Forged name', status: 'racing' })), winnerId: null, ...extra }
}
function publish(update: RaceUpdate) { send(host, { type: 'race', race: update }) }
function update(extra: Partial<RaceUpdate>) { const r = host.race()!; publish({ ...r, revision: r.revision + 1, ...extra }) }
beforeEach(() => {
  clock = 100000; room = new Room('race', { now: () => clock })
  host = join('Host'); hostId = host.all('welcome')[0]!.id; guest = join('Guest')
  place(host); place(host, bot); place(host, bot + 1); place(guest)
  send(host, { type: 'race-ready', driving: true })
})

describe('Automatic race relay', () => {
  it('requires host authority and explicit driving, excludes spectators, and replies on rejection', () => {
    send(guest, { type: 'race', race: proposal() })
    expect(guest.all('race').at(-1)).toEqual({ type: 'race', race: null })
    send(host, { type: 'race-ready', driving: false }); publish(proposal())
    expect(host.race()).toBeNull()
    send(host, { type: 'race-ready', driving: true })
    publish(proposal({ participants: [{ id: hostId, name: '', status: 'racing' }, { id: guest.all('welcome')[0]!.id, name: '', status: 'racing' }] }))
    expect(host.race()).toBeNull()
    publish(proposal())
    expect(host.race()?.participants.map(p => p.name)).toEqual(['Host', 'Bot 1', 'Bot 2'])
    expect(guest.race()).toEqual(host.race())
  })

  it('rejects malformed bounds, duplicate participants and flying or paused entrants', () => {
    publish(proposal({ destination: { label: 'Bad', x: 1e9, y: 0, z: 0, radius: 10 } }))
    publish(proposal({ participants: [proposal().participants[0], proposal().participants[0]] }))
    publish(proposal({ revision: -1 }))
    expect(host.race()).toBeNull()
    place(host, bot, 0, true); publish(proposal()); expect(host.race()).toBeNull()
    place(host, bot); send(host, { type: 'bot', id: bot, kind: 'jet' }); publish(proposal()); expect(host.race()).toBeNull()
  })

  it('enforces countdown, immutable destination, revision order and fixed running deadline', () => {
    publish(proposal()); update({ phase: 'running', remainingMs: 120000 })
    expect(host.race()?.phase).toBe('countdown')
    advance(2000)
    publish(proposal({ revision: 1 }))
    expect(host.race()?.remainingMs).toBe(3000)
    update({ destination: { ...proposal().destination, x: 110 } })
    expect(host.race()?.destination.x).toBe(100)
    advance(3000); update({ phase: 'running', remainingMs: 120000 })
    expect(host.race()?.remainingMs).toBe(120000)
    advance(1000); update({ remainingMs: 120000 })
    expect(host.race()?.remainingMs).toBe(119000)
    expect(host.race()?.updatedAt).toBe(clock / 1000)
  })

  it('keeps viable withdrawals and forbids reviving a withdrawn participant', () => {
    publish(proposal())
    send(host, { type: 'race-leave', id: 'race-one' })
    expect(host.race()?.phase).toBe('countdown')
    expect(host.race()?.participants[0].status).toBe('withdrawn')
    update({ participants: proposal().participants })
    expect(host.race()?.participants[0].status).toBe('withdrawn')
    // Another competitor becomes ineligible, leaving only one.
    place(host, bot, 0, true); room.tick()
    expect(host.race()?.phase).toBe('cancelled')
  })

  it('does not let guests cancel the race or withdraw someone else', () => {
    publish(proposal())
    send(guest, { type: 'race-leave', id: 'race-one', player: hostId })
    send(guest, { type: 'race', race: { ...proposal(), revision: 2, phase: 'cancelled' } })
    expect(host.race()?.phase).toBe('countdown')
    update({ phase: 'cancelled', reason: 'Host cancelled' })
    expect(host.race()?.phase).toBe('cancelled')
  })

  it('preserves winner names and tag scores, retains terminal results, then enforces cooldown', () => {
    publish(proposal()); advance(5000); update({ phase: 'running', remainingMs: 120000 })
    const scores = room.snapshot().scores
    update({ phase: 'finished', winnerId: bot, participants: host.race()!.participants.map(p => p.id === bot ? { ...p, status: 'finished' } : p) })
    expect(host.race()).toMatchObject({ phase: 'finished', winnerName: 'Bot 1', remainingMs: 8000 })
    expect(room.snapshot().scores).toEqual(scores)
    expect(join('Watcher').all('welcome')[0]!.race).toMatchObject({ winnerName: 'Bot 1' })
    advance(8000); expect(host.race()).toBeNull()
    publish(proposal({ id: 'race-two' })); expect(host.race()).toBeNull()
    advance(82000); publish(proposal({ id: 'race-two' })); expect(host.race()?.phase).toBe('countdown')
  })

  it('ends a race with no winner when the server deadline passes', () => {
    publish(proposal()); advance(5000); update({ phase: 'running', remainingMs: 120000 })
    advance(120000)
    expect(host.race()).toMatchObject({ phase: 'finished', winnerId: null, reason: 'Time expired' })
  })

  it('cancels on world geometry changes, but not unrelated or unchanged settings', () => {
    publish(proposal())
    send(host, { type: 'param', id: 'laser.speed', value: 250 })
    expect(host.race()?.phase).toBe('countdown')
    send(host, { type: 'param', id: 'world.seed', value: 4242 })
    expect(host.race()).toMatchObject({ phase: 'cancelled', reason: 'World changed' })
  })

  it('cancels rather than migrating when the host disconnects', () => {
    publish(proposal()); room.disconnect(host)
    expect(guest.race()).toMatchObject({ phase: 'cancelled', reason: 'Host disconnected' })
    send(guest, { type: 'race', race: proposal({ id: 'replacement' }) })
    expect(guest.race()?.id).toBe('race-one')
  })

  it('restores an active race as cancelled with a fresh bounded result and cooldown', () => {
    publish(proposal()); const snapshot = room.snapshot()
    room = new Room('race', { now: () => clock }); room.restore(snapshot)
    const reconnect = join('Returning')
    const race = reconnect.all('welcome')[0]!.race as RaceState
    expect(race).toMatchObject({ phase: 'cancelled', reason: 'Room restarted', remainingMs: 8000 })
    expect(race.revision).toBeGreaterThan(snapshot.race!.state!.revision)
  })
})
