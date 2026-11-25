import { describe, expect, it } from 'vitest'
import { nextTwinControl, twinWorldCode } from '../../src/ui/galaxy/twinActions'

describe('lobby twin actions', () => {
  it('builds a private link from the selected preview recipe and seeds', () => {
    expect(twinWorldCode('alpine', 9042)).toBe('alpine.9042')
    expect(twinWorldCode('ice', 9042, 66)).toBe('ice.9042~world.nameSeed=66')
    expect(twinWorldCode('swamp', 9042, -620)).toBe('swamp.9042~world.nameSeed=-620')
  })

  it('can reach both ends of the chooser and wraps in either direction', () => {
    expect(nextTwinControl(-1, 3, 1)).toBe(0)
    expect(nextTwinControl(-1, 3, -1)).toBe(2)
    expect(nextTwinControl(2, 3, 1)).toBe(0)
    expect(nextTwinControl(0, 3, -1)).toBe(2)
    expect(nextTwinControl(-1, 0, 1)).toBe(-1)
  })
})
