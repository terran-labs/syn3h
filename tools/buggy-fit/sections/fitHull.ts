/**
 * Fit the designed hull (src/vehicles/buggygen/sections/hull.ts) to the reference Body.
 *
 * 1. Slice the reference every 2 cm (the rear wing left out) and take the outermost outline
 *    points along rays from each slice's centre.
 * 2. Fit the nine section numbers to each slice by Nelder-Mead, warm started from the slice
 *    before, with weak priors where the cockpit leaves the deck without data.
 * 3. Fit each number's keys along Z by least squares with a bending penalty, so the tracks
 *    are smooth curves through a few keys rather than a copy of the sculpt's facets.
 *
 *   npx tsx tools/buggy-fit/sections/fitHull.ts [bend]     writes src/vehicles/buggygen/sections/dataHull.ts
 */
import { readMesh, triangles, REF } from './glb'
import { sliceZ } from './slice'
import { HULL_PARAMS, outline, paramsAt, type Arches } from '../../../src/vehicles/buggygen/sections/hull'
import { crRows } from '../../../src/vehicles/buggygen/sections/loft'
import { writeFileSync } from 'node:fs'

const ref = triangles(readMesh(REF, 'Body'))
const isWing = (y: number, z: number) => z > 1.5 && y > .885
const keep: number[] = []
for (let t = 0; t < ref.tri.length / 9; t++) {
  const o = t * 9; let wing = true
  for (let k = 0; k < 3; k++) if (!isWing(ref.tri[o + k * 3 + 1], ref.tri[o + k * 3 + 2])) wing = false
  if (!wing) for (let k = 0; k < 9; k++) keep.push(ref.tri[o + k])
}
const hull = new Float32Array(keep)

/** Outermost points of a slice along 72 rays from its centre (right half, mirrored data folded in). */
function samples(z: number): number[][] {
  const segs = sliceZ(hull, z).filter(s => !isWing(s[1], z) && !isWing(s[3], z))
  let lo = 9, hi = -9; for (const s of segs) { lo = Math.min(lo, s[1], s[3]); hi = Math.max(hi, s[1], s[3]) }
  const yc = (lo + hi) / 2, out: number[][] = []
  for (let i = 0; i < 72; i++) {
    const a = ((i + .5) / 72 - .5) * Math.PI, dx = Math.cos(a), dy = Math.sin(a); let best = NaN
    for (const [x0, y0, x1, y1] of segs) for (const sx of [1, -1]) {
      const ax = sx * x0, ay = y0 - yc, ex = sx * x1 - ax, ey = y1 - y0, den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-12) continue
      const t = (ax * ey - ay * ex) / den, s = (ax * dy - ay * dx) / den
      if (t > 0 && s >= 0 && s <= 1 && !(t <= best)) best = t
    }
    if (Number.isFinite(best)) out.push([best * dx, yc + best * dy, 1])
  }
  // Weight the outer upper corner: the fender peaks and haunch fins are thin, so an even
  // weighting lets the fit round them off, and they carry much of the body's character.
  let xmax = 0; for (const [x] of out) xmax = Math.max(xmax, x)
  for (const p of out) if (p[1] > yc) p[2] = 1 + CORNER * Math.max(0, (p[0] - .75 * xmax) / (.25 * xmax)) ** 2
  return out
}
const CORNER = Number(process.argv[4] ?? 6)

function cost(q: number[], pts: number[][]): number {
  const [floorY, floorW, width, widestY, shoulderX, shoulderY, valleyX, valleyY, crownY] = q
  // Keep the points in order and apart, so no segment collapses into a sliver.
  if (floorW < .05 || width < floorW + .03 || shoulderX > width - .006 || shoulderX < .1 || valleyX > shoulderX - .05 || valleyX < .04 || widestY < floorY + .03 || shoulderY < widestY + .02 || floorY > widestY) return 1e9
  if (q.some(v => v < -.3 || v > 1.2)) return 1e9
  const f = outline(q), poly = Array.from({ length: 61 }, (_, i) => f(i / 60))
  // Both ways: reference points to the model outline, and model points to the reference
  // outline (its samples joined in angle order), so the model can neither miss nor bloat.
  const d2 = (list: number[][], px: number, py: number) => {
    let best = 1e9
    for (let i = 0; i < list.length - 1; i++) {
      const [ax, ay] = list[i], [bx, by] = list[i + 1], ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey || 1e-12
      const t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / l)); best = Math.min(best, (px - ax - ex * t) ** 2 + (py - ay - ey * t) ** 2)
    }
    return best
  }
  let sum = 0, wsum = 0
  for (const [px, py, w] of pts) { sum += w * d2(poly, px, py); wsum += w }
  let back = 0
  for (const [px, py] of poly) back += Math.min(d2(pts, px, py), .02)
  sum = sum / Math.max(wsum, 1) + back / poly.length
  // Weak priors: a deck with no data (the cockpit) stays level between valley and crown.
  return sum + 2e-4 * ((crownY - valleyY) ** 2 + (valleyX - shoulderX * .5) ** 2)
}

