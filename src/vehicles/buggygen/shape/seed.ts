import { HANDLES, clampShape, type Handle, type Shape } from './handles'

/** mulberry32, as in LoadedBuggySkin.ts: a small deterministic generator. */
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
 * of its safe range (the mean of two draws), so random buggies are varied without every one being
 * an extreme on every axis at once.
 */
export function seedShape(seed: number): Shape {
  const r = mulberry32(seed >>> 0), s: Partial<Shape> = {}
  for (const h of HANDLES as readonly Handle[]) {
    const [lo, hi] = h.safe ?? [h.min, h.max], t = (r() + r()) / 2
    s[h.id as keyof Shape] = lo + (hi - lo) * t
  }
  return clampShape(s)
}
