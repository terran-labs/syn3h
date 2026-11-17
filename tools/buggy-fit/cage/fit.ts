// Fits half cage points so the subdivided surface lands on the reference. Not shipped.
//
// Measured on 16 November 2026: the reverse pairs (`reverse` > 0) make every round after the
// first worse for cages of 120 points and up, so the build uses them only for the 60 point
// cage, where they win by about 1 mm. The neighbour pull (`fair`) shrinks the body; leave it 0.
//
// Subdivision is linear, so the fine surface is S * cage. Each round pairs every fine vertex
// with its nearest reference point of the same role, and every reference sample with its
// nearest fine vertex, then solves the weighted least squares for the half cage (with a small
// pull toward the previous cage) by conjugate gradients. Mirror plane vertices keep x = 0.
import {loopStep, type Stencil} from '../../../src/vehicles/buggygen/cage/subdivide'
import {fullCage, type CageData} from '../../../src/vehicles/buggygen/cage/generator'
import {TriGrid, sample, distance, type TriMesh} from './geom'

/** Rows of S in terms of the half cage unknowns: [half index, weight, sign of x]. */
function halfStencil(d: CageData, levels: number) {
  const n = d.v.length / 3, full = fullCage(d)
  // full vertex -> half vertex and mirror sign
  const owner: number[] = [], sign: number[] = []
  for (let i = 0; i < n; i++) { owner.push(i); sign.push(1) }
  for (let i = 0; i < n; i++) if (d.v[i * 3] !== 0) { owner.push(i); sign.push(-1) }
  let rows: Map<number, number>[] = owner.map((_, j) => new Map([[j, 1]]))
  let faces = Uint32Array.from(full.faces), tags = Uint8Array.from(full.tags), creases = Uint32Array.from(full.creases), count = owner.length
  for (let l = 0; l < levels; l++) {
    const step = loopStep(count, faces, tags, creases), s: Stencil = step.stencil
    const next: Map<number, number>[] = []
    for (let i = 0; i < s.rows; i++) {
      const m = new Map<number, number>()
      for (let k = s.start[i]; k < s.start[i + 1]; k++) for (const [j, w] of rows[s.index[k]]) m.set(j, (m.get(j) ?? 0) + w * s.weight[k])
      next.push(m)
    }
    rows = next; faces = step.faces; tags = step.tags; creases = step.creases; count = s.rows
  }
  // Fold full cage columns onto half unknowns.
  const out = rows.map(m => [...m].map(([j, w]) => [owner[j], w, sign[j]] as [number, number, number]))
  return {rows: out, faces, tags}
}

function apply(rows: [number, number, number][][], h: Float64Array): Float64Array {
  const out = new Float64Array(rows.length * 3)
  rows.forEach((r, i) => { for (const [j, w, s] of r) { out[i * 3] += w * s * h[j * 3]; out[i * 3 + 1] += w * h[j * 3 + 1]; out[i * 3 + 2] += w * h[j * 3 + 2] } })
  return out
}

