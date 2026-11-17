/**
 * Geometry measurements on plain triangle meshes: area-weighted surface samples, nearest
 * surface point through a bounding volume hierarchy, closure and winding, enclosed volume.
 */
import type { Mesh } from './reference'

/** Small deterministic generator, so repeated runs give the same samples. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const triangleCount = (m: Mesh) => m.indices.length / 3

/** Concatenate meshes into one. */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  const vertices = meshes.reduce((n, m) => n + m.positions.length, 0), indices = meshes.reduce((n, m) => n + m.indices.length, 0)
  const out: Mesh = { positions: new Float32Array(vertices), indices: new Uint32Array(indices), materials: [] }
  let v = 0, i = 0
  for (const m of meshes) {
    out.positions.set(m.positions, v)
    for (let k = 0; k < m.indices.length; k++) out.indices[i + k] = m.indices[k] + v / 3
    out.materials.push(...m.materials)
    v += m.positions.length; i += m.indices.length
  }
  return out
}

function corners(m: Mesh, t: number): number[] {
  const p = m.positions, a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
  return [p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]
}

/** Unit face normal and area of triangle t (zero normal for a degenerate triangle). */
export function faceNormal(m: Mesh, t: number): { n: [number, number, number]; area: number } {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(m, t)
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  return { n: len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0], area: len / 2 }
}

export const surfaceArea = (m: Mesh) => { let a = 0; for (let t = 0; t < triangleCount(m); t++) a += faceNormal(m, t).area; return a }

export interface Sample { p: [number, number, number]; n: [number, number, number] }

/** `count` points spread over the surface in proportion to area, with their face normals. */
export function sampleSurface(m: Mesh, count: number, seed = 1): Sample[] {
  const tris = triangleCount(m), cumulative = new Float64Array(tris)
  let total = 0
  for (let t = 0; t < tris; t++) { total += faceNormal(m, t).area; cumulative[t] = total }
  if (total === 0) return []
  const random = mulberry32(seed), out: Sample[] = []
  for (let s = 0; s < count; s++) {
    const target = random() * total
    let lo = 0, hi = tris - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < target) lo = mid + 1; else hi = mid }
    let u = random(), v = random()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(m, lo)
    out.push({ p: [ax + u * (bx - ax) + v * (cx - ax), ay + u * (by - ay) + v * (cy - ay), az + u * (bz - az) + v * (cz - az)], n: faceNormal(m, lo).n })
  }
  return out
}

/**
 * Closest point on triangle (a, b, c) to p, written to out (Ericson, Real-Time Collision
 * Detection 5.1.5). Scalar arguments: this is the inner loop of every distance query.
 */
function closestOnTriangle(px: number, py: number, pz: number, t: Float64Array, o: number, out: Float64Array): void {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8]
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
  const set = (x: number, y: number, z: number) => { out[0] = x; out[1] = y; out[2] = z }
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return set(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(ax + v * abx, ay + v * aby, az + v * abz) }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + w * acx, ay + w * acy, az + w * acz) }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return set(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz))
  }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom
  set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/** Bounding volume hierarchy over a mesh's triangles, for nearest surface point queries. */
