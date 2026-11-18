// Lobby caption size by planet size (src/ui/galaxy/captionScale.ts). Bugs caught: far planets'
// captions drawn smaller than the original size the owner approved; the nearest ignoring the
// ceiling parameter; a caption shrinking as its planet grows (a pop while zooming in).
import { describe, expect, it } from 'vitest'
import { CAPTION_LARGE, CAPTION_SMALL, captionCeiling, captionScale } from '../../src/ui/galaxy/captionScale'

describe('captionScale', () => {
  const ceiling = captionCeiling.def.default as number
  it('keeps the original size for small, far planets and never goes under it', () => {
    for (const short of [390, 402, 900]) {
      expect(captionScale(0, short, ceiling)).toBe(1)
      expect(captionScale(CAPTION_SMALL * short, short, ceiling)).toBe(1)
    }
  })
  it('reaches the ceiling parameter for the nearest planets, and no further', () => {
    for (const top of [ceiling, 1.5, 2.5]) {
      expect(captionScale(CAPTION_LARGE * 900, 900, top)).toBeCloseTo(top, 5)
      expect(captionScale(CAPTION_LARGE * 900 * 4, 900, top)).toBeCloseTo(top, 5)
    }
    expect(captionScale(500, 900, 1)).toBe(1)
  })
  it('only grows as a planet grows on screen', () => {
    let last = 0
    for (let radius = 0; radius <= 120; radius += 0.5) {
      const scale = captionScale(radius, 844, ceiling)
      expect(scale).toBeGreaterThanOrEqual(last)
      last = scale
    }
  })
})
