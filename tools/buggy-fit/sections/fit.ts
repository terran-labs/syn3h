/**
 * Fit the section lofts to the reference Body and write the shipped data files.
 *
 *   npx tsx tools/buggy-fit/sections/fit.ts sweep     # Level B error against station and radius counts
 *   npx tsx tools/buggy-fit/sections/fit.ts write S K # write dataA.ts and dataB.ts (B with S stations, K radii)
 *
 * Level A: per station, Nelder-Mead on a superellipse (half width, top, bottom, centre,
 * exponent) against the slice's outline points. Level B: one linear least squares problem for
 * all radii at once, since a Catmull-Rom blend of Catmull-Rom outlines is linear in the radii.
 * Offline only.
 */
import { readMesh, triangles, REF } from './glb'
import { sliceZ } from './slice'
import { score, line } from './measure'
import { crRows, polarSections, superSections, skin, DETAIL, byRole, type Tagger } from '../../../src/vehicles/buggygen/sections/loft'
import { writeFileSync } from 'node:fs'

const ref = triangles(readMesh(REF, 'Body'))
/** The rear wing is its own piece; leave it out of the hull's slices. */
const isWing = (y: number, z: number) => z > 1.5 && y > .885
const hull = (() => {
  const keep: number[] = []
  for (let t = 0; t < ref.tri.length / 9; t++) {
    const o = t * 9; let wing = true
    for (let k = 0; k < 3; k++) if (!isWing(ref.tri[o + k * 3 + 1], ref.tri[o + k * 3 + 2])) wing = false
    if (!wing) for (let k = 0; k < 9; k++) keep.push(ref.tri[o + k])
  }
  return new Float32Array(keep)
})()
export const Z0 = -1.95, Z1 = 1.965

/** A hull slice: its centre height and the outermost radius along rays at the given v values (NaN where nothing is hit). */
function slice(z: number, vs: number[]): { yc: number; r: number[]; segs: number[][] } {
  const segs = sliceZ(hull, z).filter(s => !isWing(s[1], z) && !isWing(s[3], z))
  let lo = 9, hi = -9; for (const s of segs) { lo = Math.min(lo, s[1], s[3]); hi = Math.max(hi, s[1], s[3]) }
  const yc = (lo + hi) / 2
  const r = vs.map(v => rayFrom(segs, yc, v))
  return { yc, r, segs }
}

/** Weights of each row in crRows at u: crRows over one-hot rows. */
const weights = (n: number, u: number, mirror = false) => crRows(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, k) => +(i === k))), u, mirror)

/** Solve A x = b in place (Gaussian elimination with partial pivoting). */
function solve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c] }
  }
  const x = new Float64Array(n); for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r] }
  return x
}

/** Station positions: evenly spread in a parameter that crowds them toward nose and tail. */
export function stationZ(S: number): number[] {
  return Array.from({ length: S }, (_, j) => { const t = j / (S - 1); return Z0 + (Z1 - Z0) * (t - .55 * Math.sin(2 * Math.PI * t) / (2 * Math.PI)) })
}

/** u at which the Catmull-Rom of station z values reaches z. */
function uOf(zs: number[], z: number): number {
  let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (crRows(zs.map(v => [v]), m)[0] < z) lo = m; else hi = m }
  return (lo + hi) / 2
}

