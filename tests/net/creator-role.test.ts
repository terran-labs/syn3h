/**
 * The creator role (server/creator.ts): the room grants it only to a hello carrying the key
 * whose SHA-256 it was configured with, and protects reserved names from everyone else.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { isReservedName, parseReservedNames, KEY_FAILURES_PER_MINUTE } from '../../server/creator'
import { BOT_ID_BASE, PROTOCOL_VERSION, encodeState, type PlayerInfo, type ServerMessage } from '../../shared/protocol'
import { generateName, uniqueBotName } from '../../src/ui/data/names'

const emptyInput = { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false }

class FakePeer implements Peer {
  raw: string[] = []
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') { this.raw.push(data); this.json.push(JSON.parse(data)) } }
  close(): void {}
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.json.filter(m => m.type === type) as never }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined { return this.all(type).at(-1) }
}

const KEY = randomBytes(24).toString('base64url')
const HASH = createHash('sha256').update(KEY).digest('hex')
const WRONG = randomBytes(24).toString('base64url')
/** The reserved names as deployed: both Workers' configs, which must agree. */
const configured = (file: string) => /^CREATOR_RESERVED_NAMES = "([^"]*)"/m.exec(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'))![1]
const RESERVED = configured('wrangler.toml')

let clock = 0
let room: Room
let logs: string[]
function join(name: string, extra: object = {}, into = room): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  into.connect(peer)
  into.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: {}, ...extra }))
  return { peer, id: peer.last('welcome')!.id }
}
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
/** What player `id` looks like to `viewer`: its newest join, profile or welcome entry. */
function seen(viewer: FakePeer, id: number): PlayerInfo | undefined {
  let info: PlayerInfo | undefined
  for (const m of viewer.json) {
    if (m.type === 'welcome') info = m.players.find(p => p.id === id) ?? info
    if ((m.type === 'join' || m.type === 'profile') && m.player.id === id) info = m.player
  }
  return info
}

beforeEach(() => {
  clock = 100_000
  room = new Room('test', { now: () => clock, maxPlayers: 200, creatorKeySha256: HASH, reservedNames: RESERVED })
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...a) => { logs.push(a.join(' ')) })
})
afterEach(() => vi.restoreAllMocks())