export class Bvh {
  private readonly boxes: number[] = []
  /** Per node: left child, right child (or -1 and first triangle, count for a leaf). */
  private readonly nodes: number[] = []
  private readonly order: Uint32Array
  private readonly tri: Float64Array
  constructor(readonly mesh: Mesh) {
    const n = triangleCount(mesh)
    this.order = new Uint32Array(n).map((_, i) => i)
    this.tri = new Float64Array(n * 9)
    for (let t = 0; t < n; t++) this.tri.set(corners(mesh, t), t * 9)
    if (n) this.build(0, n)
  }
  private build(start: number, end: number): number {
    const node = this.nodes.length / 4
    this.nodes.push(0, 0, 0, 0)
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], cen = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (let i = start; i < end; i++) {
      const t = this.order[i] * 9
      for (let k = 0; k < 3; k++) {
        const v = [this.tri[t + k], this.tri[t + 3 + k], this.tri[t + 6 + k]]
        box[k] = Math.min(box[k], ...v); box[k + 3] = Math.max(box[k + 3], ...v)
        const c = (v[0] + v[1] + v[2]) / 3
        cen[k] = Math.min(cen[k], c); cen[k + 3] = Math.max(cen[k + 3], c)
      }
    }
    this.boxes.push(...box)
    if (end - start <= 4) { this.nodes.splice(node * 4, 4, -1, start, end - start, 0); return node }
    const axis = [0, 1, 2].reduce((a, k) => cen[k + 3] - cen[k] > cen[a + 3] - cen[a] ? k : a, 0)
    const ids = Array.from(this.order.subarray(start, end))
    const key = (t: number) => this.tri[t * 9 + axis] + this.tri[t * 9 + 3 + axis] + this.tri[t * 9 + 6 + axis]
    ids.sort((a, b) => key(a) - key(b))
    this.order.set(ids, start)
    const mid = (start + end) >> 1
    const left = this.build(start, mid), right = this.build(mid, end)
    this.nodes[node * 4] = left; this.nodes[node * 4 + 1] = right
    return node
  }
  private readonly q = new Float64Array(3)
  private readonly stack = new Int32Array(256)
  /** Nearest point on the surface to p: distance, the triangle and the point. */
  nearest(p: ArrayLike<number>): { distance: number; triangle: number; point: [number, number, number] } {
    let best = Infinity, bestTri = -1
    const bestPoint: [number, number, number] = [0, 0, 0], q = this.q, px = p[0], py = p[1], pz = p[2]
    if (!this.order.length) return { distance: Infinity, triangle: -1, point: bestPoint }
    const boxes = this.boxes, nodes = this.nodes, stack = this.stack
    const boxDistance = (node: number) => {
      const o = node * 6
      const ex = px < boxes[o] ? boxes[o] - px : px > boxes[o + 3] ? px - boxes[o + 3] : 0
      const ey = py < boxes[o + 1] ? boxes[o + 1] - py : py > boxes[o + 4] ? py - boxes[o + 4] : 0
      const ez = pz < boxes[o + 2] ? boxes[o + 2] - pz : pz > boxes[o + 5] ? pz - boxes[o + 5] : 0
      return ex * ex + ey * ey + ez * ez
    }
    let top = 0
    stack[top++] = 0
    while (top) {
      const node = stack[--top]
      if (boxDistance(node) >= best) continue
      if (nodes[node * 4] === -1) {
        const first = nodes[node * 4 + 1], count = nodes[node * 4 + 2]
        for (let i = first; i < first + count; i++) {
          closestOnTriangle(px, py, pz, this.tri, this.order[i] * 9, q)
          const d = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2
          if (d < best) { best = d; bestTri = this.order[i]; bestPoint[0] = q[0]; bestPoint[1] = q[1]; bestPoint[2] = q[2] }
        }
      } else {
        const l = nodes[node * 4], r = nodes[node * 4 + 1]
        // Visit the nearer child first (pushed last).
        if (boxDistance(l) < boxDistance(r)) { stack[top++] = r; stack[top++] = l } else { stack[top++] = l; stack[top++] = r }
      }
    }
    return { distance: Math.sqrt(best), triangle: bestTri, point: bestPoint }
  }
}

/**
 * Closure and winding, with vertices welded at 0.01 mm so split normals and seams do not count
 * as holes. Closed: every edge joins exactly two triangles. Consistent: every shared edge is
 * traversed once in each direction.
 */
export function topology(m: Mesh): { closed: boolean; consistent: boolean; boundaryEdges: number; nonManifoldEdges: number; flippedEdges: number } {
  const weld = new Map<string, number>(), id: number[] = []
  for (let v = 0; v < m.positions.length / 3; v++) {
    const key = [0, 1, 2].map(k => Math.round(m.positions[v * 3 + k] * 1e5)).join(',')
    if (!weld.has(key)) weld.set(key, weld.size)
    id.push(weld.get(key)!)
  }
  const directed = new Map<string, number>()
  for (let t = 0; t < triangleCount(m); t++) {
    const v = [id[m.indices[t * 3]], id[m.indices[t * 3 + 1]], id[m.indices[t * 3 + 2]]]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    for (let k = 0; k < 3; k++) { const key = `${v[k]},${v[(k + 1) % 3]}`; directed.set(key, (directed.get(key) ?? 0) + 1) }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, flippedEdges = 0
  const seen = new Set<string>()
  for (const [key, n] of directed) {
    const [a, b] = key.split(',').map(Number), undirected = a < b ? key : `${b},${a}`
    if (seen.has(undirected)) continue
    seen.add(undirected)
    const back = directed.get(`${b},${a}`) ?? 0, total = n + back
    if (total === 1) boundaryEdges++
    else if (total > 2) nonManifoldEdges++
    else if (n !== 1 || back !== 1) flippedEdges++
  }
  return { closed: boundaryEdges === 0 && nonManifoldEdges === 0, consistent: flippedEdges === 0, boundaryEdges, nonManifoldEdges, flippedEdges }
}

/** Signed enclosed volume (m^3) by the divergence theorem; meaningful only for closed meshes. */
export function volume(m: Mesh): number {
  let v = 0
  for (let t = 0; t < triangleCount(m); t++) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(m, t)
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return v
}
