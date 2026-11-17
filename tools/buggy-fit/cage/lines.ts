// Character lines of the reference body: chains of sharp edges inside one role (folds such
// as the rear flank's shoulder line, the haunch, the tail fins and the spoiler's edges and
// plates), as polylines of reference vertex indices. Not shipped.
import type {TriMesh} from './geom'

export interface Line { verts: number[]; length: number; tag: number }

export interface LineOptions {
  /** Fold angle, degrees, above which an edge counts as sharp. */
  degrees: number
  /** Chains shorter than this, metres, are facet noise and dropped. */
  minLength: number
  /** Only edges with both ends inside this box (half body, metres). */
  min: number[]
  max: number[]
  /** Break a chain where it turns by more than this, degrees. */
  turn: number
}

export function characterLines(m: TriMesh, o: LineOptions): Line[] {
  const p = m.pos, P = (v: number) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
  const inside = (v: number) => P(v).every((x, i) => x >= o.min[i] && x <= o.max[i])
  const edges = new Map<string, number[]>()
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) { const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; (edges.get(key) ?? edges.set(key, []).get(key)!).push(f) }
  const n = (f: number) => { const [a, b, c] = [0, 1, 2].map(k => P(m.tri[f * 3 + k])); const u = b.map((x, i) => x - a[i]), w = c.map((x, i) => x - a[i]); const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...x) || 1; return x.map(q => q / l) }
  const cos = Math.cos(o.degrees * Math.PI / 180)
  const adj = new Map<number, number[]>(), tagOf = new Map<string, number>()
  for (const [key, fs] of edges) {
    if (fs.length !== 2 || m.tag[fs[0]] !== m.tag[fs[1]]) continue
    const a = n(fs[0]), b = n(fs[1])
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] >= cos) continue
    const [i, j] = key.split(',').map(Number)
    if (!inside(i) || !inside(j)) continue
    if (p[i * 3] === 0 && p[j * 3] === 0) continue
    ;(adj.get(i) ?? adj.set(i, []).get(i)!).push(j); (adj.get(j) ?? adj.set(j, []).get(j)!).push(i)
    tagOf.set(key, m.tag[fs[0]])
  }
  // Walk chains: start at ends and junctions, then at whatever cycles remain.
  const used = new Set<string>(), key = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`
  const turnCos = Math.cos(o.turn * Math.PI / 180)
  const lines: Line[] = []
  const walk = (start: number, next: number) => {
    const verts = [start, next]; used.add(key(start, next))
    for (;;) {
      const cur = verts[verts.length - 1], prev = verts[verts.length - 2], nb = adj.get(cur) ?? []
      if (nb.length !== 2) break
      const cand = nb.find(v => v !== prev && !used.has(key(cur, v)))
      if (cand === undefined) break
      const d0 = P(cur).map((x, i) => x - P(prev)[i]), d1 = P(cand).map((x, i) => x - P(cur)[i])
      if ((d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) / ((Math.hypot(...d0) * Math.hypot(...d1)) || 1) < turnCos) break
      used.add(key(cur, cand)); verts.push(cand)
    }
    let length = 0
    for (let i = 1; i < verts.length; i++) length += Math.hypot(...P(verts[i]).map((x, k) => x - P(verts[i - 1])[k]))
    if (length >= o.minLength) lines.push({verts, length, tag: tagOf.get(key(verts[0], verts[1]))!})
  }
  const starts = [...adj.keys()].sort((a, b) => ((adj.get(a)!.length === 2) as unknown as number) - ((adj.get(b)!.length === 2) as unknown as number))
  for (const s of starts) for (const t of adj.get(s)!) if (!used.has(key(s, t))) walk(s, t)
  return lines.sort((a, b) => b.length - a.length)
}

/** A copy of the mesh with the faces along each line retagged `tag`, for drawing. */
export function paintLines(m: TriMesh, lines: Line[], tag: number): TriMesh {
  const on = new Set<string>()
  for (const l of lines) for (let i = 1; i < l.verts.length; i++) { const a = l.verts[i - 1], b = l.verts[i]; on.add(a < b ? `${a},${b}` : `${b},${a}`) }
  const t = Uint8Array.from(m.tag)
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) { const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3]; if (on.has(a < b ? `${a},${b}` : `${b},${a}`)) t[f] = tag }
  return {pos: m.pos, tri: m.tri, tag: t}
}
