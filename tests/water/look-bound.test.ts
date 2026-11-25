/**
 * The sea's look stays a look. Its visual-only vertex detail (surface.ts detailHeight, CPU twin
 * visualDetailHeight) must never move the drawn sea more than VISUAL_DETAIL_MAX from the surface
 * vehicles float and skip on, at any slider setting, and must never produce a non-finite height.
 * Bug caught: a chop or wave-visibility slider at its maximum lifting the drawn water away from
 * where the physics floats things, so a hull sinks into or hovers over the water you see.
 */
import { describe, expect, it } from 'vitest'
import { VISUAL_DETAIL_MAX, visualDetailHeight } from '../../src/world/water/surface'

describe('sea look', () => {
  it('keeps the visual detail within its bound of the physical surface, finite everywhere', () => {
    let seed = 7
    const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    let largest = 0
    for (let i = 0; i < 20000; i++) {
      const x = (r() - 0.5) * 8192, z = (r() - 0.5) * 8192, t = r() * 1e5
      // Sliders past their range and the wind at a gale: the bound must hold regardless.
      const h = visualDetailHeight(x, z, t, r() * 2 - 1, r() * 2 - 1, r() * 10, r() * 2 - 0.5, r() * 2 - 0.5)
      expect(Number.isFinite(h)).toBe(true)
      largest = Math.max(largest, Math.abs(h))
    }
    expect(largest).toBeLessThanOrEqual(VISUAL_DETAIL_MAX + 1e-9)
    expect(Number.isFinite(visualDetailHeight(0, 0, 0, 0, 0, Number.NaN, Number.NaN, Number.NaN))).toBe(true)
  })
})