function nelderMead(f: (x: number[]) => number, x0: number[], iters: number): number[] {
  let pts = [x0, ...x0.map((_, i) => x0.map((v, k) => k === i ? v + .03 : v))].map(x => ({ x, f: f(x) }))
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

// 1 and 2: slices every 4 cm, and a hand-placed starting design (read off the slice sheet).
const KEYS = [-1.95, -1.8, -1.6, -1.3, -.9, -.3, .3, .8, 1.2, 1.5, 1.75, 1.965]
const START = [
  [.22, .08, .15, .26, .12, .3, .05, .3, .31], [.1, .4, .55, .25, .5, .45, .25, .42, .45], [.02, .5, .74, .45, .7, .55, .3, .48, .5],
  [-.02, .6, .85, .5, .82, .6, .35, .5, .5], [-.06, .68, .86, .55, .83, .66, .35, .64, .66], [-.07, .68, .8, .55, .77, .68, .35, .67, .68],
  [-.08, .75, .93, .4, .78, .78, .4, .76, .78], [-.08, .7, .86, .45, .75, .8, .4, .78, .86], [-.06, .68, .87, .45, .78, .76, .45, .7, .76],
  [.02, .62, .84, .5, .76, .84, .45, .67, .68], [.2, .55, .76, .5, .7, .86, .45, .69, .7], [.45, .45, .66, .55, .6, .7, .4, .68, .7],
]
const bend = Number(process.argv[2] ?? 5), prior = Number(process.argv[3] ?? 1)
const slices: { z: number; u: number; pts: number[][] }[] = []
const uOf = (z: number) => { let i = 0; while (i < KEYS.length - 2 && z > KEYS[i + 1]) i++; return (i + Math.min(1, Math.max(0, (z - KEYS[i]) / (KEYS[i + 1] - KEYS[i])))) / (KEYS.length - 1) }
for (let z = -1.93; z <= 1.955; z += .04) { const pts = samples(z); if (pts.length >= 10) slices.push({ z, u: uOf(z), pts }) }
const keys = START.map(r => [...r]), n = KEYS.length
// Wheel arches and flank: amounts fitted with the keys; positions and lengths are design choices.
const arches: Arches = { front: 0, rear: 0, flank: 0, frontZ: -1.24, rearZ: 1.24, flankZ: .15, length: .5, flankLength: .45 }
const design = () => ({ z: KEYS, values: Object.fromEntries(HULL_PARAMS.map((p, i) => [p, keys.map(r => r[i])])) as Record<typeof HULL_PARAMS[number], number[]>, arches })
const sliceCost = (s: typeof slices[number]) => cost(paramsAt(design(), s.z), s.pts)
const costs = slices.map(sliceCost)
/** Bending of one parameter's track: squared second differences of its keys. */
const bending = (p: number) => { let b = 0; for (let k = 1; k < n - 1; k++) b += (keys[k - 1][p] - 2 * keys[k][p] + keys[k + 1][p]) ** 2; let a = 0; for (let k = 0; k < n; k++) a += (keys[k][p] - START[k][p]) ** 2; return bend * b + prior * a }
// 3: coordinate descent on every key. A key moves only the slices within two spans of it.
const near = keys.map((_, k) => slices.map((s, i) => [s, i] as const).filter(([s]) => Math.abs(s.u * (n - 1) - k) < 2))
for (const step of [.03, .015, .007, .003]) for (let sweep = 0; sweep < 3; sweep++) for (let k = 0; k < n; k++) for (let p = 0; p < HULL_PARAMS.length; p++) {
  const local = () => near[k].reduce((t, [s]) => t + sliceCost(s), 0) + bending(p)
  let best = local(); const v0 = keys[k][p]
  for (const d of [step, -step]) {
    keys[k][p] = v0 + d; const c = local()
    if (c < best) { best = c; let v = keys[k][p]; while (true) { keys[k][p] = v + d; const c2 = local(); if (c2 < best) { best = c2; v = keys[k][p] } else { keys[k][p] = v; break } } break }
    keys[k][p] = v0
  }
}
// The three bulge amounts, against every slice.
for (const step of [.02, .01, .005, .002]) for (let sweep = 0; sweep < 2; sweep++) for (const a of ['front', 'rear', 'flank'] as const) {
  const all = () => slices.reduce((t, s) => t + sliceCost(s), 0)
  let best = all(); const v0 = arches[a]
  for (const d of [step, -step]) { arches[a] = v0 + d; const c = all(); if (c < best) { best = c; break } arches[a] = v0 }
}
const total = slices.reduce((t, s) => t + sliceCost(s), 0) / slices.length
console.log(`mean slice cost ${total.toExponential(2)} (start ${(costs.reduce((a, b) => a + b, 0) / slices.length).toExponential(2)}), rms about ${(Math.sqrt(total / 2) * 1000).toFixed(0)} mm`)
const values: Record<string, number[]> = {}
HULL_PARAMS.forEach((name, p) => { values[name] = keys.map(r => Math.round(r[p] * 1000) / 1000) })

const file = new URL('../../../src/vehicles/buggygen/sections/dataHull.ts', import.meta.url)
writeFileSync(file, `import type { HullKeys } from './hull'

/**
 * The hull's keys, fitted by tools/buggy-fit/sections/fitHull.ts (bend ${bend}, prior ${prior}) and then free to
 * edit by hand: ${HULL_PARAMS.length} section numbers at ${KEYS.length} stations along Z, metres, plus the
 * wheel arch and flank bulges. Corner peaks weighted ${CORNER}.
 */
export const HULL: HullKeys = {
  z: ${JSON.stringify(KEYS)},
  values: {
${HULL_PARAMS.map(p => `    ${p}: ${JSON.stringify(values[p])},`).join('\n')}
  },
  arches: ${JSON.stringify(Object.fromEntries(Object.entries(arches).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))},
}
`)
console.log('arches', JSON.stringify(arches))
for (const p of HULL_PARAMS) console.log(p.padEnd(10), values[p].join(' '))
