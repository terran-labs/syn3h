import { describe, expect, it } from 'vitest'
import { wingVertex } from '../../src/vehicles/skins/LoadedBuggySkin'

describe('original wing deformation', () => {
  it('collapses width and height while preserving length', () => {
    expect(wingVertex(3, .2, 1, 0, 0, 0)).toEqual([0, 0, 1])
    expect(wingVertex(3, .2, 1, .5, 0, 0)).toEqual([1.5, .1, 1])
    expect(wingVertex(3, .2, 1, 1, 0, 0)).toEqual([3, .2, 1])
  })
  it('flexes opposite sides with pitch and does not steer the leading edge', () => {
    expect(wingVertex(3, 0, 1, 1, 0, 1)[1]).toBeLessThan(0)
    expect(wingVertex(-3, 0, 1, 1, 0, 1)[1]).toBeLessThan(0)
    expect(wingVertex(3, 0, -1, 1, 1, 0)).toEqual([3, 0, -1])
    expect(wingVertex(3, 0, 1, 1, 1, 0)[1]).toBeGreaterThan(0)
  })
})