describe('creator role', () => {
  // Bug: a player badges themselves by claiming the role in their own messages.
  it('ignores a role a client sends at hello or in a profile', () => {
    const a = join('Sam', { role: 'creator' }), b = join('Bob')
    expect(seen(b.peer, a.id)!.role).toBeUndefined()
    send(a.peer, { type: 'profile', role: 'creator', name: 'Sammy', player: { role: 'creator' } })
    expect(seen(b.peer, a.id)!.role).toBeUndefined()
    expect(seen(b.peer, a.id)!.name).toBe('Sammy')
  })

  // Bug: a guess is rewarded, refused or confirmed, or a frozen client cannot join.
  it('treats a wrong, malformed or absent key as no key: an ordinary join', () => {
    for (const creator of [WRONG, 'short', 42, { k: KEY }, undefined]) {
      const p = join('Sam', creator === undefined ? {} : { creator })
      const me = p.peer.last('welcome')!.players.find(x => x.id === p.id)!
      expect(me.role).toBeUndefined()
      expect(me.name).toMatch(/^Sam/)
      expect(p.peer.all('error')).toEqual([])
    }
  })

  // Bug: the owner's device proves the key but nobody sees the badge.
  it('grants the role to the right key, and everyone sees it', () => {
    const early = join('Bob')
    const c = join('Aubrey', { creator: KEY })
    const late = join('Ann')
    expect(c.peer.last('welcome')!.players.find(p => p.id === c.id)).toMatchObject({ name: 'Aubrey', role: 'creator' })
    expect(seen(early.peer, c.id)).toMatchObject({ name: 'Aubrey', role: 'creator' })
    expect(seen(late.peer, c.id)).toMatchObject({ name: 'Aubrey', role: 'creator' })
    // Bots and other players never carry it.
    expect(seen(late.peer, early.id)!.role).toBeUndefined()
  })

  // Bug: a stranger flooding wrong keys keeps the creator from being recognised.
  it('still verifies the right key after a flood of wrong ones', () => {
    for (let i = 0; i < KEY_FAILURES_PER_MINUTE * 2; i++) join('x', { creator: randomBytes(24).toString('base64url') })
    const c = join('Aubrey', { creator: KEY })
    expect(c.peer.last('welcome')!.players.find(p => p.id === c.id)!.role).toBe('creator')
  })

  // Bug: someone impersonates the creator by name, or with a lookalike of it.
  it('keeps reserved names and their lookalikes from anyone without the role', () => {
    // As deployed: the owner's one reserved name, the same on staging and production.
    expect(RESERVED).toBe('Aubrey')
    expect(configured('wrangler.staging.toml')).toBe(RESERVED)
    const lookalikes = ['Aubrey', 'aubrey', 'AUBR3Y', 'Aubr\u0435y', 'A u b r e y', '\u200bAubrey\u202e', 'Aubrey 2', 'Aubrey!!', 'Aubrey ~*~', '4ubrey', '\u0391ubrey', '\uff21\uff35\uff22\uff32\uff25\uff39', 'Aubrey \u2605', 'aubrey\ufe0f']
    for (const name of lookalikes) {
      const p = join(name)
      expect(p.peer.last('welcome')!.players.find(x => x.id === p.id)!.name, name).toBe(`Player ${p.id}`)
    }
    // Ordinary names that merely share letters pass.
    for (const name of ['Audrey', 'Aubree', 'Mira', 'Creator', 'Aubreyfan']) {
      const p = join(name)
      expect(p.peer.last('welcome')!.players.find(x => x.id === p.id)!.name).toBe(name)
    }
    // A rename is held to the same rule.
    const r = join('Bob')
    send(r.peer, { type: 'profile', name: 'AUBREY' })
    expect(seen(r.peer, r.id)!.name).toBe(`Player ${r.id}`)
    // The creator takes it.
    const c = join('Aubrey', { creator: KEY })
    expect(seen(c.peer, c.id)!.name).toBe('Aubrey')
    // A second reserved name in a list works the same.
    expect(isReservedName('M1ra-Creat0r', parseReservedNames('Aubrey, Mira Creator,'))).toBe(true)
  })

  // Bug: a bot (or a generated name) wears the creator's name, or a host makes a bot the creator.
  it('never names a bot Aubrey or gives a bot the role', () => {
    const reserved = parseReservedNames(RESERVED)
    for (let seed = 0; seed < 20000; seed++) {
      for (const name of [generateName(seed, 'bot'), uniqueBotName(seed, new Set()), generateName(seed, 'player')]) {
        if (isReservedName(name, reserved)) throw new Error(`generated ${name}`)
      }
    }
    // The room names a bot itself, from the host's state alone, and never with a role.
    const host = join('Host')
    room.receive(host.peer, encodeState({ id: BOT_ID_BASE, t: 0, p: [0, 1, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInput, bot: true }))
    const watcher = join('Ann')
    const bot = watcher.peer.last('welcome')!.players.find(p => p.id === BOT_ID_BASE)
    expect(bot).toBeDefined()
    expect(bot!.role).toBeUndefined()
    expect(isReservedName(bot!.name, reserved)).toBe(false)
  })

  // Bug: with no key configured, the reserved list blocks names for no reason.
  it('reserves nothing while no key hash is configured, and nothing for an empty list', () => {
    room = new Room('test', { now: () => clock, reservedNames: 'Aubrey' })
    expect(join('Aubrey').peer.last('welcome')!.players[0].name).toBe('Aubrey')
    expect(parseReservedNames('')).toEqual([])
    expect(isReservedName('Aubrey', parseReservedNames(' , '))).toBe(false)
  })

  // Bug: a typed star, check or crown passes for the badge.
  it('strips badge lookalikes and invisible characters from every name', () => {
    for (const [typed, clean] of [['Sam ★', 'Sam'], ['✓Sam✔', 'Sam'], ['Sam 👑', 'Sam'], ['Sam ✦⭐🌟✨', 'Sam'], ['S​a⁦m️', 'Sam'], ['Sam ✪', 'Sam'], ['Sam 🙂', 'Sam 🙂']] as const) {
      const p = join(typed)
      expect(p.peer.last('welcome')!.players.find(x => x.id === p.id)!.name).toMatch(new RegExp(`^${clean}( \\d+)?$`))
    }
  })

  // Bug: the creator loses the badge on a dropout, or a held seat passes it to someone else.
  it('survives a rejoin with the key; a held seat taken without the key loses it', () => {
    const SECRET = 'creator-resume-0123456789'
    const other = join('Bob')
    const c = join('Aubrey', { creator: KEY, resume: SECRET })
    room.disconnect(c.peer)
    clock += 1000
    const back = join('Aubrey', { creator: KEY, resume: SECRET })
    expect(back.id).toBe(c.id)
    expect(back.peer.last('welcome')!.players.find(p => p.id === c.id)).toMatchObject({ role: 'creator', name: 'Aubrey' })
    room.disconnect(back.peer)
    clock += 1000
    // Whoever holds the resume secret but not the key gets the seat, not the role or the name.
    const thief = join('Aubrey', { resume: SECRET })
    expect(thief.id).toBe(c.id)
    const now = seen(other.peer, c.id)!
    expect(now.role).toBeUndefined()
    expect(now.name).toBe(`Player ${c.id}`)
  })

  // Bug: a hibernation wake drops the badge, or a restored roster lets a forged role through.
  it('keeps the role across a hibernation wake', () => {
    let snap: ReturnType<Room['snapshot']> | undefined
    room = new Room('test', { now: () => clock, creatorKeySha256: HASH, onPersist: (s) => { snap = s } })
    const c = join('Aubrey', { creator: KEY, resume: 'creator-resume-0123456789' })
    const info = room.info(c.peer)!
    const woke = new Room('test', { now: () => clock, creatorKeySha256: HASH })
    woke.restore(snap!)
    woke.adopt(c.peer, info, 'creator-resume-0123456789')
    const n = join('Ann', {}, woke)
    expect(n.peer.last('welcome')!.players.find(p => p.id === c.id)).toMatchObject({ role: 'creator' })
    // Storage is the room's own, but a role it does not know is still dropped.
    const forged = new Room('test', { now: () => clock })
    forged.adopt(new FakePeer(), { ...info, id: 77, role: 'admin' as never })
    expect(join('Ann', {}, forged).peer.last('welcome')!.players.find(p => p.id === 77)!.role).toBeUndefined()
  })

  // Bug: the key leaks into a message to any player or into a log line.
  it('never echoes the key to any player or into the log', () => {
    const a = join('Bob')
    const c = join('Aubrey', { creator: KEY })
    send(c.peer, { type: 'chat', text: 'hello' })
    room.disconnect(c.peer)
    for (let i = 0; i < KEY_FAILURES_PER_MINUTE + 2; i++) join('x', { creator: WRONG })
    expect([...a.peer.raw, ...c.peer.raw].some(t => t.includes(KEY) || t.includes(HASH))).toBe(false)
    expect(logs.some(l => l.includes(KEY) || l.includes(WRONG) || l.includes(HASH))).toBe(false)
    expect(logs.filter(l => l.includes('creator_key_flood'))).toHaveLength(1)
  })
})
