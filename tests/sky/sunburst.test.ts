// The sunburst moves the low sun's glow into bright streaks and out of dark ones. Bug this
// catches: a pattern whose average is not 1, which would brighten or darken the whole sunrise
// instead of only striping it, or one that goes negative or non-finite.
import { describe, expect, it } from 'vitest'
import { sunburstPatternCpu } from '../../src/fx/post/sunburst'

describe('sunburst pattern', () => {
  for (const octaves of [2, 3] as const) {
    it(`averages 1 round the sun over time, and stays finite and non-negative (${octaves} octaves)`, () => {
      for (const phase of [0, 17.3, 41.9]) {
        let sum = 0, n = 0
        for (let t = 1000; t < 7000; t += 73) for (let a = 0; a < 180; a++) {
          const angle = (a / 180) * Math.PI * 2
          const v = sunburstPatternCpu(Math.cos(angle), Math.sin(angle), t, phase, octaves)
          expect(Number.isFinite(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
          sum += v; n++
        }
        expect(sum / n).toBeGreaterThan(0.85)
        expect(sum / n).toBeLessThan(1.15)
      }
    })
  }
})
