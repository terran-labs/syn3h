/**
 * Builds a wordmark from strokes and shapes merged in a signed distance field, then traces
 * the field's zero line back into polygons. This is how the Mira candidates get smooth
 * strokes that join, overlap, taper and cross without hand-made boolean geometry: strokes
 * union by taking the smaller distance, gaps cut by taking the larger of a shape and the
 * negated cutter. The result is plain closed contours, as the logo renderer wants.
 *
 * Coordinates are path units, y down. Run at build time (tools/brand/mira-round2.ts), not in
 * the game: tracing a word takes a moment.
 */
import { type Contour, type P, signedDistanceTo } from './geom'

export type Cap = 'round' | 'butt'
export interface Stroke {
  points: P[]
  /** Width, one value for all or one per point (tapering). */
  width: number | number[]
  start?: Cap
  end?: Cap
}

export class Field {
  readonly nx: number; readonly ny: number
  readonly v: Float32Array
  constructor(readonly x0: number, readonly y0: number, x1: number, y1: number, readonly cell: number) {
    this.nx = Math.ceil((x1 - x0) / cell) + 3; this.ny = Math.ceil((y1 - y0) / cell) + 3
    this.v = new Float32Array(this.nx * this.ny).fill(1e6)
  }
  /** A blank field the same size, for a part that is cut separately. */
  blank(): Field { const f = Object.create(Field.prototype) as Field; Object.assign(f, { x0: this.x0, y0: this.y0, cell: this.cell, nx: this.nx, ny: this.ny, v: new Float32Array(this.nx * this.ny).fill(1e6) }); return f }

  private each(bx0: number, by0: number, bx1: number, by1: number, fn: (x: number, y: number, k: number) => void): void {
    const c = this.cell
    const i0 = Math.max(0, Math.floor((bx0 - this.x0) / c) - 2), i1 = Math.min(this.nx - 1, Math.ceil((bx1 - this.x0) / c) + 2)
    const j0 = Math.max(0, Math.floor((by0 - this.y0) / c) - 2), j1 = Math.min(this.ny - 1, Math.ceil((by1 - this.y0) / c) + 2)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(this.x0 + i * c, this.y0 + j * c, j * this.nx + i)
  }
  /** Adds a shape given by its distance function and a box it lies inside. */
  add(box: [number, number, number, number], d: (x: number, y: number) => number): this {
    this.each(...box, (x, y, k) => { const s = d(x, y); if (s < this.v[k]) this.v[k] = s }); return this
  }
  /** Removes a shape from what is there. */
  cut(box: [number, number, number, number], d: (x: number, y: number) => number): this {
    this.each(...box, (x, y, k) => { const s = -d(x, y); if (s > this.v[k]) this.v[k] = s }); return this
  }
  /** Removes another field's shape (grown by `grow`) from this one: a knock-out. */
  subtract(other: Field, grow = 0): this { for (let k = 0; k < this.v.length; k++) { const s = grow - other.v[k]; if (s > this.v[k]) this.v[k] = s } return this }
  merge(other: Field): this { for (let k = 0; k < this.v.length; k++) if (other.v[k] < this.v[k]) this.v[k] = other.v[k]; return this }

  stroke(s: Stroke, grow = 0): this { forStroke(s, grow, (box, d) => this.add(box, d)); return this }
  cutStroke(s: Stroke, grow = 0): this { forStroke(s, grow, (box, d) => this.cut(box, d)); return this }
  circle(cx: number, cy: number, r: number): this { return this.add([cx - r, cy - r, cx + r, cy + r], (x, y) => Math.hypot(x - cx, y - cy) - r) }
  cutCircle(cx: number, cy: number, r: number): this { return this.cut([cx - r, cy - r, cx + r, cy + r], (x, y) => Math.hypot(x - cx, y - cy) - r) }
  polygon(contours: Contour[]): this {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
    for (const c of contours) for (const [x, y] of c) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y) }
    return this.add([bx0, by0, bx1, by1], (x, y) => signedDistanceTo([x, y], contours))
  }

  /** The zero line as closed contours, simplified to within `tolerance` path units. */
  trace(tolerance = 0.06): Contour[] {
    const { nx, ny, v, cell, x0, y0 } = this
    const at = (i: number, j: number) => v[j * nx + i]
    // Edge keys: horizontal edge (i,j)-(i+1,j) is 2*(j*nx+i), vertical (i,j)-(i,j+1) is 2*(j*nx+i)+1.
    const point = new Map<number, P>(), links = new Map<number, number[]>()
    const edgePoint = (key: number): P => {
      let p = point.get(key); if (p) return p
      const base = key >> 1, i = base % nx, j = Math.floor(base / nx), vertical = key & 1
      const a = at(i, j), b = vertical ? at(i, j + 1) : at(i + 1, j), t = a / (a - b)
      p = vertical ? [x0 + i * cell, y0 + (j + t) * cell] : [x0 + (i + t) * cell, y0 + j * cell]
      point.set(key, p); return p
    }
    const link = (a: number, b: number) => { (links.get(a) ?? links.set(a, []).get(a)!).push(b); (links.get(b) ?? links.set(b, []).get(b)!).push(a) }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const tl = at(i, j), tr = at(i + 1, j), br = at(i + 1, j + 1), bl = at(i, j + 1)
      const c = (tl < 0 ? 8 : 0) | (tr < 0 ? 4 : 0) | (br < 0 ? 2 : 0) | (bl < 0 ? 1 : 0)
      if (c === 0 || c === 15) continue
      const T = 2 * (j * nx + i), B = 2 * ((j + 1) * nx + i), L = 2 * (j * nx + i) + 1, R = 2 * (j * nx + i + 1) + 1
      const centre = (tl + tr + br + bl) / 4 < 0
      switch (c) {
        case 1: case 14: link(L, B); break
        case 2: case 13: link(B, R); break
        case 3: case 12: link(L, R); break
        case 4: case 11: link(T, R); break
        case 6: case 9: link(T, B); break
        case 7: case 8: link(T, L); break
        case 5: if (centre) { link(T, L); link(B, R) } else { link(T, R); link(L, B) } break
        case 10: if (centre) { link(T, R); link(L, B) } else { link(T, L); link(B, R) } break
      }
    }
    const seen = new Set<number>(), loops: Contour[] = []
    for (const startKey of links.keys()) {
      if (seen.has(startKey)) continue
      const loop: P[] = []
      let prev = -1, cur = startKey
      while (!seen.has(cur)) {
        seen.add(cur); loop.push(edgePoint(cur))
        const next = links.get(cur)!.find(n => n !== prev && !seen.has(n)) ?? -1
        if (next < 0) break
        prev = cur; cur = next
      }
      if (loop.length > 4) loops.push(simplifyLoop(loop, tolerance))
    }
    return loops
  }
}

