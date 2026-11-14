/**
 * Seeded integer hashing and gradient noise.
 *
 * Every player must build bit-identical terrain from the same seed, so this file uses only
 * operations that IEEE 754 and the ECMAScript spec pin down exactly: integer Math.imul and
 * shifts, Math.floor, Math.sqrt, + - * /. No Math.random, Math.sin, Math.pow or Math.exp,
 * whose last bits may differ between engines.
 */

/** 32-bit integer avalanche hash of two lattice coordinates and a seed. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

/** Mix a seed with a stream id so each noise layer gets independent values. */
export function subSeed(seed: number, stream: number): number {
  return hash2(seed, stream, 0x5eed) | 0
}

/** Small deterministic generator (mulberry32) for placing features. */
export function rng(seed: number): () => number {
  let a = hash2(seed, 0x1234, 0x777) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const D = 0.7071067811865476
// Eight unit gradients. A literal constant instead of Math.SQRT1_2 math keeps it obvious.
const GX = [1, -1, 0, 0, D, -D, D, -D]
const GZ = [0, 0, 1, -1, D, D, -D, -D]

/** 2D gradient (Perlin) noise, roughly in [-1, 1]. */
export function perlin(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const h00 = hash2(x0, z0, seed) & 7
  const h10 = hash2(x0 + 1, z0, seed) & 7
  const h01 = hash2(x0, z0 + 1, seed) & 7
  const h11 = hash2(x0 + 1, z0 + 1, seed) & 7
  const v00 = GX[h00] * fx + GZ[h00] * fz
  const v10 = GX[h10] * (fx - 1) + GZ[h10] * fz
  const v01 = GX[h01] * fx + GZ[h01] * (fz - 1)
  const v11 = GX[h11] * (fx - 1) + GZ[h11] * (fz - 1)
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = v00 + (v10 - v00) * u
  const b = v01 + (v11 - v01) * u
  return (a + (b - a) * v) * 1.4142135623730951
}

/** Fractal sum of `octaves` layers, normalised to roughly [-1, 1]. */
export function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += perlin(x, z, seed + o * 1013) * amp
    norm += amp
    amp *= 0.5
    // Rotate-ish offset between octaves to hide lattice alignment.
    const nx = x * 1.6 + z * 1.2
    z = z * 1.6 - x * 1.2
    x = nx
  }
  return sum / norm
}

/** Ridged fractal: sharp crests where the noise crosses zero, in [0, 1]. */
export function ridged(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let weight = 1
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(perlin(x, z, seed + o * 2029))
    n *= n
    n *= weight
    weight = n < 1 ? n : 1
    sum += n * amp
    norm += amp
    amp *= 0.5
    const nx = x * 1.6 + z * 1.2
    z = z * 1.6 - x * 1.2
    x = nx
  }
  return sum / norm
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Hermite smoothstep. Works with edge0 > edge1 for a falling edge. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
