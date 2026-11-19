/**
 * What the host's bots may use in each game (src/net/bots.ts botGameOptions). Bugs caught: a
 * bot Yoinking someone off the hill (the owner: "They should not yink me. that would be too
 * overpowered"); a bot using the Grapple, Yoink or Chaser in Tag; gear when the rate is 0.
 */
import { describe, expect, it } from 'vitest'
import { botGameOptions } from '../../src/net/bots'
import type { BotGearOption } from '../../src/bots/gear'

const ALL: BotGearOption[] = [
  { id: 'bungee', range: 120, cooldown: 0.4 }, { id: 'yoink', range: 40, cooldown: 0.8 },
  { id: 'red', range: 250, cooldown: 2.5, chargeSeconds: 0.8 }, { id: 'pester', range: 150, cooldown: 1.2 },
]

describe('bot gear by game', () => {
  it('on the hill offers the Grapple only, never Yoink, whatever the settings', () => {
    for (const grappleRate of [0.1, 0.4, 6]) for (const fireRate of [0, 5, 30]) for (const thunderShare of [0, 0.5, 1]) for (const jitter of [0.75, 1.25]) {
      const ids = botGameOptions('hill', ALL, { fireRate, grappleRate, thunderShare, lasers: true, jitter }).map(o => o.id)
      expect(ids).toEqual(['bungee'])
    }
  })
  it('in tag offers Plasma Tag and Plasma Thunder only', () => {
    for (const thunderShare of [0, 0.15, 1]) {
      const ids = botGameOptions('tag', ALL, { fireRate: 5, grappleRate: 0.4, thunderShare, lasers: true, jitter: 1 }).map(o => o.id)
      expect(ids.every(id => id === 'beam' || id === 'red')).toBe(true)
      expect(ids).toContain('beam')
    }
  })
  it('offers nothing at a rate of zero, and paces by the rate', () => {
    expect(botGameOptions('hill', ALL, { fireRate: 5, grappleRate: 0, thunderShare: 0.15, lasers: true, jitter: 1 })).toEqual([])
    expect(botGameOptions('tag', ALL, { fireRate: 0, grappleRate: 0.4, thunderShare: 0.15, lasers: true, jitter: 1 })).toEqual([])
    const beam = botGameOptions('tag', ALL, { fireRate: 6, grappleRate: 0.4, thunderShare: 0, lasers: true, jitter: 1 }).find(o => o.id === 'beam')!
    expect(beam.cooldown).toBeCloseTo(10)
  })
})
