/**
 * Bots are shown by one given name (the owner, 16 November 2026). Their role stays as hidden
 * character data, so each keeps the voice it had, and nothing they say addresses a bot by role.
 */
import { describe, expect, it } from 'vitest'
import { BanterDirector, identityOf, type BanterBot, type BanterPlayer } from '../../src/bots/banter/Director'
import { voiceFor } from '../../src/bots/banter/voices'
import { botIdentity, generateName, isBlockedName, MAX_GIVEN_NAME, uniqueBotName } from '../../src/ui/data/names'

/** How the room's bots are named on a client: lowest id first, each avoiding those before it. */
function nameRoom(seed: number, people: string[], count = 12): string[] {
  const taken = new Set(people.map(p => p.toLowerCase())), names: string[] = []
  for (let i = 0; i < count; i++) { const n = uniqueBotName(`${seed}:${0xff00 + i}`, taken); names.push(n); taken.add(n.toLowerCase()) }
  return names
}

describe('bot names', () => {
  it('a bot is shown by one word within the cap that passes the blocklist', () => {
    for (let i = 0; i < 20000; i++) {
      const name = generateName(`b:${i}`, 'bot')
      expect(name).toMatch(/^[A-Z][a-z]+$/)
      expect(name.length).toBeLessThanOrEqual(MAX_GIVEN_NAME)
      expect(isBlockedName(name)).toBe(false)
    }
  })
  // Two players seeing two names for one bot would be a bug they report.
  it('two clients name the same room identically, and every name in a room of 12 is different', () => {
    for (let seed = 1; seed < 300; seed++) {
      const people = ['Sam', generateName(`${seed}:${0xff03}`, 'bot')] // a person who took a bot's name
      const one = nameRoom(seed, people), two = nameRoom(seed, [...people])
      expect(two).toEqual(one)
      const all = [...people, ...one].map(n => n.toLowerCase())
      expect(new Set(all).size).toBe(all.length)
    }
  })
  // The voice comes from the role, generated as before: the same bot keeps the same character.
  it('the hidden role is the old name\'s role, so each bot keeps its voice', () => {
    for (let i = 0; i < 2000; i++) {
      const { name, role } = botIdentity(`v:${i}`)
      expect(role.length).toBeGreaterThan(2)
      expect(`${name} ${role}`.length).toBeLessThanOrEqual(24)
      expect(voiceFor(identityOf({ name, role }))).toBe(voiceFor(`${name} ${role}`))
    }
  })
  it('no line names a bot by its role, and the speaker is one name', () => {
    let now = 0
    const roles = ['Dust Clerk', 'Rust Auditor', 'Cone Marshal', 'Hull Intern', 'Spare Pilot', 'Junior Moon']
    const bots: BanterBot[] = roles.map((role, i) => ({
      id: 0xff00 + i, name: generateName(`talk:${i}`, 'bot'), role, x: i * 50, y: 10, z: 0, speed: 5, activity: 'road', caption: 'cruising the road',
      stuckFor: 0, flippedFor: 0, bogFor: 0, airFor: 0, resets: 0, nearLava: false, sight: null,
    }))
    const players: BanterPlayer[] = [{ id: 1, name: 'Sam', x: 0, y: 10, z: 10, speed: 6, airFor: 0, idleFor: 0, kind: 'buggy', flippedFor: 0, stuckFor: 0 }]
    const said: string[] = [], speakers: string[] = []
    const director = new BanterDirector(
      { now: () => now, bots: () => bots, players: () => players, hour: () => 12, planet: () => 'volcanic', sea: () => 'lava' as const, cloudy: () => false, feature: () => ({ kind: 'vent', phrase: 'the lava vent' }) },
      { say: (_bot: number, text: string) => said.push(text), direct: () => true, allows: () => true },
      { seed: 'names', onLine: (_bot: number, name: string) => speakers.push(name) },
    )
    for (let t = 0; t < 3600; t++) { now += 1; if (t % 600 === 300) bots[t % bots.length].stuckFor = 20; director.tick() }
    expect(said.length).toBeGreaterThan(30)
    for (const b of bots) for (const line of said) expect(line).not.toContain(`${b.name} ${b.role}`)
    expect(speakers.length).toBeGreaterThan(30)
    for (const s of speakers) expect(s).toMatch(/^[A-Z][a-z]+$/)
  })
})
