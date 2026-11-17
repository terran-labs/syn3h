/**
 * Tap to begin (src/ui/TapToBegin.ts). Bugs these catch: a line that never says how to begin
 * or says "tap" to a mouse, the same line on two loads in a row, a stored position that
 * breaks the pick, and a link into a world or an automated check being held for a tap.
 */
import { describe, expect, it } from 'vitest'
import { pickTapMessage, TAP_MESSAGE_KEY, tapLine, tapMessages } from '../../src/ui/data/tapMessages'
import { mayHold } from '../../src/ui/TapToBegin'

const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } } }

describe('tap to begin lines', () => {
  it('each says how to begin, in the words for the device, without hype', () => {
    expect(tapMessages.length).toBeGreaterThanOrEqual(12)
    for (const template of tapMessages) {
      const touch = tapLine(template, true), mouse = tapLine(template, false)
      expect(touch).toMatch(/\btap\b/i); expect(touch).not.toMatch(/click|press/i)
      expect(mouse).toMatch(/click or press a key/i); expect(mouse).not.toMatch(/\btap\b/i)
      for (const line of [touch, mouse]) { expect(line).not.toContain('!'); expect(line).not.toMatch(/[{}]/) }
    }
  })
  it('shows one line per load, a different one on each of the next loads, through the whole set', () => {
    const storage = memory(), seen: string[] = []
    for (let i = 0; i < tapMessages.length; i++) seen.push(pickTapMessage(storage, true, () => 0.5))
    expect(new Set(seen).size).toBe(tapMessages.length)
    expect(pickTapMessage(storage, true)).toBe(seen[0])
  })
  it('survives a stored value it did not write, and no storage at all', () => {
    const storage = memory(); storage.setItem(TAP_MESSAGE_KEY, 'nonsense')
    expect(tapMessages.map(t => tapLine(t, false))).toContain(pickTapMessage(storage, false))
    storage.setItem(TAP_MESSAGE_KEY, '-7')
    expect(tapMessages.map(t => tapLine(t, false))).toContain(pickTapMessage(storage, false))
    expect(tapMessages.map(t => tapLine(t, true))).toContain(pickTapMessage(undefined, true))
  })
})

describe('when a load may wait for a tap', () => {
  it('waits on a plain visit, never on a link into a world or room, and not for automated checks unless asked', () => {
    expect(mayHold('', false)).toBe(true)
    for (const search of ['?world=abc', '?room=friends', '?planet=alpine', '?seed=4', '?autoplay=1']) expect(mayHold(search, false)).toBe(false)
    expect(mayHold('', true)).toBe(false)
    expect(mayHold('?tap=1', true)).toBe(true)
    expect(mayHold('?tap=0', false)).toBe(false)
  })
})