/** Level B: rows [z, yc, r0..rK-1] fitted by least squares. */
export function fitB(S: number, K: number, lambda = 3e-3): number[][] {
  const zs = stationZ(S), M = 72, vs = Array.from({ length: M }, (_, i) => (i + .5) / M)
  const dense: { u: number; yc: number; segs: number[][] }[] = []
  for (let z = Z0 + .004; z < Z1 - .002; z += .02) { const s = slice(z, []); if (s.segs.length) dense.push({ u: uOf(zs, z), yc: s.yc, segs: s.segs }) }
  // Station centres: least squares in u.
  const Ay = Array.from({ length: S }, () => new Float64Array(S)), by = new Float64Array(S)
  for (const d of dense) { const w = weights(S, d.u); for (let a = 0; a < S; a++) { by[a] += w[a] * d.yc; for (let b = 0; b < S; b++) Ay[a][b] += w[a] * w[b] } }
  for (let a = 0; a < S; a++) Ay[a][a] += 1e-6
  const yc = solve(Ay, by)
  const wv = vs.map(v => weights(K, v, true)), n = S * K
  const A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n)
  for (const d of dense) {
    const wu = weights(S, d.u), y = crRows([...yc].map(v => [v]), d.u)[0]
    // Measure radii about the blended centre, which is the one the generator draws from.
    vs.forEach((v, m) => {
      const target = rayFrom(d.segs, y, v)
      if (!Number.isFinite(target)) return
      const idx: number[] = [], val: number[] = []
      for (let j = 0; j < S; j++) if (wu[j]) for (let k = 0; k < K; k++) if (wv[m][k]) { idx.push(j * K + k); val.push(wu[j] * wv[m][k]) }
      for (let p = 0; p < idx.length; p++) { b[idx[p]] += val[p] * target; for (let q = 0; q < idx.length; q++) A[idx[p]][idx[q]] += val[p] * val[q] }
    })
  }
  // Smoothness: second differences across stations and around the outline.
  const reg = (terms: [number, number][]) => { for (const [p, a] of terms) for (const [q, c] of terms) A[p][q] += lambda * a * c }
  for (let j = 0; j < S; j++) for (let k = 1; k < K - 1; k++) reg([[j * K + k - 1, 1], [j * K + k, -2], [j * K + k + 1, 1]])
  for (let j = 1; j < S - 1; j++) for (let k = 0; k < K; k++) reg([[(j - 1) * K + k, 1], [j * K + k, -2], [(j + 1) * K + k, 1]])
  for (let p = 0; p < n; p++) A[p][p] += 1e-7
  const c = solve(A, b)
  return zs.map((z, j) => [z, yc[j], ...Array.from({ length: K }, (_, k) => c[j * K + k])])
}

/** Outermost hit of a ray from (0, yc) at outline parameter v against the segments and their mirror. */
function rayFrom(segs: number[][], yc: number, v: number): number {
  const a = (v - .5) * Math.PI, dx = Math.cos(a), dy = Math.sin(a); let best = NaN
  for (const [x0, y0, x1, y1] of segs) for (const sx of [1, -1]) {
    const ax = sx * x0, ay = y0 - yc, ex = sx * x1 - ax, ey = y1 - y0, den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-12) continue
    const t = (ax * ey - ay * ex) / den, s = (ax * dy - ay * dx) / den
    if (t > 0 && s >= 0 && s <= 1 && !(t <= best)) best = t
  }
  return best
}

/** Level A: superellipse rows fitted per station by Nelder-Mead to the slice outline. */
export function fitA(zs: number[]): number[][] {
  return zs.map(z => {
    const zz = Math.min(Math.max(z, Z0 + .01), Z1 - .01), s = slice(zz, Array.from({ length: 48 }, (_, i) => (i + .5) / 48))
    const pts = s.r.map((r, i) => { const a = ((i + .5) / 48 - .5) * Math.PI; return Number.isFinite(r) ? [r * Math.cos(a), s.yc + r * Math.sin(a)] : null }).filter(Boolean) as number[][]
    let ymin = 9, ymax = -9; for (const [, py] of pts) { ymin = Math.min(ymin, py); ymax = Math.max(ymax, py) }
    const y = (ymin + ymax) / 2
    const err = (q: number[]) => {
      const [w, t, b, e, eb] = q; if (w <= 0 || t <= 0 || b <= 0 || e < 1.2 || e > 8 || eb < 1.2 || eb > 8) return 1e9
      const row = [z, w, t, b, y, e, eb], sec = superSections([row, row])(0).half, poly = Array.from({ length: 97 }, (_, i) => sec(i / 96))
      let sum = 0
      for (const [px, py] of pts) {
        let best = 1e9
        for (let i = 0; i < poly.length - 1; i++) {
          const [ax, ay] = poly[i], [bx, by] = poly[i + 1], ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey || 1e-12
          const f = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / l)); best = Math.min(best, (px - ax - ex * f) ** 2 + (py - ay - ey * f) ** 2)
        }
        sum += best
      }
      return sum / Math.max(pts.length, 1)
    }
    let xmax = .05; for (const [px] of pts) xmax = Math.max(xmax, px)
    const [w, t, b, e, eb] = nelderMead(err, [xmax, (ymax - ymin) / 2, (ymax - ymin) / 2, 3, 3])
    return [z, w, t, b, y, e, eb]
  })
}

