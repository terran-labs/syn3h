import { describe, expect, it } from 'vitest'
import { OPENING_SECONDS, openingState, SETTLED } from '../../src/ui/galaxy/opening'

describe('lobby opening timeline', () => {
  it('starts at a point, ends at the settled lobby, and brings the worlds in from the innermost out', () => {
    for (const mode of [1, 2] as const) {
      const first = openingState(-1, mode, 9)
      expect(first.sun).toBe(0); expect(first.front).toBe(0); expect(first.arrive.every(a => a === 0)).toBe(true); expect(first.mark).toBe(0)
      const end = openingState(OPENING_SECONDS, mode, 9)
      expect(end.done).toBe(true); expect(end.reach).toBeCloseTo(1, 6); expect(end.sun).toBeCloseTo(1, 6); expect(end.mark).toBe(1)
      expect(end.arrive.every(a => a === 1)).toBe(true); expect(end.labels.every(Boolean)).toBe(true); expect(end.chrome).toBe(1)
      for (let t = 0; t <= OPENING_SECONDS; t += 0.05) {
        const s = openingState(t, mode, 9)
        for (const v of [s.sun, s.front, s.stars, s.orbits, s.markFront, s.mark, s.reach, ...s.arrive]) expect(Number.isFinite(v)).toBe(true)
        for (let lane = 1; lane < 9; lane++) expect(s.arrive[lane]).toBeLessThanOrEqual(s.arrive[lane - 1])
        // A label never shows before its world has arrived, and the outermost comes last.
        for (let lane = 0; lane < 9; lane++) { if (s.labels[lane]) expect(s.arrive[lane]).toBe(1); if (lane && s.labels[lane]) expect(s.labels[lane - 1]).toBe(true) }
      }
    }
    expect(SETTLED.done).toBe(true)
  })
})
