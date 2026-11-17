/**
 * Fit the canopy's section shape per station: slice the reference at each station and find the
 * exponents p and q of y = base + h (1 - |x / w|^p)^q that best fit the slice, with the
 * station's own width, base and crown. p sets how flat the crown is, q how straight the sides.
 *
 *     npx tsx tools/buggy-fit/parts/fit-canopy.ts
 */
import { loadReference } from '../reference'
import { CANOPY_STATIONS } from '../../../src/vehicles/buggygen/parts/canopy'
const r = loadReference().canopy, P = r.positions
for (const [z] of CANOPY_STATIONS.slice(1, -1)) {
  const pts: [number, number][] = []
  for (let t = 0; t < r.indices.length / 3; t++) for (let a = 0; a < 3; a++) {
    const i = r.indices[t * 3 + a] * 3, j = r.indices[t * 3 + (a + 1) % 3] * 3
    if ((P[i + 2] - z) * (P[j + 2] - z) <= 0 && P[i + 2] !== P[j + 2]) { const f = (z - P[i + 2]) / (P[j + 2] - P[i + 2]); pts.push([P[i] + (P[j] - P[i]) * f, P[i + 1] + (P[j + 1] - P[i + 1]) * f]) }
  }
  const w = Math.max(...pts.map(p => Math.abs(p[0]))), base = Math.min(...pts.map(p => p[1])), top = Math.max(...pts.map(p => p[1]))
  let best = [0, 0], bestErr = Infinity
  for (let p = 1.2; p <= 6; p += .05) for (let q = .3; q <= 1.5; q += .025) {
    let e = 0
    for (const [x, y] of pts) { const yy = base + (top - base) * Math.max(0, 1 - Math.abs(x / w) ** p) ** q; e += (yy - y) ** 2 }
    if (e < bestErr) { bestErr = e; best = [p, q] }
  }
  console.log(`[${z}, ${w.toFixed(3)}, ${base.toFixed(3)}, ${top.toFixed(3)}, ${best[0].toFixed(2)}, ${best[1].toFixed(2)}], // rms ${(Math.sqrt(bestErr / pts.length) * 1000).toFixed(1)} mm`)
}
