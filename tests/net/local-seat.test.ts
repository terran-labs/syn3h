import { describe, expect, it } from 'vitest'
import { LocalSeat } from '../../src/net/LocalSeat'

interface Part { for: string; slot: number }

function make() {
  const log: string[] = []
  const registered = new Set<Part>()
  const seat = new LocalSeat<string, Part, Part>('buggy', {
    makeBounds: (v) => ({ for: v, slot: 0 }),
    makeRescue: (v) => ({ for: v, slot: 0 }),
    add: (b) => { registered.add(b); log.push(`add ${b.for}`) },
    remove: (b) => { registered.delete(b); log.push(`remove ${b.for}`) },
  })
  return { seat, log, registered }
}

describe('LocalSeat', () => {
  it('builds the guard and rescue for the first vehicle and registers the guard once', () => {
    const { seat, log } = make()
    expect(seat.bounds.for).toBe('buggy')
    expect(seat.rescue.for).toBe('buggy')
    seat.start()
    seat.start()
    expect(log).toEqual(['add buggy'])
  })

  it('rebuilds both around the new vehicle on a swap, with exactly one guard in the game', () => {
    const { seat, log, registered } = make()
    seat.start()
    const oldBounds = seat.bounds
    const oldRescue = seat.rescue
    expect(seat.swap('jet')).toBe(true)
    expect(seat.vehicle).toBe('jet')
    expect(seat.bounds).not.toBe(oldBounds)
    expect(seat.rescue).not.toBe(oldRescue)
    expect(seat.bounds.for).toBe('jet')
    expect(seat.rescue.for).toBe('jet')
    // The old guard no longer runs (it would teleport a removed vehicle), the new one does.
    expect(log).toEqual(['add buggy', 'remove buggy', 'add jet'])
    expect([...registered].map((b) => b.for)).toEqual(['jet'])
  })

  it('keeps the spawn slot the room gave us', () => {
    const { seat } = make()
    seat.start()
    seat.bounds.slot = 5
    seat.swap('tank')
    expect(seat.bounds.slot).toBe(5)
  })

  it('does nothing when handed the vehicle it already has', () => {
    const { seat, log } = make()
    seat.start()
    const bounds = seat.bounds
    expect(seat.swap('buggy')).toBe(false)
    expect(seat.bounds).toBe(bounds)
    expect(log).toEqual(['add buggy'])
  })

  it('registers nothing on a swap before the game has started, and the new guard after', () => {
    const { seat, log } = make()
    seat.swap('hovercraft')
    expect(log).toEqual([])
    seat.start()
    expect(log).toEqual(['add hovercraft'])
  })

  it('survives several swaps in a row with one guard registered', () => {
    const { seat, registered } = make()
    seat.start()
    for (const v of ['jet', 'tank', 'buggy', 'jet']) seat.swap(v)
    expect([...registered].map((b) => b.for)).toEqual(['jet'])
  })
})
