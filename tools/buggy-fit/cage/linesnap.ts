// Draws character lines into an existing half cage without rebuilding it: cage points near a
// line snap onto it, edges flip so consecutive snapped points are joined, and the joining
// edges become semi-sharp creases. Everything away from the lines keeps its points, so the
// front half and the lamp, scoop and rim regions stay as they shipped. Not shipped.
import type {CageData} from '../../../src/vehicles/buggygen/cage/generator'

type V3 = number[]
const sub = (a: V3, b: V3) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])

export interface SnapOptions {
  /** Spacing of snapped points along a line, metres. */
  spacing: number
  /** How far a cage point may travel onto a line, metres. */
  reach: number
  /** Semi-sharpness of the line creases. */
  sharpness: number
  /** Only cage points with z above this move (the front half stays as it is). */
  minZ: number
  /** Where no point is within reach, split the nearest edge to put one on the line. */
  insert?: boolean
}

export interface SnapReport { line: number; points: number; joined: number; segments: number }

/**
 * `lines` are polylines in metres (half body). Returns the edited cage (millimetres, like the
 * input), the indices of the points that moved, and per line how many points it took and how
 * many of its segments became cage edges.
 */
export function snapLines(d: CageData, lines: V3[][], o: SnapOptions, lineTags: number[] = []): { cage: CageData; moved: Set<number>; report: SnapReport[]; added: number } {
  const pos = d.v.map(x => x / 1000), f = [...d.f], t = [...d.t], c0 = [...d.c], s0 = d.s ? [...d.s] : d.c.filter((_, i) => i % 2 === 0).map(() => 99)
  let n = pos.length / 3; const P = (v: number) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
  const ek = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`
  const faceMap = () => { const m = new Map<string, number[]>(); for (let i = 0; i < f.length / 3; i++) for (let k = 0; k < 3; k++) { const key = ek(f[i * 3 + k], f[i * 3 + (k + 1) % 3]); (m.get(key) ?? m.set(key, []).get(key)!).push(i) } return m }
  let edges = faceMap()
  // Points that may move: every face around them shares one role, not on the mirror plane,
  // not on a crease, behind minZ.
  const vt: number[] = new Array(n).fill(-1), mixed: number[] = new Array(n).fill(0), creased: number[] = new Array(n).fill(0)
  for (let i = 0; i < f.length / 3; i++) for (let k = 0; k < 3; k++) { const v = f[i * 3 + k]; if (vt[v] >= 0 && vt[v] !== t[i]) mixed[v] = 1; vt[v] = t[i] }
  for (const v of d.c) creased[v] = 1
  const free = (v: number) => !mixed[v] && pos[v * 3] > 1e-6 && pos[v * 3 + 2] > o.minZ
  const used = new Set<number>(), moved = new Set<number>()
  const newCreases: number[] = [], report: SnapReport[] = []
  const flipToward = (u: number, v: number): boolean => {
    // Flip an edge of u's fan that crosses the segment u to v, until u and v are neighbours.
    for (let tries = 0; tries < 4; tries++) {
      if (edges.has(ek(u, v))) return true
      const pu = P(u), dir = sub(P(v), pu)
      let best: { key: string; c: number; d: number } | null = null
      for (let i = 0; i < f.length / 3; i++) {
        const tri = [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]]
        const k = tri.indexOf(u); if (k < 0) continue
        const a = tri[(k + 1) % 3], b = tri[(k + 2) % 3], key = ek(a, b), fs = edges.get(key)!
        if (fs.length !== 2 || t[fs[0]] !== t[fs[1]] || creased[a] && creased[b]) continue
        const other = fs.find(g => g !== i)!, c = [f[other * 3], f[other * 3 + 1], f[other * 3 + 2]].find(x => x !== a && x !== b)!
        if (edges.has(ek(u, c))) continue
        // The segment must pass between a and b, and the flip must not fold the surface.
        const na = cross(sub(P(a), pu), dir), nb = cross(sub(P(b), pu), dir)
        if (dot(na, nb) > 0) continue
        const n0 = cross(sub(P(a), pu), sub(P(b), pu)), n1 = cross(sub(P(c), pu), sub(P(a), pu)), n2 = cross(sub(P(b), pu), sub(P(c), pu))
        if (dot(n1, n0) <= 0 || dot(n2, n0) <= 0) continue
        const dist = len(sub(P(c), P(v)))
        if (!best || dist < best.d) best = {key, c, d: dist}
      }
      if (!best) return false
      const [a, b] = best.key.split(',').map(Number), fs = edges.get(best.key)!
      // Rebuild the two faces around the new edge u to c, keeping orientation.
      const i0 = fs.find(i => [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]].includes(u))!, i1 = fs.find(i => i !== i0)!
      const tri = [f[i0 * 3], f[i0 * 3 + 1], f[i0 * 3 + 2]], k = tri.indexOf(u), x = tri[(k + 1) % 3], y = tri[(k + 2) % 3]
      f.splice(i0 * 3, 3, u, x, best.c); f.splice(i1 * 3, 3, u, best.c, y)
      void a; void b
      edges = faceMap()
    }
    return edges.has(ek(u, v))
  }
  let added = 0
  /** Splits the same-role edge nearest q (behind minZ, off the mirror plane) and puts the new point at q. */
  const split = (q: V3, tag: number): number => {
    let best: { a: number; b: number; d: number } | null = null
    for (const [key, fs] of edges) {
      if (fs.length !== 2 || t[fs[0]] !== t[fs[1]] || (tag >= 0 && t[fs[0]] !== tag)) continue
      const [a, b] = key.split(',').map(Number)
      if (pos[a * 3 + 2] < o.minZ || pos[b * 3 + 2] < o.minZ || (pos[a * 3] < 1e-6 && pos[b * 3] < 1e-6)) continue
      const ab = sub(P(b), P(a)), w = Math.max(0, Math.min(1, dot(sub(q, P(a)), ab) / (dot(ab, ab) || 1)))
      const dd = len(sub(q, P(a).map((x, i) => x + w * ab[i])))
      if (w > .15 && w < .85 && (!best || dd < best.d)) best = {a, b, d: dd}
    }
    if (!best || best.d > o.reach) return -1
    const {a, b} = best, m = n++
    pos.push(q[0], q[1], q[2]); vt.push(t[edges.get(ek(a, b))![0]]); mixed.push(0); creased.push(0)
    for (const i of edges.get(ek(a, b))!) {
      const tri = [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]], k = tri.findIndex((x, j) => (x === a && tri[(j + 1) % 3] === b) || (x === b && tri[(j + 1) % 3] === a))
      const x = tri[k], y = tri[(k + 1) % 3], c = tri[(k + 2) % 3]
      f.splice(i * 3, 3, x, m, c); f.push(m, y, c); t.push(t[i])
    }
    // A crease on the split edge continues through the new point.
    for (let i = 0; i < c0.length; i += 2) if (ek(c0[i], c0[i + 1]) === ek(a, b)) { c0.splice(i, 2, a, m); c0.push(m, b); s0.push(s0[i / 2]); break }
    edges = faceMap(); added++
    return m
  }
  lines.forEach((line, li) => {
    // Resample the line at the spacing, ends included.
    const total = line.slice(1).reduce((s, p, i) => s + len(sub(p, line[i])), 0)
    const count = Math.max(1, Math.round(total / o.spacing)), targets: V3[] = []
    for (let j = 0; j <= count; j++) {
      let want = total * j / count, i = 0
      while (i < line.length - 2 && want > len(sub(line[i + 1], line[i]))) { want -= len(sub(line[i + 1], line[i])); i++ }
      const seg = sub(line[i + 1], line[i]), s = Math.min(1, want / (len(seg) || 1))
      targets.push(line[i].map((x, k) => x + s * seg[k]))
    }
    const chain: number[] = []
    for (const q of targets) {
      let best = -1, bd = o.reach
      const tag = lineTags[li] ?? -1
      for (let v = 0; v < n; v++) if (free(v) && !used.has(v) && vt[v] >= 0 && (tag < 0 || vt[v] === tag)) { const dd = len(sub(P(v), q)); if (dd < bd) { bd = dd; best = v } }
      if (best < 0 && o.insert) best = split(q, tag)
      if (best < 0) continue
      used.add(best); moved.add(best); chain.push(best)
      pos[best * 3] = q[0]; pos[best * 3 + 1] = q[1]; pos[best * 3 + 2] = q[2]
    }
    let joined = 0
    for (let i = 1; i < chain.length; i++) if (flipToward(chain[i - 1], chain[i]) || flipToward(chain[i], chain[i - 1])) { newCreases.push(chain[i - 1], chain[i]); joined++ }
    report.push({line: li, points: chain.length, joined, segments: Math.max(0, chain.length - 1)})
  })
  const s = s0, c = c0
  for (let i = 0; i < newCreases.length; i += 2) { c.push(newCreases[i], newCreases[i + 1]); s.push(o.sharpness) }
  return {cage: {...d, v: pos.map((x, i) => i % 3 === 0 && (i < d.v.length ? d.v[i] === 0 : x < 1e-6) ? 0 : Math.round(x * 1000)), f, t, c, s}, moved, report, added}
}
