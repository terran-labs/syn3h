// The bug these catch: a lobby sheet whose bent edges leave the screen, cover the X, or turn
// into NaN and draw nothing, for any wordmark the galaxy might report.
import { describe, expect, it } from 'vitest'
import { at, bendPanel, bendPath, fitParabola, sheetShape, type Point } from '../../src/ui/LobbySheet'

const arc = (y: number, c: number, from = 430, to = 1030): Point[] => Array.from({ length: 9 }, (_, i) => { const x = from + (to - from) * i / 8, u = x - (from + to) / 2; return [x, y + c * u * u] })

describe('lobby sheet shape', () => {
  it('fits a parabola exactly', () => {
    const p = fitParabola(arc(300, 0.0002))
    expect(at(p, 730)).toBeCloseTo(300, 6); expect(p.c).toBeCloseTo(0.0002, 9)
  })

  const frames = [{ left: 220, top: 320, width: 1000, height: 556 }, { left: 8, top: 118, width: 374, height: 718 }]
  const wordmarks = [null, { top: arc(160, 0.0003), bottom: arc(300, 0.0002) }, { top: arc(160, -0.001), bottom: arc(300, 0.002) }, { top: arc(300, 0), bottom: arc(300, 0) }]
  it('stays inside its frame with both edges finite, for any wordmark', () => {
    for (const frame of frames) for (const edges of wordmarks) for (const parallel of [false, true]) {
      const bend = bendPanel(frame, edges, parallel)
      expect(bend.box.top).toBeGreaterThanOrEqual(frame.top - 0.5)
      expect(bend.box.top + bend.box.height).toBeLessThanOrEqual(frame.top + frame.height + 0.5)
      expect(bend.insetTop + bend.insetBottom).toBeLessThan(bend.box.height / 2)
      expect(bendPath(bend)).not.toMatch(/NaN|Infinity/)
    }
  })

  it('is bent unless the address asks for a comparison', () => {
    expect(sheetShape('')).toBe('bent'); expect(sheetShape('?sheet=round')).toBe('round'); expect(sheetShape('?sheet=parallel')).toBe('parallel'); expect(sheetShape('?sheet=x')).toBe('bent')
  })
})