function forStroke(s: Stroke, grow: number, use: (box: [number, number, number, number], d: (x: number, y: number) => number) => void): void {
  const n = s.points.length, w = (i: number) => (Array.isArray(s.width) ? s.width[i] : s.width) / 2 + grow
  // A flat end is a plane across the stroke: round joins near it must not poke past it.
  const plane = (end: P, toward: P, reach: number) => {
    const dx = toward[0] - end[0], dy = toward[1] - end[1], L = Math.hypot(dx, dy) || 1
    return (x: number, y: number) => Math.hypot(x - end[0], y - end[1]) > reach ? -Infinity : -((x - end[0]) * dx + (y - end[1]) * dy) / L
  }
  const reachOf = (i: number) => 2.5 * w(i)
  const startPlane = s.start === 'butt' && n > 1 ? plane(s.points[0], s.points[1], reachOf(0)) : null
  const endPlane = s.end === 'butt' && n > 1 ? plane(s.points[n - 1], s.points[n - 2], reachOf(n - 1)) : null
  const clip = (d: (x: number, y: number) => number) => (!startPlane && !endPlane) ? d : (x: number, y: number) => Math.max(d(x, y), startPlane?.(x, y) ?? -Infinity, endPlane?.(x, y) ?? -Infinity)
  const inner = use
  use = (box, d) => inner(box, clip(d))
  for (let i = 0; i < n - 1; i++) {
    const a = s.points[i], b = s.points[i + 1], h0 = w(i), h1 = w(i + 1), m = Math.max(h0, h1)
    const buttA = i === 0 && s.start === 'butt', buttB = i === n - 2 && s.end === 'butt'
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9, ux = dx / L, uy = dy / L
    use([Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m], (x, y) => {
      const px = x - a[0], py = y - a[1], u = px * ux + py * uy, v = Math.abs(-px * uy + py * ux)
      if (u < 0) return buttA ? box(-u, v - h0) : Math.hypot(u, v) - h0
      if (u > L) return buttB ? box(u - L, v - h1) : Math.hypot(u - L, v) - h1
      return v - (h0 + (h1 - h0) * u / L)
    })
  }
}
const box = (dx: number, dy: number) => Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)

/** Douglas-Peucker on a closed loop. */
function simplifyLoop(loop: P[], tol: number): P[] {
  // Split at the two points farthest apart, simplify each half.
  let far = 0, best = 0
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > best) { best = d; far = i } }
  const a = simplify(loop.slice(0, far + 1), tol), b = simplify([...loop.slice(far), loop[0]], tol)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}
function simplify(points: P[], tol: number): P[] {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]]
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9
  let index = 0, best = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = L < 1e-6 ? Math.hypot(points[i][0] - a[0], points[i][1] - a[1]) : Math.abs((points[i][0] - a[0]) * dy - (points[i][1] - a[1]) * dx) / L
    if (d > best) { best = d; index = i }
  }
  if (best <= tol) return [a, b]
  return [...simplify(points.slice(0, index + 1), tol).slice(0, -1), ...simplify(points.slice(index), tol)]
}

/** Points along a cubic Bezier. */
export function cubic(p0: P, p1: P, p2: P, p3: P, n = 40): P[] {
  const out: P[] = []
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]) }
  return out
}
/** Joins point runs, dropping the repeated point where one ends and the next begins. */
export function chain(...runs: P[][]): P[] {
  const out: P[] = []
  for (const run of runs) for (const p of run) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p) }
  return out
}
