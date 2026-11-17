import { HANDLES, clampShape, type Shape } from './handles'

/** mulberry32, as in the buggy skin: a small deterministic generator. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One integer to an in-range shape. Each handle is drawn from a curve that favours the middle
 * of its range (the mean of two draws), so random buggies are varied without every one being
 * an extreme on all fifteen axes at once.
 */
export function seedShape(seed: number): Shape {
  const r = mulberry32(seed >>> 0), s: Partial<Shape> = {}
  for (const h of HANDLES) { const t = (r() + r()) / 2; s[h.id] = h.min + (h.max - h.min) * t }
  return clampShape(s)
}
