/**
 * A bot's name never depends on whether it is in the roster: a toast, scoreboard row or chat
 * line about a bot that has just left still names it. "Player N" is only for a person.
 */
import { describe, expect, it } from 'vitest'
import { NetClient } from '../../src/net'
import { generateName } from '../../src/ui/data/names'
import { BOT_ID_BASE } from '../../shared/protocol'
import { worldSeed } from '../../shared/params'

function client(roster: { id: number; name: string; bot?: boolean }[], names = (seed: string, kind: 'bot' | 'player' | 'world') => generateName(seed, kind)) {
  const net = Object.create(NetClient.prototype) as NetClient
  Object.assign(net, { ctx: { names }, players: new Map(roster.map(p => [p.id, p])), botNames: new Map(), botNamesKey: '', botNamesTaken: new Set() })
  return net
}
const own = (id: number) => generateName(`${worldSeed.value}:${id}`, 'bot')

describe('bot display names', () => {
  it('a bot absent from the roster is named by its first name, never "Player"', () => {
    const net = client([{ id: 1, name: 'Sam' }])
    for (let i = 0; i < 12; i++) {
      const name = net.displayName(BOT_ID_BASE + i)
      expect(name).not.toMatch(/^Player/)
      expect(name).toMatch(/^[A-Z][a-z]+$/)
    }
    expect(net.displayName(BOT_ID_BASE)).toBe(own(BOT_ID_BASE))
  })
  it('a bot keeps its name when it leaves the roster', () => {
    const bot = { id: BOT_ID_BASE + 2, name: 'Bot 3', bot: true }
    const before = client([{ id: 1, name: 'Sam' }, bot]).displayName(bot.id)
    expect(client([{ id: 1, name: 'Sam' }]).displayName(bot.id)).toBe(before)
  })
  it('an injected namer is the one used, present or absent', () => {
    const net = client([{ id: 1, name: 'Sam' }, { id: BOT_ID_BASE, name: 'Bot 1', bot: true }], (seed, kind) => `${kind}-${seed}`)
    expect(net.displayName(BOT_ID_BASE)).toBe(`bot-${worldSeed.value}:${BOT_ID_BASE}`)
    expect(net.displayName(BOT_ID_BASE + 5)).toBe(`bot-${worldSeed.value}:${BOT_ID_BASE + 5}`)
  })
  it('a person with no name in the roster is "Player N"; a person with one keeps it', () => {
    const net = client([{ id: 1, name: 'Sam' }])
    expect(net.displayName(1)).toBe('Sam')
    expect(net.displayName(7)).toBe('Player 7')
  })
})
