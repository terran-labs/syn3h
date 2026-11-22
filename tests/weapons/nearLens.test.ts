// A Thunder burst seen from across the map is the flare the owner asked for: drawing bursts down
// near the camera (so one on your own car does not white out the view) must never dim a far one,
// nor the vehicle hits made to read at 15 to 40 m.
import { describe, expect, it } from 'vitest'
import { NEAR_FULL, NEAR_HIT, NEAR_MIN, nearLens } from '../../src/weapons/impact/nearLens'

describe('nearLens', () => {
  it('leaves anything at or beyond its range at full strength', () => {
    for (const d of [NEAR_FULL, 40, 800, 5000]) expect(nearLens(d)).toBe(1)
    for (const d of [NEAR_HIT, 15, 40]) expect(nearLens(d, NEAR_HIT)).toBe(1)
  })
  it('draws less the closer it is, never below the floor', () => {
    expect(nearLens(6)).toBeLessThan(nearLens(12))
    expect(nearLens(0)).toBe(NEAR_MIN)
    expect(nearLens(-1)).toBe(NEAR_MIN)
  })
})
