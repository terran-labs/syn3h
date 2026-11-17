import type * as THREE from 'three/webgpu'

/**
 * A body's surface as a flat list of triangles, for fittings that must sit on it: rays and
 * nearest point queries, brute force over a pre-filtered neighbourhood. The body has a few
 * thousand triangles and a fitting asks a few dozen questions, so no tree is needed.
 */
export type V3 = [number, number, number]
export interface Hit { point: V3; normal: V3 }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

export class Surface {
  /** Nine floats a triangle. */
  constructor(readonly tris: Float32Array) {}

  static from(geometries: THREE.BufferGeometry[]): Surface {
    let n = 0
    for (const g of geometries) n += (g.index ? g.index.count : g.attributes.position.count) / 3
    const out = new Float32Array(n * 9)
    let o = 0
    for (const g of geometries) {
      const p = g.attributes.position, idx = g.index
      const count = idx ? idx.count : p.count
      for (let k = 0; k < count; k++) { const i = idx ? idx.getX(k) : k; out[o++] = p.getX(i); out[o++] = p.getY(i); out[o++] = p.getZ(i) }
    }
    return new Surface(out)
  }

  /** The triangles with any corner within `r` of `c`. */
  near(c: V3, r: number): Surface {
    const keep: number[] = [], r2 = r * r, t = this.tris
    for (let i = 0; i < t.length; i += 9) for (let k = 0; k < 9; k += 3) {
      if ((t[i + k] - c[0]) ** 2 + (t[i + k + 1] - c[1]) ** 2 + (t[i + k + 2] - c[2]) ** 2 < r2) { for (let j = 0; j < 9; j++) keep.push(t[i + j]); break }
    }
    return new Surface(new Float32Array(keep))
  }

  private tri(i: number): [V3, V3, V3] {
    const t = this.tris
    return [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]]
  }

  /** First crossing of the ray o + s d, 0 <= s <= max, either face (Moller and Trumbore). */
  ray(o: V3, d: V3, max = Infinity): Hit | undefined {
    let best = max, hit: Hit | undefined
    for (let i = 0; i < this.tris.length; i += 9) {
      const [a, b, c] = this.tri(i), e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p)
      if (Math.abs(det) < 1e-12) continue
      const tv = sub(o, a), u = dot(tv, p) / det
      if (u < 0 || u > 1) continue
      const q = cross(tv, e1), v = dot(d, q) / det
      if (v < 0 || u + v > 1) continue
      const s = dot(e2, q) / det
      if (s >= 0 && s < best) { best = s; hit = { point: [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s], normal: unit(cross(e1, e2)) } }
    }
    return hit
  }

  /** Nearest point on the surface, with its face normal (Ericson, Real-Time Collision Detection 5.1.5). */
  nearest(p: V3): Hit | undefined {
    let best = Infinity, hit: Hit | undefined
    for (let i = 0; i < this.tris.length; i += 9) {
      const [a, b, c] = this.tri(i), q = closest(p, a, b, c), d = sub(p, q), d2 = dot(d, d)
      if (d2 < best) { best = d2; hit = { point: q, normal: unit(cross(sub(b, a), sub(c, a))) } }
    }
    return hit
  }
}

function closest(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return a
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return b
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v] }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return c
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w] }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w] }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]
}
