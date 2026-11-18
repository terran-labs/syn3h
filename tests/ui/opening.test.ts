import { describe, expect, it } from 'vitest'
import { FIRST, FLIGHT, GAP, OPENING_SECONDS, openingState, POP_SECONDS, SETTLED, SETTLED_SECONDS } from '../../src/ui/galaxy/opening'

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
        for (const v of [s.swell, s.sun, s.front, s.stars, s.markFront, s.mark, s.reach, ...s.orbits, ...s.arrive]) expect(Number.isFinite(v)).toBe(true)
        // Each world's orbit line is drawn ahead of it.
        for (let lane = 0; lane < 9; lane++) if (s.arrive[lane] > 0) expect(s.orbits[lane]).toBeGreaterThan(0)
        for (let lane = 1; lane < 9; lane++) expect(s.arrive[lane]).toBeLessThanOrEqual(s.arrive[lane - 1])
        // A label never shows before its world has arrived, and the outermost comes last.
        for (let lane = 0; lane < 9; lane++) { if (s.labels[lane]) expect(s.arrive[lane]).toBe(1); if (lane && s.labels[lane]) expect(s.labels[lane - 1]).toBe(true) }
      }
    }
    expect(SETTLED.done).toBe(true)
    // The bang has settled by SETTLED_SECONDS: every world exactly in its place, the stars where
    // they rest, the sun itself; only the name's fade runs on.
    const settled = openingState(SETTLED_SECONDS, 2, 9)
    expect(settled.fling.every(f => f === 1)).toBe(true); expect(settled.spread).toBe(1)
    expect(settled.sun).toBeCloseTo(1, 6); expect(settled.reach).toBeCloseTo(1, 6); expect(settled.chrome).toBe(1)
    expect(settled.burst[1]).toBe(0)
  })
  // The score's drop is scheduled at POP_SECONDS (src/ui/TapToBegin.ts): the sun must not
  // appear before it, and must be showing just after it, or picture and sound part.
  it('pops exactly when the score drops', () => {
    expect(openingState(POP_SECONDS - 0.02, 2, 9).sun).toBe(0)
    expect(openingState(POP_SECONDS + 0.05, 2, 9).sun).toBeGreaterThan(0)
  })
  // The owner: the name arrives last. It is still arriving after the last world has landed.
  it('brings the name in last', () => {
    const landed = FIRST + GAP * 8 + FLIGHT
    expect(openingState(landed, 2, 9).mark).toBeLessThan(1)
    expect(openingState(OPENING_SECONDS, 2, 9).mark).toBe(1)
  })
})
