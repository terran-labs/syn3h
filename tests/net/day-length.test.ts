/** A room keeps the day length its host chose, and an old room's stopped clock is not a choice. */
import { describe, expect, it } from 'vitest'
import { Room } from '../../server/room'

const ID = 'sun.dayLength'
const restored = (params: Record<string, number>, marker: boolean) => {
  const snap = new Room('a', { now: () => 0 }).snapshot()
  snap.params = { ...snap.params, ...params }
  if (!marker) delete (snap as { days?: number }).days
  const room = new Room('b', { now: () => 0 })
  room.restore(snap)
  return room.snapshot().params
}

describe('stored day length', () => {
  it('survives a restore when the host chose it, including a stopped clock', () => {
    expect(restored({ [ID]: 900 }, true)[ID]).toBe(900)
    expect(restored({ [ID]: 0 }, true)[ID]).toBe(0)
    expect(restored({ [ID]: 900 }, false)[ID]).toBe(900)
  })
  it('is left unset, so clients use the orbit, when an old room stored the old default', () => {
    // Unset or the orbit default (-1): either way every client takes the planet's day.
    expect(restored({ [ID]: 0 }, false)[ID] ?? -1).toBe(-1)
    expect(restored({}, true)[ID] ?? -1).toBe(-1)
  })
  it('accepts the day clock anchor, a Unix time in seconds', () => {
    expect(restored({ 'sun.dayEpoch': 1_800_000_123.25 }, true)['sun.dayEpoch']).toBe(1_800_000_123.25)
  })
})