export function fitCage(d: CageData, ref: TriMesh, grid: TriGrid, opts: { levels?: number; rounds?: number; reverse?: number; smooth?: number; fair?: number; log?: boolean } = {}): CageData {
  const levels = opts.levels ?? 2, rounds = opts.rounds ?? 8, reverseW = opts.reverse ?? 1, lambda = opts.smooth ?? 1e-3
  const {rows, faces, tags} = halfStencil(d, levels)
  const vertexTag: number[] = new Array(rows.length).fill(-1)
  for (let f = 0; f < tags.length; f++) for (let k = 0; k < 3; k++) if (vertexTag[faces[f * 3 + k]] < 0) vertexTag[faces[f * 3 + k]] = tags[f]
  const n = d.v.length / 3, h = Float64Array.from(d.v, x => x / 1000)
  const seam = d.v.map((x, i) => i % 3 === 0 && x === 0)
  const refSamples = sample(ref, 30000, 3)
  const score = (hh: Float64Array) => distance(ref, {pos: apply(rows, hh), tri: faces, tag: tags}, grid, 6000).meanMm
  let best = Float64Array.from(h), bestScore = score(h)
  for (let round = 0; round < rounds; round++) {
    const fine = apply(rows, h), F = rows.length
    // Fine vertex normals, area weighted, to keep matches on the facing side of thin parts.
    const vn = new Float64Array(F * 3)
    for (let f = 0; f < faces.length / 3; f++) {
      const [a, b, c] = [0, 1, 2].map(k => faces[f * 3 + k] * 3)
      const u = [fine[b] - fine[a], fine[b + 1] - fine[a + 1], fine[b + 2] - fine[a + 2]], v = [fine[c] - fine[a], fine[c + 1] - fine[a + 1], fine[c + 2] - fine[a + 2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      for (const o of [a, b, c]) { vn[o] += n[0]; vn[o + 1] += n[1]; vn[o + 2] += n[2] }
    }
    const nrm = (i: number) => { const l = Math.hypot(vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]) || 1; return [vn[i * 3] / l, vn[i * 3 + 1] / l, vn[i * 3 + 2] / l] }
    // Equations: fine vertex i should sit at target, with weight.
    const target = new Float64Array(F * 3), weight = new Float64Array(F)
    for (let i = 0; i < F; i++) {
      // Only the x >= 0 half carries independent information.
      if (fine[i * 3] < -1e-6) continue
      // Tag of the fine vertex: any face using it would do; use the first.
      const r = grid.nearest([fine[i * 3], fine[i * 3 + 1], fine[i * 3 + 2]], vertexTag[i], 40, nrm(i))
      target[i * 3] += r.point[0]; target[i * 3 + 1] += r.point[1]; target[i * 3 + 2] += r.point[2]; weight[i] += 1
    }
    // Reverse pairs: reference samples pull their nearest fine vertex.
    const cell = new Map<string, number[]>(), hc = .05, ck = (p: number[]) => p.map(x => Math.floor(x / hc)).join(',')
    for (let i = 0; i < F; i++) if (fine[i * 3] >= -1e-6) { const k = ck([fine[i * 3], fine[i * 3 + 1], fine[i * 3 + 2]]); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i) }
    for (let s = 0; s < refSamples.pts.length; s++) {
      const p = refSamples.pts[s]; if (p[0] < 0) continue
      const c = p.map(x => Math.floor(x / hc)); let best = -1, bd = Infinity
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const i of cell.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
        if (vertexTag[i] !== ref.tag[refSamples.tri[s]]) continue
        const q = nrm(i), t = refSamples.tri[s]
        if (q[0] * grid.normals[t * 3] + q[1] * grid.normals[t * 3 + 1] + q[2] * grid.normals[t * 3 + 2] < .2) continue
        const dd = Math.hypot(fine[i * 3] - p[0], fine[i * 3 + 1] - p[1], fine[i * 3 + 2] - p[2]); if (dd < bd) { bd = dd; best = i }
      }
      if (best < 0) continue
      target[best * 3] += reverseW * p[0]; target[best * 3 + 1] += reverseW * p[1]; target[best * 3 + 2] += reverseW * p[2]; weight[best] += reverseW
    }
    for (let i = 0; i < F; i++) if (weight[i]) for (let k = 0; k < 3; k++) target[i * 3 + k] /= weight[i]
    // Normal equations per axis: (A^T W A + lambda I) h = A^T W t + lambda h0, solved by CG.
    // The pull target blends each point's previous place with its neighbours' average
    // (`fair`, 0 to 1), which irons out wrinkles the matching alone would leave.
    const fair = opts.fair ?? 0, h0 = Float64Array.from(h)
    if (fair > 0) {
      const sum = new Float64Array(n * 3), cnt = new Float64Array(n)
      for (let f = 0; f < d.f.length; f += 3) for (let k = 0; k < 3; k++) {
        const a = d.f[f + k], b = d.f[f + (k + 1) % 3]
        for (const [u, v] of [[a, b], [b, a]]) { for (let c = 0; c < 3; c++) sum[u * 3 + c] += h[v * 3 + c]; cnt[u]++ }
      }
      for (let j = 0; j < n; j++) if (cnt[j]) for (let c = 0; c < 3; c++) h0[j * 3 + c] = (1 - fair) * h[j * 3 + c] + fair * sum[j * 3 + c] / cnt[j]
    }
    for (let axis = 0; axis < 3; axis++) {
      const mul = (x: Float64Array) => {
        const out = new Float64Array(n)
        for (let i = 0; i < F; i++) {
          if (!weight[i]) continue
          let v = 0; for (const [j, w, s] of rows[i]) v += w * (axis === 0 ? s : 1) * x[j]
          v *= weight[i]
          for (const [j, w, s] of rows[i]) out[j] += w * (axis === 0 ? s : 1) * v
        }
        for (let j = 0; j < n; j++) { out[j] += lambda * x[j]; if (axis === 0 && seam[j * 3]) out[j] = x[j] }
        return out
      }
      const b = new Float64Array(n)
      for (let i = 0; i < F; i++) if (weight[i]) for (const [j, w, s] of rows[i]) b[j] += w * (axis === 0 ? s : 1) * weight[i] * target[i * 3 + axis]
      for (let j = 0; j < n; j++) { b[j] += lambda * h0[j * 3 + axis]; if (axis === 0 && seam[j * 3]) b[j] = 0 }
      const x = Float64Array.from({length: n}, (_, j) => h[j * 3 + axis])
      const Ax = mul(x), r = b.map((v, j) => v - Ax[j]), p = Float64Array.from(r)
      let rr = r.reduce((s, v) => s + v * v, 0)
      for (let it = 0; it < 200 && rr > 1e-16; it++) {
        const Ap = mul(p), alpha = rr / p.reduce((s, v, j) => s + v * Ap[j], 0)
        for (let j = 0; j < n; j++) { x[j] += alpha * p[j]; r[j] -= alpha * Ap[j] }
        const rr2 = r.reduce((s, v) => s + v * v, 0)
        for (let j = 0; j < n; j++) p[j] = r[j] + rr2 / rr * p[j]
        rr = rr2
      }
      for (let j = 0; j < n; j++) h[j * 3 + axis] = x[j]
    }
    const sc = score(h)
    if (sc < bestScore) { bestScore = sc; best = Float64Array.from(h) }
    if (opts.log) {
      let s = 0, c = 0
      const f2 = apply(rows, h)
      for (let i = 0; i < F; i += 7) if (f2[i * 3] >= 0) { s += grid.nearest([f2[i * 3], f2[i * 3 + 1], f2[i * 3 + 2]]).dist; c++ }
      console.log(`  round ${round}: mean fine to reference ${(s / c * 1000).toFixed(2)} mm`)
    }
  }
  h.set(best)
  return {...d, v: Array.from(h, (x, i) => i % 3 === 0 && seam[i] ? 0 : Math.round(x * 1000))}
}
