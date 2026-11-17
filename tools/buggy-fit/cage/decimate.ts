// Quadric error edge collapse (Garland and Heckbert 1997) for the half body. Not shipped.
//
// Region borders (faces of different role) and open edges get stiff perpendicular planes so
// lamp outlines and openings survive. Vertices on the mirror plane (x = 0) stay on it: an edge
// from the plane collapses onto the plane vertex, and two plane vertices merge only along an
// open edge, so the half mesh always mirrors cleanly.
import type {TriMesh} from './geom'

type Q = Float64Array // a b c d planes summed: 10 coefficients of the symmetric 4x4

function planeQ(n: number[], d: number, w: number, q: Q) {
  const [a, b, c] = n
  q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d
  q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d
  q[7] += w * c * c; q[8] += w * c * d; q[9] += w * d * d
}
function evalQ(q: Q, x: number, y: number, z: number) {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9]
}
function optimum(q: Q): number[] | null {
  const m = [q[0], q[1], q[2], q[1], q[4], q[5], q[2], q[5], q[7]], r = [-q[3], -q[6], -q[8]]
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (Math.abs(det) < 1e-12) return null
  const inv = (i: number) => { const c = [...m]; c[i] = r[0]; c[i + 3] = r[1]; c[i + 6] = r[2]; return (c[0] * (c[4] * c[8] - c[5] * c[7]) - c[1] * (c[3] * c[8] - c[5] * c[6]) + c[2] * (c[3] * c[7] - c[4] * c[6])) / det }
  return [inv(0), inv(1), inv(2)]
}

class Heap {
  a: [number, number, number, number][] = [] // cost, u, v, stamp sum
  push(e: [number, number, number, number]) { const a = this.a; a.push(e); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p } }
  pop() { const a = this.a, top = a[0], last = a.pop()!; if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m } } return top }
}

/**
 * `protect` lists role tags whose vertices never collapse, so a small region such as a tail
 * lamp keeps every point of its outline and stays thin after subdivision.
 */
export interface LockBox { tag: number; min: number[]; max: number[] }

