import * as THREE from 'three'

/**
 * A small mesh kit for the buggy's mechanical parts: lens sections lofted along a span, round
 * bars, helices, lathes and fans. Everything is built as indexed triangles in a working frame
 * and converted to the part's frame once at the end (see `toGame` and `toOwn`).
 *
 * The working frame is the one tools/buggy-bodies/build.py used when the parts were first
 * designed in Blender: X right (or chord), Y back (or up, for a strut), Z up (or span).
 */
export type V3 = [number, number, number]

export class Mesh {
  readonly p: number[] = []
  readonly i: number[] = []
  /** Start of the current closed piece, for winding repair. */
  private start = 0
  vert(x: number, y: number, z: number): number { this.p.push(x, y, z); return this.p.length / 3 - 1 }
  vec(v: V3): number { return this.vert(v[0], v[1], v[2]) }
  tri(a: number, b: number, c: number): void { this.i.push(a, b, c) }
  quad(a: number, b: number, c: number, d: number): void { this.i.push(a, b, c, a, c, d) }
  /** A convex polygon as a fan. */
  poly(ring: number[], reverse = false): void {
    const r = reverse ? [...ring].reverse() : ring
    for (let k = 1; k < r.length - 1; k++) this.tri(r[0], r[k], r[k + 1])
  }
  /** Quads between two rings of equal length, closed round. */
  skin(a: number[], b: number[], closed = true): void {
    const n = a.length
    for (let k = 0; k < (closed ? n : n - 1); k++) this.quad(a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])
  }
  /**
   * Mark the end of a closed solid begun at the last `begin`: if its signed volume is negative
   * the faces point in, so turn them all over. Open shells must not use this.
   */
  begin(): void { this.start = this.i.length }
  closeSolid(): void {
    let vol = 0
    const p = this.p
    for (let t = this.start; t < this.i.length; t += 3) {
      const a = this.i[t] * 3, b = this.i[t + 1] * 3, c = this.i[t + 2] * 3
      vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
    }
    if (vol < 0) this.flip(this.start)
  }
  flip(from = 0, to = this.i.length): void {
    for (let t = from; t < to; t += 3) { const s = this.i[t + 1]; this.i[t + 1] = this.i[t + 2]; this.i[t + 2] = s }
  }
  get triangles(): number { return this.i.length / 3 }
  /** Positions mapped through `f`, as a three.js geometry with smooth normals. */
  geometry(f: (x: number, y: number, z: number) => V3 = (x, y, z) => [x, y, z], flip = false): THREE.BufferGeometry {
    const out = new Float32Array(this.p.length)
    for (let k = 0; k < this.p.length; k += 3) out.set(f(this.p[k], this.p[k + 1], this.p[k + 2]), k)
    const idx = this.i.slice()
    if (flip) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(out, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }
}

/** Blender's frame (Z up, nose at -Y) to the game's, after build.py's export half turn. */
export const toGame = (x: number, y: number, z: number): V3 => [-x, z, y]
/** A part kept in its own frame (strut, shock): Blender to glTF's Y up, no turn. */
export const toOwn = (x: number, y: number, z: number): V3 => [x, z, -y]

const sgnpow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e

/** One section station: span position, chord, thickness, chord offset, up offset. */
export type Station = [number, number, number, number, number]

/**
 * A lens shaped section (`n` points, flattened top and bottom by |sin|^0.8) lofted through
 * stations along +Z, capped at both ends: the box arm, its rib and the hub boss.
 */
export function lensLoft(m: Mesh, stations: Station[], n = 8, cap = true): void {
  m.begin()
  const rings = stations.map(([z, c, th, ox, oy]) => Array.from({ length: n }, (_, k) => {
    const a = 2 * Math.PI * k / n
    return m.vert(ox + c / 2 * Math.cos(a), oy + th / 2 * sgnpow(Math.sin(a), .8), z)
  }))
  for (let j = 0; j + 1 < rings.length; j++) m.skin(rings[j], rings[j + 1])
  if (cap) { m.poly(rings[0], true); m.poly(rings[rings.length - 1]) }
  m.closeSolid()
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** A capped round bar from p0 to p1 with `n` sides. */
export function tube(m: Mesh, p0: V3, p1: V3, r0: number, r1: number, n = 6): void {
  m.begin()
  const axis = norm(sub(p1, p0))
  let side = cross(axis, [1, 0, 0])
  side = Math.hypot(...side) > 1e-3 ? norm(side) : [0, 1, 0]
  const other = cross(axis, side)
  const ring = (p: V3, r: number) => Array.from({ length: n }, (_, k) => {
    const c = Math.cos(2 * Math.PI * k / n) * r, s = Math.sin(2 * Math.PI * k / n) * r
    return m.vert(p[0] + side[0] * c + other[0] * s, p[1] + side[1] * c + other[1] * s, p[2] + side[2] * c + other[2] * s)
  })
  const a = ring(p0, r0), b = ring(p1, r1)
  m.skin(a, b); m.poly(a, true); m.poly(b)
  m.closeSolid()
}

/**
 * A coil spring along +Z about the origin: `turns` turns of radius `R`, from z0 to z1, made of
 * a triangular wire (half size `r`) with its flat face outward, `per` stations a turn.
 */
export function helix(m: Mesh, turns: number, per: number, R: number, r: number, z0: number, z1: number): void {
  m.begin()
  const count = Math.floor(turns * per)
  const st: number[][] = []
  for (let k = 0; k <= count; k++) {
    const a = 2 * Math.PI * k / per, c = Math.cos(a), s = Math.sin(a), z = z0 + (z1 - z0) * k / count
    const x = R * c, y = R * s
    st.push([m.vert(x + c * r * .6, y + s * r * .6, z + r), m.vert(x + c * r * .6, y + s * r * .6, z - r), m.vert(x - c * r, y - s * r, z)])
  }
  for (let k = 0; k < count; k++) m.skin(st[k], st[k + 1])
  m.poly(st[0], true); m.poly(st[count])
  m.closeSolid()
}

/** Points of an ellipse-ish superellipse outline: half sizes a and b, exponent e (1 ellipse, below 1 squarer). */
export function superellipse(n: number, a: number, b: number, e = 1, phase = 0): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const t = 2 * Math.PI * k / n + phase, c = Math.cos(t), s = Math.sin(t)
    return [a * sgnpow(c, e), b * sgnpow(s, e)]
  })
}
