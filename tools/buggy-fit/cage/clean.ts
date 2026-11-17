// Cleans a decimated half cage before fitting: Delaunay edge flips inside smooth same-role
// patches and tangential relaxation of interior vertices, each projected back onto the
// reference surface of its role. Region borders, open edges, the mirror plane and folds are
// left where decimation put them. Not shipped.
import type {TriMesh, TriGrid} from './geom'

type V3 = number[]
const sub = (a: V3, b: V3) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const angleAt = (p: V3, a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, p)), unit(sub(b, p))))))

export function clean(m: TriMesh, grid: TriGrid, rounds = 6, foldDegrees = 35): TriMesh {
  const pos = Array.from(m.pos), tri = Array.from(m.tri), tag = Array.from(m.tag), V = pos.length / 3, F = tri.length / 3
  const P = (v: number) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
  const fnorm = (f: number) => unit(cross(sub(P(tri[f * 3 + 1]), P(tri[f * 3])), sub(P(tri[f * 3 + 2]), P(tri[f * 3]))))
  const foldCos = Math.cos(foldDegrees * Math.PI / 180)
  const edgeMap = () => {
    const e = new Map<string, number[]>()
    for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) { const a = tri[f * 3 + k], b = tri[f * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; (e.get(key) ?? e.set(key, []).get(key)!).push(f) }
    return e
  }
  const seam = (v: number) => pos[v * 3] === 0
  for (let round = 0; round < rounds; round++) {
    // Flips: an edge whose opposite angles sum past 180 degrees is flipped, if the patch is
    // smooth and one role, and the flip neither folds nor duplicates an edge.
    for (let pass = 0; pass < 3; pass++) {
      const edges = edgeMap()
      let flips = 0
      for (const [key, fs] of edges) {
        if (fs.length !== 2 || tag[fs[0]] !== tag[fs[1]]) continue
        const [a, b] = key.split(',').map(Number)
        const n0 = fnorm(fs[0]), n1 = fnorm(fs[1])
        if (dot(n0, n1) < foldCos) continue
        const opp = fs.map(f => [0, 1, 2].map(k => tri[f * 3 + k]).find(v => v !== a && v !== b)!)
        const [c, d] = opp
        if (c === d || edges.has(c < d ? `${c},${d}` : `${d},${c}`)) continue
        if (angleAt(P(c), P(a), P(b)) + angleAt(P(d), P(a), P(b)) <= Math.PI + 1e-6) continue
        // Rebuild both faces keeping the winding of the first: it runs a -> b or b -> a.
        const f0 = fs[0], f1 = fs[1], c0 = [0, 1, 2].map(k => tri[f0 * 3 + k])
        const i = c0.indexOf(a), forward = c0[(i + 1) % 3] === b
        const [x, y] = forward ? [a, b] : [b, a] // f0 is x, y, c
        const t0 = [x, d, c], t1 = [d, y, c]
        const nn0 = unit(cross(sub(P(t0[1]), P(t0[0])), sub(P(t0[2]), P(t0[0])))), nn1 = unit(cross(sub(P(t1[1]), P(t1[0])), sub(P(t1[2]), P(t1[0]))))
        if (dot(nn0, n0) < .8 || dot(nn1, n0) < .8 || dot(nn0, nn1) < foldCos) continue
        tri.splice(f0 * 3, 3, ...t0); tri.splice(f1 * 3, 3, ...t1)
        flips++
        break // the edge map is stale; rebuild
      }
      if (!flips) break
      pass-- // keep going while flips happen, up to the round's limit below
      if (pass < -400) break
    }
    // Relaxation: interior vertices of one role move toward the centroid of their neighbours,
    // in their tangent plane, then back onto the reference surface of that role.
    const edges = edgeMap(), fixed = new Uint8Array(V), nb: Set<number>[] = Array.from({length: V}, () => new Set()), vtag = new Int16Array(V).fill(-1)
    for (const [key, fs] of edges) {
      const [a, b] = key.split(',').map(Number)
      nb[a].add(b); nb[b].add(a)
      if (fs.length !== 2 || tag[fs[0]] !== tag[fs[1]] || dot(fnorm(fs[0]), fnorm(fs[1])) < foldCos) fixed[a] = fixed[b] = 1
    }
    for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) vtag[tri[f * 3 + k]] = tag[f]
    const vn: V3[] = Array.from({length: V}, () => [0, 0, 0])
    for (let f = 0; f < F; f++) { const n = cross(sub(P(tri[f * 3 + 1]), P(tri[f * 3])), sub(P(tri[f * 3 + 2]), P(tri[f * 3]))); for (let k = 0; k < 3; k++) { const o = vn[tri[f * 3 + k]]; o[0] += n[0]; o[1] += n[1]; o[2] += n[2] } }
    const next = pos.slice()
    for (let v = 0; v < V; v++) {
      if (fixed[v] || seam(v) || !nb[v].size) continue
      const c = [0, 0, 0]; for (const u of nb[v]) { const q = P(u); c[0] += q[0]; c[1] += q[1]; c[2] += q[2] }
      const p = P(v), n = unit(vn[v]), d = sub(c.map(x => x / nb[v].size), p), t = sub(d, n.map(x => x * dot(d, n)))
      const moved = [p[0] + .5 * t[0], p[1] + .5 * t[1], p[2] + .5 * t[2]]
      const r = grid.nearest(moved, vtag[v], 40, n)
      if (r.point[0] < 1e-4) continue // never cross onto the mirror plane
      next[v * 3] = r.point[0]; next[v * 3 + 1] = r.point[1]; next[v * 3 + 2] = r.point[2]
    }
    // Reject moves that flip a face.
    const old = pos.slice()
    for (let i = 0; i < pos.length; i++) pos[i] = next[i]
    for (let f = 0; f < F; f++) {
      const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2]
      const before = cross(sub([old[b * 3], old[b * 3 + 1], old[b * 3 + 2]], [old[a * 3], old[a * 3 + 1], old[a * 3 + 2]]), sub([old[c * 3], old[c * 3 + 1], old[c * 3 + 2]], [old[a * 3], old[a * 3 + 1], old[a * 3 + 2]]))
      if (dot(unit(before), fnorm(f)) < .5) for (const v of [a, b, c]) for (let k = 0; k < 3; k++) pos[v * 3 + k] = old[v * 3 + k]
    }
  }
  return {pos: Float64Array.from(pos), tri: Uint32Array.from(tri), tag: Uint8Array.from(tag)}
}

/** Smallest interior angle per triangle, in degrees: mean and the share under 20 degrees. */
export function quality(m: TriMesh): { meanMin: number; slivers: number } {
  let s = 0, bad = 0
  const T = m.tri.length / 3, P = (v: number) => [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]
  for (let f = 0; f < T; f++) {
    const [a, b, c] = [0, 1, 2].map(k => P(m.tri[f * 3 + k]))
    const min = Math.min(angleAt(a, b, c), angleAt(b, c, a), angleAt(c, a, b)) * 180 / Math.PI
    s += min; if (min < 20) bad++
  }
  return {meanMin: Math.round(s / T * 10) / 10, slivers: Math.round(bad / T * 1000) / 1000}
}