function nelderMead(f: (x: number[]) => number, x0: number[], iters = 600): number[] {
  let pts = [x0, ...x0.map((_, i) => x0.map((v, k) => k === i ? v * 1.15 + .02 : v))].map(x => ({ x, f: f(x) }))
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f)
    const n = x0.length, c = x0.map((_, k) => pts.slice(0, n).reduce((s, p) => s + p.x[k], 0) / n), w = pts[n]
    const at = (t: number) => c.map((v, k) => v + t * (w.x[k] - v)), r = at(-1), fr = f(r)
    if (fr < pts[0].f) { const e = at(-2), fe = f(e); pts[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr } }
    else if (fr < pts[n - 1].f) pts[n] = { x: r, f: fr }
    else { const k = at(.5), fk = f(k); if (fk < w.f) pts[n] = { x: k, f: fk }; else pts = pts.map((p, i) => i ? { x: p.x.map((v, q) => pts[0].x[q] + .5 * (v - pts[0].x[q])), f: 0 } : p).map(p => ({ x: p.x, f: f(p.x) })) }
  }
  pts.sort((a, b) => a.f - b.f); return pts[0].x
}

/** Underside chrome, everything else paint: the plain tagging levels A and B share. */
export const plain: Tagger = (_x, _y, _z, ny) => ny < -.7 ? 'chrome' : 'paint'

const q = (rows: number[][]) => rows.map(r => r.map(v => Math.round(v * 1000)))
const mode = process.argv[2]
if (mode === 'sweep') {
  for (const S of [8, 12, 16, 24, 32]) for (const K of [7, 11, 15, 21]) {
    const rows = q(fitB(S, K)).map(r => r.map(v => v / 1000))
    const cand = { id: `B S${S} K${K}`, numbers: S * (K + 2), build: (d: 0 | 1 | 2) => byRole(skin(polarSections(rows), DETAIL[d][0], DETAIL[d][1], plain)) }
    console.log(line(score(cand, `sweepB-${S}-${K}`, '')))
  }
} else if (mode === 'write') {
  const S = +process.argv[3], K = +process.argv[4]
  const head = (what: string) => `// Fitted by tools/buggy-fit/sections/fit.ts from the reference Body. ${what}\n// Millimetres, integers; the generator divides by 1000.\n`
  writeFileSync(new URL('../../../src/vehicles/buggygen/sections/dataB.ts', import.meta.url), head(`Level B: ${S} stations of [z, centreY, ${K} radii from straight down to straight up].`) + `export const B_ROWS = ${JSON.stringify(q(fitB(S, K)))}\n`)
  const zA = [-1.95, -1.78, -1.45, -.95, -.2, .45, 1.05, 1.5, 1.965]
  writeFileSync(new URL('../../../src/vehicles/buggygen/sections/dataA.ts', import.meta.url), head('Level A: hull rows [z, halfWidth, top, bottom, centreY, exponent, bottomExponent].') + `export const A_ROWS = ${JSON.stringify(q(fitA(zA)))}\n`)
}
