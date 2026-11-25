import { describe, expect, it } from 'vitest'
import { nextTwinControl, twinPopulationLabel, twinWorldCode } from '../../src/ui/galaxy/twinActions'

describe('lobby twin actions', () => {
  it('builds a private link from the selected preview recipe and seeds', () => {
    expect(twinWorldCode('alpine', 9042)).toBe('alpine.9042')
    expect(twinWorldCode('ice', 9042, 66)).toBe('ice.9042~world.nameSeed=66')
    expect(twinWorldCode('swamp', 9042, -620)).toBe('swamp.9042~world.nameSeed=-620')
  })

  it('labels a recipe total and preserves the distinction between zero and unknown', () => {
    expect(twinPopulationLabel('Alpine', { rooms: 2, players: 3 })).toBe('3 people playing Alpine')
    expect(twinPopulationLabel('Alpine', { rooms: 1, players: 1 })).toBe('1 person playing Alpine')
    expect(twinPopulationLabel('Alpine', { rooms: 0, players: 0 })).toBe('0 people playing Alpine')
    expect(twinPopulationLabel('Alpine', null)).toBe('Population unknown')
  })

  it('can reach both ends of the chooser and wraps in either direction', () => {
    expect(nextTwinControl(-1, 3, 1)).toBe(0)
    expect(nextTwinControl(-1, 3, -1)).toBe(2)
    expect(nextTwinControl(2, 3, 1)).toBe(0)
    expect(nextTwinControl(0, 3, -1)).toBe(2)
    expect(nextTwinControl(-1, 0, 1)).toBe(-1)
  })
})