export function decimate(src: TriMesh, targetVerts: number, borderWeight = 20, shape = 0, protect: number[] = [], cornerDegrees = 0, cornerTags: number[] = [], boxes: LockBox[] = [], foldLock = 0, foldBox?: LockBox): TriMesh {
  const pos = Array.from(src.pos), V = pos.length / 3
  const faces = Array.from(src.tri), tag = Array.from(src.tag), F = faces.length / 3
  const alive = new Uint8Array(F).fill(1), valive = new Uint8Array(V).fill(1), stamp = new Uint32Array(V)
  const vf: Set<number>[] = Array.from({length: V}, () => new Set())
  for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) vf[faces[f * 3 + k]].add(f)
  const locked = new Uint8Array(V)
  for (let f = 0; f < F; f++) if (protect.includes(tag[f])) for (let k = 0; k < 3; k++) locked[faces[f * 3 + k]] = 1
  // Boxes lock one role's points inside them: a feature such as the hood scoop lip, without
  // locking the rest of that role.
  for (let f = 0; f < F; f++) for (const b of boxes) if (tag[f] === b.tag) for (let k = 0; k < 3; k++) {
    const v = faces[f * 3 + k], p = [src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2]]
    if (p.every((x, i) => x >= b.min[i] && x <= b.max[i])) locked[v] = 1
  }
  const seam = new Uint8Array(V); for (let v = 0; v < V; v++) if (Math.abs(pos[v * 3]) < 1e-4) { seam[v] = 1; pos[v * 3] = 0 }
  const P = (v: number) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
  const normal = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
  }
  const quad: Q[] = Array.from({length: V}, () => new Float64Array(10))
  const edgeFaces = new Map<string, number[]>(), ek = (a: number, b: number) => a < b ? a + ',' + b : b + ',' + a
  for (let f = 0; f < F; f++) {
    const [a, b, c] = [0, 1, 2].map(k => faces[f * 3 + k]), n = normal(P(a), P(b), P(c)), l = Math.hypot(...n)
    if (l < 1e-14) continue
    const u = n.map(x => x / l), d = -(u[0] * pos[a * 3] + u[1] * pos[a * 3 + 1] + u[2] * pos[a * 3 + 2])
    for (const v of [a, b, c]) planeQ(u, d, l / 2, quad[v])
    for (let k = 0; k < 3; k++) { const key = ek(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3]); (edgeFaces.get(key) ?? edgeFaces.set(key, []).get(key)!).push(f) }
  }
  // Stiff planes along borders and open edges, and remember which vertices are on them.
  const border = new Uint8Array(V)
  for (const [key, fs] of edgeFaces) {
    const open = fs.length === 1, roleEdge = fs.length === 2 && tag[fs[0]] !== tag[fs[1]]
    if (!open && !roleEdge) continue
    const [a, b] = key.split(',').map(Number)
    if (open && seam[a] && seam[b]) continue // the mirror plane is not an edge of the body
    border[a] = border[b] = 1
    const f = fs[0], n = normal(P(faces[f * 3]), P(faces[f * 3 + 1]), P(faces[f * 3 + 2]))
    const e = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]]
    const el = Math.hypot(...e), p = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]], pl = Math.hypot(...p)
    if (pl < 1e-14) continue
    const u = p.map(x => x / pl), d = -(u[0] * pos[a * 3] + u[1] * pos[a * 3 + 1] + u[2] * pos[a * 3 + 2])
    for (const v of [a, b]) planeQ(u, d, borderWeight * el * el, quad[v])
  }
  // Outline corners: with `cornerDegrees`, border points where a region outline turns by more
  // than that, or where three or more border edges meet, never collapse. This keeps pointed
  // ends (the cockpit rim's rear wedge, lamp and scoop corners) sharp. `cornerTags` limits it
  // to outlines of those roles; empty means every role.
  if (cornerDegrees > 0) {
    const ends: number[][] = Array.from({length: V}, () => [])
    for (const [key, fs] of edgeFaces) {
      const open = fs.length === 1, roleEdge = fs.length === 2 && tag[fs[0]] !== tag[fs[1]]
      if (!open && !roleEdge) continue
      if (cornerTags.length && !fs.some(f => cornerTags.includes(tag[f]))) continue
      const [a, b] = key.split(',').map(Number)
      if (open && seam[a] && seam[b]) continue
      ends[a].push(b); ends[b].push(a)
    }
    const cos = Math.cos(cornerDegrees * Math.PI / 180)
    for (let v = 0; v < V; v++) {
      const e = ends[v]
      if (e.length > 2) { locked[v] = 1; continue }
      if (e.length !== 2) continue
      const p = P(v), u = P(e[0]).map((x, i) => x - p[i]), w = p.map((x, i) => x - P(e[1])[i])
      const c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / ((Math.hypot(...u) * Math.hypot(...w)) || 1)
      if (c < cos) locked[v] = 1
    }
  }
  // Fold lines: with `foldLock` degrees, points on an edge where one role folds by more than
  // that never collapse, so character lines (the rear flank's) keep cage edges along them.
  if (foldLock > 0) {
    const cos = Math.cos(foldLock * Math.PI / 180)
    for (const [key, fs] of edgeFaces) {
      if (fs.length !== 2 || tag[fs[0]] !== tag[fs[1]]) continue
      if (foldBox && (tag[fs[0]] !== foldBox.tag || !key.split(',').map(Number).every(v => P(v).every((x, i) => x >= foldBox.min[i] && x <= foldBox.max[i])))) continue
      const n0 = normal(P(faces[fs[0] * 3]), P(faces[fs[0] * 3 + 1]), P(faces[fs[0] * 3 + 2])), n1 = normal(P(faces[fs[1] * 3]), P(faces[fs[1] * 3 + 1]), P(faces[fs[1] * 3 + 2]))
      const c = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / ((Math.hypot(...n0) * Math.hypot(...n1)) || 1)
      if (c < cos) for (const v of key.split(',').map(Number)) locked[v] = 1
    }
  }
  console.error(`decimate: ${locked.reduce((s, x) => s + x, 0)} points locked`)
  const neighbours = (v: number) => { const s = new Set<number>(); for (const f of vf[v]) for (let k = 0; k < 3; k++) s.add(faces[f * 3 + k]); s.delete(v); return s }
  const isOpen = (a: number, b: number) => { let n = 0; for (const f of vf[a]) if (vf[b].has(f)) n++; return n === 1 }
  const heap = new Heap()
  const place = (a: number, b: number): [number, number[]] | null => {
    if (seam[a] && seam[b] && !isOpen(a, b)) return null
    const q = quad[a].map((x, i) => x + quad[b][i]) as Q
    let options: number[][]
    if (seam[a] !== seam[b]) options = [P(seam[a] ? a : b)]
    else if (border[a] !== border[b]) options = [P(border[a] ? a : b)]
    else {
      options = [P(a), P(b), P(a).map((x, i) => (x + P(b)[i]) / 2)]
      const o = optimum(q); if (o && !seam[a]) options.push(o)
    }
    if (seam[a] && seam[b]) options = options.map(o => [0, o[1], o[2]])
    let best: [number, number[]] | null = null
    for (const o of options) { const c = evalQ(q, o[0], o[1], o[2]); if (!best || c < best[0]) best = [c, o] }
    return best
  }
  // `shape` adds the squared edge length, scaled by the vertex area, so short edges go first and
  // the cage keeps rounder triangles that subdivide without wrinkles.
  const enqueue = (a: number, b: number) => {
    const p = place(a, b); if (!p) return
    const l2 = (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2
    heap.push([Math.max(p[0], 0) + shape * l2 * (quad[a][0] + quad[a][4] + quad[a][7] + quad[b][0] + quad[b][4] + quad[b][7]), a, b, stamp[a] + stamp[b]])
  }
  for (const key of edgeFaces.keys()) { const [a, b] = key.split(',').map(Number); enqueue(a, b) }
  let count = V
  while (count > targetVerts && heap.a.length) {
    const [, a, b, s] = heap.pop()
    if (!valive[a] || !valive[b] || s !== stamp[a] + stamp[b]) continue
    if (locked[a] || locked[b]) continue
    const shared = [...vf[a]].filter(f => vf[b].has(f))
    if (!shared.length) continue
    // Link condition: the only common neighbours are the opposite vertices of the shared faces.
    const na = neighbours(a), nb = neighbours(b); let common = 0; for (const v of na) if (nb.has(v)) common++
    if (common !== shared.length) continue
    const p = place(a, b)!; if (!p) continue
    // No flipped or sliver faces around either end.
    let ok = true
    for (const v of [a, b]) for (const f of vf[v]) {
      if (shared.includes(f)) continue
      const corners = [0, 1, 2].map(k => faces[f * 3 + k]), before = normal(P(corners[0]), P(corners[1]), P(corners[2]))
      const after = normal(...(corners.map(c => (c === a || c === b) ? p[1] : P(c)) as [number[], number[], number[]]))
      const bl = Math.hypot(...before), al = Math.hypot(...after)
      if (al < 1e-12 || (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (bl * al) < .3) { ok = false; break }
    }
    if (!ok) { continue }
    for (const f of shared) { alive[f] = 0; for (let k = 0; k < 3; k++) vf[faces[f * 3 + k]].delete(f) }
    for (const f of vf[b]) { for (let k = 0; k < 3; k++) if (faces[f * 3 + k] === b) faces[f * 3 + k] = a; vf[a].add(f) }
    vf[b].clear(); valive[b] = 0; count--
    pos[a * 3] = p[1][0]; pos[a * 3 + 1] = p[1][1]; pos[a * 3 + 2] = p[1][2]
    quad[a] = quad[a].map((x, i) => x + quad[b][i]) as Q
    seam[a] = seam[a] | seam[b]; border[a] = border[a] | border[b]; stamp[a]++
    for (const v of neighbours(a)) enqueue(a, v)
  }
  const remap = new Int32Array(V).fill(-1), out: number[] = []
  for (let v = 0; v < V; v++) if (valive[v] && vf[v].size) { remap[v] = out.length / 3; out.push(...P(v)) }
  const tri: number[] = [], tags: number[] = []
  for (let f = 0; f < F; f++) if (alive[f]) { tri.push(...[0, 1, 2].map(k => remap[faces[f * 3 + k]])); tags.push(tag[f]) }
  return {pos: Float64Array.from(out), tri: Uint32Array.from(tri), tag: Uint8Array.from(tags)}
}
