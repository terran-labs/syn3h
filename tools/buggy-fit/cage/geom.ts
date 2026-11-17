// Offline geometry helpers for the cage fitter: welding, a triangle grid for nearest point
// queries, area weighted sampling and a symmetric surface distance. Not shipped.

export interface TriMesh { pos: Float64Array | Float32Array; tri: Uint32Array; tag: Uint8Array }

/** Welds coincident vertices (to 0.01 mm). */
export function weld(pos: ArrayLike<number>, index: ArrayLike<number>, tag: ArrayLike<number>): TriMesh {
  const map = new Map<string, number>(), out: number[] = [], remap: number[] = []
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`
    let v = map.get(k)
    if (v === undefined) { v = map.size; map.set(k, v); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) }
    remap.push(v)
  }
  const tri = new Uint32Array(index.length)
  for (let i = 0; i < index.length; i++) tri[i] = remap[index[i]]
  return {pos: Float64Array.from(out), tri, tag: Uint8Array.from(tag)}
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTri(p: number[], a: number[], b: number[], c: number[], out: number[]): void {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const set = (q: number[]) => { out[0] = q[0]; out[1] = q[1]; out[2] = q[2] }
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return set(a)
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return set(b)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]) }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return set(c)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]) }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]) }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom
  set([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w])
}

/** Uniform grid over triangles for nearest point queries, optionally restricted to one tag. */
export class TriGrid {
  private cells = new Map<number, number[]>()
  private min: number[]
  /** Unit face normals. */
  readonly normals: Float64Array
  constructor(private m: TriMesh, private h = .04) {
    const p = m.pos
    this.normals = new Float64Array(m.tri.length)
    for (let t = 0; t < m.tri.length / 3; t++) {
      const [a, b, c] = [0, 1, 2].map(k => m.tri[t * 3 + k] * 3)
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1
      this.normals.set(n.map(x => x / l), t * 3)
    }
    this.min = [Infinity, Infinity, Infinity]
    for (let i = 0; i < p.length; i++) this.min[i % 3] = Math.min(this.min[i % 3], p[i])
    this.min = this.min.map(v => v - 1)
    for (let t = 0; t < m.tri.length / 3; t++) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = p[m.tri[t * 3 + k] * 3 + a]; lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v) }
      const [x0, y0, z0] = this.cell(lo), [x1, y1, z1] = this.cell(hi)
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = this.key(x, y, z); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(t)
      }
    }
  }
  private cell(p: number[]) { return [0, 1, 2].map(a => Math.floor((p[a] - this.min[a]) / this.h)) }
  private key(x: number, y: number, z: number) { return (x * 1024 + y) * 1024 + z }
  private vert(i: number) { const p = this.m.pos; return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]] }
  /** Nearest point and its triangle; with `tag`, only triangles of that tag (falls back to all). */
  nearest(p: number[], tag = -1, maxRing = 40, normal?: number[]): { point: number[]; dist: number; tri: number } {
    const [cx, cy, cz] = this.cell(p), q = [0, 0, 0]
    let best = Infinity, bestP = [0, 0, 0], bestT = -1
    const seen = new Set<number>()
    for (let r = 0; r <= maxRing; r++) {
      if (best < (r - 1) * this.h) break
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue
        const list = this.cells.get(this.key(x, y, z)); if (!list) continue
        for (const t of list) {
          if (seen.has(t)) continue; seen.add(t)
          if (tag >= 0 && this.m.tag[t] !== tag) continue
          if (normal && normal[0] * this.normals[t * 3] + normal[1] * this.normals[t * 3 + 1] + normal[2] * this.normals[t * 3 + 2] < .2) continue
          closestOnTri(p, this.vert(this.m.tri[t * 3]), this.vert(this.m.tri[t * 3 + 1]), this.vert(this.m.tri[t * 3 + 2]), q)
          const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
          if (d < best) { best = d; bestP = [...q]; bestT = t }
        }
      }
    }
    if (bestT < 0 && normal) return this.nearest(p, tag, maxRing)
    if (bestT < 0 && tag >= 0) return this.nearest(p, -1, maxRing)
    return {point: bestP, dist: best, tri: bestT}
  }
}

/** Area weighted random samples (seeded) with the triangle each came from. */
export function sample(m: TriMesh, n: number, seed = 1): { pts: number[][]; tri: number[] } {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const T = m.tri.length / 3, cum = new Float64Array(T + 1), p = m.pos
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [0, 1, 2].map(k => m.tri[t * 3 + k] * 3)
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    cum[t + 1] = cum[t] + .5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
  }
  const pts: number[][] = [], tri: number[] = []
  for (let i = 0; i < n; i++) {
    const r = rnd() * cum[T]
    let lo = 0, hi = T
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < r) lo = mid + 1; else hi = mid }
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v }
    const [a, b, c] = [0, 1, 2].map(k => m.tri[lo * 3 + k] * 3)
    pts.push([0, 1, 2].map(k => p[a + k] + u * (p[b + k] - p[a + k]) + v * (p[c + k] - p[a + k]))); tri.push(lo)
  }
  return {pts, tri}
}

export interface Distance { meanMm: number; rmsMm: number; p95Mm: number; maxMm: number; roleMatch: number }

/** Symmetric surface distance in millimetres, plus the share of reference samples whose nearest candidate surface carries the same role. */
export function distance(ref: TriMesh, cand: TriMesh, refGrid: TriGrid, n = 20000): Distance {
  const candGrid = new TriGrid(cand)
  const d: number[] = []
  let match = 0
  const a = sample(ref, n, 7)
  a.pts.forEach((p, i) => { const r = candGrid.nearest(p); d.push(r.dist); if (cand.tag[r.tri] === ref.tag[a.tri[i]]) match++ })
  for (const p of sample(cand, n, 9).pts) d.push(refGrid.nearest(p).dist)
  d.sort((x, y) => x - y)
  const mm = (x: number) => Math.round(x * 10000) / 10
  return {
    meanMm: mm(d.reduce((s, x) => s + x, 0) / d.length), rmsMm: mm(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)),
    p95Mm: mm(d[Math.floor(d.length * .95)]), maxMm: mm(d[d.length - 1]), roleMatch: Math.round(match / n * 1000) / 1000,
  }
}

/**
 * Shading roughness: mean fold angle in degrees across edges shared by two faces of one role
 * that bend less than 40 degrees (creases excluded). Lower is smoother. Compare meshes of
 * similar triangle counts; finer meshes fold less per edge.
 */
export function roughness(m: TriMesh): number {
  const edges = new Map<string, number[]>(), p = m.pos
  const n = (f: number) => { const [a, b, c] = [0, 1, 2].map(k => m.tri[f * 3 + k] * 3); const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]; const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(x[0], x[1], x[2]) || 1; return x.map(q => q / l) }
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) { const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; (edges.get(key) ?? edges.set(key, []).get(key)!).push(f) }
  let s = 0, c = 0
  for (const fs of edges.values()) {
    if (fs.length !== 2 || m.tag[fs[0]] !== m.tag[fs[1]]) continue
    const a = n(fs[0]), b = n(fs[1]), ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI
    if (ang < 40) { s += ang; c++ }
  }
  return Math.round(s / c * 100) / 100
}
