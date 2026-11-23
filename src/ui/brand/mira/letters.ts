/**
 * Letters for the Mira candidates, built like the Syn3h wordmark: heavy, wide, geometric,
 * outer corners cut at 45 degrees (or rounded, for the soft family). Each letter is drawn
 * with its left edge at x = 0 on the baseline y = 178 and returns its advance width.
 *
 * `k` is the outer corner: negative a chamfer length, positive a round radius, 0 sharp.
 */
import { type Contour, meet, offsetLine, type P, shape } from './geom'

export const CAP = 178
export interface Glyph { contours: Contour[]; width: number }
export interface CapStyle { s: number; k: number }

/** M with a flat top and three legs: the Syn3h N's construction. */
export function mFlat({ s, k }: CapStyle, W = 232, inner = 0): Glyph {
  const t = s, h = s / 2
  return { width: W, contours: [shape([
    [0, CAP], [0, 0, k], [W, 0, k], [W, CAP], [W - s, CAP], [W - s, t, inner], [W / 2 + h, t, inner], [W / 2 + h, CAP],
    [W / 2 - h, CAP], [W / 2 - h, t, inner], [s, t, inner], [s, CAP],
  ])] }
}

/** M with upright stems and a V meeting at `vy`, its point cut flat. */
export function mPointed({ s, k }: CapStyle, W = 250, vy = 128, d = s * 1.05): Glyph {
  const L1: P = [s * 0.95, 0], C: P = [W / 2, vy]
  const [l1, l2] = offsetLine(L1, C, d)
  const yi = meet(l1, l2, [s, 0], [s, CAP])[1]
  const bottom = meet(l1, l2, [W / 2, 0], [W / 2, CAP])[1]
  const flat = 10
  const mid = (x: number): P => meet(L1, C, [x, 0], [x, CAP])
  return { width: W, contours: [shape([
    [0, CAP], [0, 0, k], [L1[0], 0], [W / 2 - flat, mid(W / 2 - flat)[1]], [W / 2 + flat, mid(W / 2 - flat)[1]], [W - L1[0], 0], [W, 0, k], [W, CAP],
    [W - s, CAP], [W - s, yi], [W / 2, Math.min(bottom, CAP)], [s, yi], [s, CAP],
  ])] }
}

export function iCap({ s }: CapStyle): Glyph { return { width: s, contours: [shape([[0, CAP], [0, 0], [s, 0], [s, CAP]])] } }

/** R: bowl of two bars, a notch, and a 45 degree leg. */
export function rCap({ s, k }: CapStyle, W = 206): Glyph {
  const barTop = s, midTop = 75, midBottom = midTop + s, legRun = CAP - midBottom, legW = s * 1.2
  const cb = Math.abs(k) * 1.1
  const notch = Math.min(legRun, cb + 22)
  return { width: W, contours: [
    shape([
      [0, CAP], [0, 0], [W, 0, k], [W, midBottom - cb], [W - cb, midBottom], [W - notch, midBottom], [W, CAP], [W - legW, CAP],
      [W - notch - legW, midBottom], [s, midBottom], [s, CAP],
    ]),
    shape([[s, barTop], [W - s, barTop], [W - s, midTop], [s, midTop]]),
  ] }
}

/** A without its crossbar, flat at the apex. `bar` adds a crossbar at that height instead. */
export function aLambda({ s, k }: CapStyle, W = 222, bar?: number): Glyph {
  const f = s * 1.1, legW = s * 1.18
  const L0: P = [0, CAP], L1: P = [W / 2 - f / 2, 0], R0: P = [W, CAP], R1: P = [W / 2 + f / 2, 0]
  const iL0: P = [legW, CAP], iL1: P = [L1[0] + legW, 0], iR0: P = [W - legW, CAP], iR1: P = [R1[0] - legW, 0]
  const apex = meet(iL0, iL1, iR0, iR1)
  const top = k < 0 ? -k * 0.6 : k * 0.6
  if (bar === undefined) return { width: W, contours: [shape([L0, [L1[0], L1[1], -top], [R1[0], R1[1], -top], R0, iR0, apex, iL0])] }
  const bb = bar + s * 0.8
  const atL = (y: number) => meet(iL0, iL1, [0, y], [W, y]), atR = (y: number) => meet(iR0, iR1, [0, y], [W, y])
  return { width: W, contours: [
    shape([L0, [L1[0], L1[1], -top], [R1[0], R1[1], -top], R0, iR0, atR(bb), atL(bb), iL0]),
    shape([apex, atR(bar), atL(bar)]),
  ] }
}

// Lowercase: x-height 120, the same weight family, rounder.
export const XT = CAP - 120
export interface LowStyle { s: number; r: number }

export function mLow({ s, r }: LowStyle, W = 236): Glyph {
  const gap = (W - 3 * s) / 2, ri = gap / 2 - 0.5
  return { width: W, contours: [shape([
    [0, CAP], [0, XT, r * 0.35], [W, XT, Math.min(ri + s, r)], [W, CAP], [W - s, CAP], [W - s, XT + s, ri], [W / 2 + s / 2, XT + s, ri], [W / 2 + s / 2, CAP],
    [W / 2 - s / 2, CAP], [W / 2 - s / 2, XT + s, ri], [s, XT + s, ri], [s, CAP],
  ])] }
}
export function iLow({ s }: LowStyle): Glyph { return { width: s, contours: [shape([[0, CAP], [0, XT], [s, XT], [s, CAP]])] } }
export function rLow({ s, r }: LowStyle, W = 128): Glyph {
  return { width: W, contours: [shape([[0, CAP], [0, XT, r * 0.35], [W, XT], [W, XT + s], [s, XT + s, Math.min(r, 26)], [s, CAP]])] }
}
export function aLow({ s, r }: LowStyle, W = 160): Glyph {
  const R = Math.min(r * 1.5, 60), h = CAP - XT
  return { width: W, contours: [
    shape([[0, XT, R], [W, XT], [W, CAP], [0, CAP, R]]),
    shape([[s, XT + s, Math.max(1, R - s)], [W - s, XT + s], [W - s, CAP - s], [s, CAP - s, Math.max(1, R - s)]]),
  ].map(c => c), ...(h ? {} : {}) }
}

/** Lays glyphs out left to right with `gap` between them. */
export function set(glyphs: Glyph[], gap: number): { contours: Contour[]; width: number; starts: number[] } {
  let x = 0
  const contours: Contour[] = [], starts: number[] = []
  for (const g of glyphs) { starts.push(x); for (const c of g.contours) contours.push(c.map(([px, py]): P => [px + x, py])); x += g.width + gap }
  return { contours, width: x - gap, starts }
}
