import { describe, expect, it } from 'vitest'
import { BLOCKED, generateName, isBlockedName, MAX_GIVEN_NAME, MAX_NAME } from '../../src/ui/data/names'

describe('generated names', () => {
  // Bots are named by every client from the world seed and the bot id; a name that differed
  // between two clients would show two names for one bot.
  it('the same seed gives the same name, and kinds stay separate', () => {
    for (let i = 0; i < 500; i++) for (const kind of ['player', 'bot', 'world'] as const) expect(generateName(`room:12:${i}`, kind)).toBe(generateName(`room:12:${i}`, kind))
    expect(generateName(123, 'player')).not.toBe(generateName(123, 'world'))
  })
  // A name too long for a name plate would be cut off, and a strange character could break a label.
  it('fits the interface and reads as plain words', () => {
    for (let i = 0; i < 20000; i++) {
      const person = generateName(i, 'player'), bot = generateName(i, 'bot'), world = generateName(i, 'world')
      expect(person.length).toBeLessThanOrEqual(MAX_GIVEN_NAME); expect(person.length).toBeGreaterThanOrEqual(3)
      expect(person).toMatch(/^[A-Z][a-z]+$/)
      expect(bot.length).toBeLessThanOrEqual(MAX_NAME); expect(world.length).toBeLessThanOrEqual(MAX_NAME)
      // A bot is shown by one given name; its role is hidden (botIdentity).
      expect(bot).toMatch(/^[A-Z][a-z]+$/); expect(bot.length).toBeLessThanOrEqual(MAX_GIVEN_NAME)
    }
  })
  // An unkind accidental word on a stranger's name plate is a bug a player would report.
  // These two walk the whole name space: at load 25 to 40 (18 Nov) they took 6 s against a 5 s default.
  it('never spells a blocked word', () => {
    const hits: string[] = []
    for (let i = 0; i < 30000; i++) for (const kind of ['player', 'bot', 'world'] as const) { const name = generateName(`b:${i}`, kind); if (isBlockedName(name)) hits.push(name) }
    expect(hits).toEqual([])
  }, 20000)
  it('the blocklist catches words hidden across a space and in any case', () => {
    expect(isBlockedName('Kil Lantern')).toBe(true)
    expect(isBlockedName('SHOTwick')).toBe(true)
    expect(isBlockedName('Zibwick Dust Clerk')).toBe(false)
    expect(BLOCKED.every(word => word === word.toLowerCase())).toBe(true)
  })
  // A small vocabulary repeats in a busy room and gets dull: two bots with one name.
  it('has a large space of names', () => {
    const people = new Set<string>(), bots = new Set<string>()
    for (let i = 0; i < 50000; i++) { people.add(generateName(`d:${i}`, 'player')); bots.add(generateName(`d:${i}`, 'bot')) }
    expect(people.size).toBeGreaterThan(25000)
    expect(bots.size).toBeGreaterThan(25000)
  }, 20000)
})
