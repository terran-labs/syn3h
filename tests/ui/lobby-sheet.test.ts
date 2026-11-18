// The bug this catches: the sheet's corners sized from a wordmark fit that has gone wrong
// (NaN or far off), so the panel's rounding jumps or vanishes.
import { describe, expect, it } from 'vitest'
import { at, fitParabola, type Point } from '../../src/ui/LobbySheet'

const arc = (y: number, c: number, from = 430, to = 1030): Point[] => Array.from({ length: 9 }, (_, i) => { const x = from + (to - from) * i / 8, u = x - (from + to) / 2; return [x, y + c * u * u] })

describe('lobby sheet', () => {
  it('fits the wordmark lines exactly, flat ones included', () => {
    const p = fitParabola(arc(300, 0.0002))
    expect(at(p, 730)).toBeCloseTo(300, 6); expect(p.c).toBeCloseTo(0.0002, 9)
    const flat = fitParabola(arc(120, 0))
    expect(at(flat, 500)).toBeCloseTo(120, 6)
  })
})
