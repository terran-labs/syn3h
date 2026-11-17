/**
 * Fit each headlight lens of the reference Sockets: the lens is three parallel rings of 14
 * points (bezel inner edge, lens shoulder, lens crown) on one axis. Takes the Headlights faces
 * on each side, finds the axis from the rings' planes, the centre from the largest ring, and the
 * ellipse half sizes in the lens plane, then checks the two sides agree by mirror symmetry.
 *
 *     npx tsx tools/buggy-fit/parts/fit-lenses.ts
 */
import { loadReference } from '../reference'
type V = [number, number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V): V => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l] }
const mean = (ps: V[]): V => ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0] as V)

/** Normal of the least squares plane: smallest eigenvector of the covariance, by inverse iteration. */
function planeNormal(ps: V[]): V {
  const c = mean(ps), m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of ps) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j] }
  // Inverse iteration with a tiny shift, solved by Cramer's rule.
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const a = m.map((r, i) => r.map((v, j) => v + (i === j ? 1e-9 : 0)))
  let v: V = [1, 1, 1]
  for (let it = 0; it < 30; it++) {
    const D = det(a), out: number[] = []
    for (let k = 0; k < 3; k++) out.push(det(a.map((r, i) => r.map((x, j) => j === k ? v[i] : x))) / D)
    v = unit(out as V)
  }
  return v
}

export function fitLens(side: 1 | -1) {
  const r = loadReference().sockets, P = r.positions
  const ids = new Set<number>()
  for (let t = 0; t < r.indices.length / 3; t++) if (/head/i.test(r.materials[t])) for (let k = 0; k < 3; k++) { const i = r.indices[t * 3 + k]; if (Math.sign(P[i * 3]) === side) ids.add(i) }
  const key = (i: number) => `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`
  const uniq = new Map<string, V>(); for (const i of ids) uniq.set(key(i), [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])
  const pts = [...uniq.values()]
  // First axis guess from everything, then split into rings by height along it and refit on the widest ring.
  let n = planeNormal(pts)
  if (n[2] > 0) n = [-n[0], -n[1], -n[2]] // lenses face forward, toward -Z
  const c0 = mean(pts)
  const byRadius = pts.map(p => ({ p, r: Math.hypot(...sub(sub(p, c0), n.map(x => x * dot(sub(p, c0), n)) as V)) })).sort((a, b) => b.r - a.r)
  const ring = byRadius.slice(0, 14).map(o => o.p)
  n = planeNormal(ring); if (n[2] > 0) n = [-n[0], -n[1], -n[2]]
  // build.py places this ring 0.018 m out from the seat centre.
  const centre = sub(mean(ring), n.map(x => x * .018) as V)
  const right = unit(cross(n, [0, 1, 0])), up = cross(right, n)
  const rx = Math.max(...ring.map(p => Math.abs(dot(sub(p, centre), right)))), rz = Math.max(...ring.map(p => Math.abs(dot(sub(p, centre), up))))
  const planarity = Math.max(...ring.map(p => Math.abs(dot(sub(p, mean(ring)), n))))
  return { centre, axis: n, rx, rz, planarity, points: pts.length }
}

if (process.argv[1]?.endsWith('fit-lenses.ts')) {
  const a = fitLens(1), b = fitLens(-1)
  const f = (v: number[]) => v.map(x => x.toFixed(4)).join(' ')
  for (const [s, o] of [['right', a], ['left', b]] as const) console.log(s, 'points', o.points, 'centre', f(o.centre), 'axis', f(o.axis), 'rx', o.rx.toFixed(4), 'rz', o.rz.toFixed(4), 'planarity mm', (o.planarity * 1000).toFixed(2))
  const mirror = Math.hypot(a.centre[0] + b.centre[0], a.centre[1] - b.centre[1], a.centre[2] - b.centre[2])
  const axisErr = Math.acos(Math.min(1, -a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2])) * 180 / Math.PI
  console.log('mirror mismatch: centre', (mirror * 1000).toFixed(2), 'mm, axis', axisErr.toFixed(3), 'deg')
}
