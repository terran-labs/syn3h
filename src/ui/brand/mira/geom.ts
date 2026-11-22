/**
 * A small construction kit for the Mira wordmark candidates: letters are drawn as closed
 * polygons whose corners can be sharp, chamfered or rounded, plus circles, stars and broken
 * orbits. Everything flattens to straight segments, because the logo's renderer reads only
 * M, L and Z (wordmarkMesh.ts parsePath) and its distance field is built from segments.
 *
 * Units are path units, y down, as in the Syn3h wordmark: cap height 178 with the baseline
 * at y = 178. Contours must not cross one another; holes are contours inside others, filled
 * by the even-odd rule.
 */
export type P = [number, number]
/** A polygon vertex: x, y and its corner. 0 sharp, positive a round radius, negative a chamfer length. */
export type V = [number, number, number?]
export type Contour = P[]

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k]
const len = (a: P) => Math.hypot(a[0], a[1])
const unit = (a: P): P => mul(a, 1 / (len(a) || 1))

/** Segments per full turn when an arc is flattened: fine enough to stay smooth at 4K. */
const ARC_STEPS = 96

/** A closed polygon with per-corner rounding or chamfering. */
export function shape(vertices: V[]): Contour {
  const out: Contour = []
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const [x, y, corner = 0] = vertices[i]
    const p: P = [x, y]
    if (!corner) { out.push(p); continue }
    const prev: P = [vertices[(i + n - 1) % n][0], vertices[(i + n - 1) % n][1]]
    const next: P = [vertices[(i + 1) % n][0], vertices[(i + 1) % n][1]]
    const u1 = unit(sub(prev, p)), u2 = unit(sub(next, p))
    if (corner < 0) { out.push(add(p, mul(u1, -corner)), add(p, mul(u2, -corner))); continue }
    const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    const d = corner / Math.tan(theta / 2)
    const bis = unit(add(u1, u2)), centre = add(p, mul(bis, corner / Math.sin(theta / 2)))
    const t1 = add(p, mul(u1, d)), t2 = add(p, mul(u2, d))
    let a0 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]), a1 = Math.atan2(t2[1] - centre[1], t2[0] - centre[0])
    let sweep = a1 - a0
    while (sweep > Math.PI) sweep -= 2 * Math.PI
    while (sweep < -Math.PI) sweep += 2 * Math.PI
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * ARC_STEPS))
    for (let s = 0; s <= steps; s++) { const a = a0 + sweep * s / steps; out.push([centre[0] + corner * Math.cos(a), centre[1] + corner * Math.sin(a)]) }
  }
  return dedupe(out)
}

/** Points along an ellipse arc from a0 to a1 (radians, y down), optionally rotated. */
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, rot = 0, steps?: number): P[] {
  const n = steps ?? Math.max(2, Math.ceil(Math.abs(a1 - a0) / (2 * Math.PI) * ARC_STEPS * Math.max(1, Math.max(rx, ry) / 60)))
  const c = Math.cos(rot), s = Math.sin(rot), out: P[] = []
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, x = rx * Math.cos(a), y = ry * Math.sin(a); out.push([cx + x * c - y * s, cy + x * s + y * c]) }
  return out
}
export const circle = (cx: number, cy: number, r: number): Contour => arc(cx, cy, r, r, 0, 2 * Math.PI).slice(0, -1)

/** A four-pointed sparkle with concave sides: the star of Mira. */
export function sparkle(cx: number, cy: number, r: number, waist = 0.2, rot = 0): Contour {
  const out: Contour = []
  for (let k = 0; k < 4; k++) {
    const a = rot + k * Math.PI / 2, b = a + Math.PI / 2
    const tip: P = [cx + r * Math.cos(a), cy + r * Math.sin(a)], tip2: P = [cx + r * Math.cos(b), cy + r * Math.sin(b)]
    const mid: P = [cx + r * waist * Math.cos(a + Math.PI / 4), cy + r * waist * Math.sin(a + Math.PI / 4)]
    // A quadratic curve from tip to tip pulled in to the waist: the concave flank.
    for (let i = 0; i < 12; i++) {
      const t = i / 12, u = 1 - t
      out.push([u * u * tip[0] + 2 * u * t * mid[0] + t * t * tip2[0], u * u * tip[1] + 2 * u * t * mid[1] + t * t * tip2[1]])
    }
  }
  return out
}

/** Intersection of line a1-a2 with line b1-b2 (infinite lines). */
export function meet(a1: P, a2: P, b1: P, b2: P): P {
  const d1 = sub(a2, a1), d2 = sub(b2, b1), den = d1[0] * d2[1] - d1[1] * d2[0]
  const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / den
  return add(a1, mul(d1, t))
}
/** A line parallel to p1-p2, moved by `by` to the right of its direction (y down). */
export function offsetLine(p1: P, p2: P, by: number): [P, P] {
  const d = unit(sub(p2, p1)), n: P = [-d[1], d[0]]
  return [add(p1, mul(n, by)), add(p2, mul(n, by))]
}

function dedupe(points: Contour): Contour {
  const out: Contour = []
  for (const p of points) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) out.push(p) }
  const a = out[0], b = out[out.length - 1]
  if (out.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) out.pop()
  return out
}

export const move = (contours: Contour[], dx: number, dy = 0): Contour[] => contours.map(c => c.map(([x, y]): P => [x + dx, y + dy]))
export const scale = (contours: Contour[], k: number, ox = 0, oy = 0): Contour[] => contours.map(c => c.map(([x, y]): P => [ox + (x - ox) * k, oy + (y - oy) * k]))

export function bounds(contours: Contour[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const c of contours) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { x0, y0, x1, y1 }
}

/** Distance from a point to the nearest contour edge, negative inside the even-odd fill. */
export function signedDistanceTo(p: P, contours: Contour[]): number {
  let best = Infinity, inside = false
  for (const c of contours) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const a = c[j], b = c[i], ab = sub(b, a), ap = sub(p, a)
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1)))
    best = Math.min(best, len(sub(p, add(a, mul(ab, t)))))
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside ? -best : best
}

/**
 * A band of the given thickness along an ellipse, broken wherever it would come within
 * `gap` of the ink: an orbit that passes behind the letters. Returns one contour per piece.
 * Pieces shorter than `minPiece` path units are dropped.
 */
export function orbit(ink: Contour[], o: { cx: number; cy: number; rx: number; ry: number; rot?: number; thickness: number; gap: number; from?: number; to?: number; minPiece?: number; taper?: (a: number) => number }): Contour[] {
  const from = o.from ?? 0, to = o.to ?? 2 * Math.PI, n = Math.round(720 * Math.abs(to - from) / (2 * Math.PI)), pieces: Contour[] = []
  const rot = o.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot)
  const at = (a: number, dr: number): P => { const x = (o.rx + dr) * Math.cos(a), y = (o.ry + dr) * Math.sin(a); return [o.cx + x * c - y * s, o.cy + x * s + y * c] }
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) {
      const outer = run.map(a => at(a, (o.taper?.(a) ?? 1) * o.thickness / 2)), inner = run.map(a => at(a, -(o.taper?.(a) ?? 1) * o.thickness / 2)).reverse()
      const piece = [...outer, ...inner]
      let length = 0
      for (let i = 1; i < outer.length; i++) length += len(sub(outer[i], outer[i - 1]))
      if (length >= (o.minPiece ?? 6)) pieces.push(piece)
    }
    run = []
  }
  for (let i = 0; i <= n; i++) {
    const a = from + (to - from) * i / n
    const half = (o.taper?.(a) ?? 1) * o.thickness / 2
    const clear = Math.min(signedDistanceTo(at(a, half), ink), signedDistanceTo(at(a, -half), ink), signedDistanceTo(at(a, 0), ink)) > o.gap
    if (clear) run.push(a); else flush()
  }
  flush()
  // A full, unbroken ring joins its ends: make it a ring of two contours instead.
  return pieces
}

/** Formats contours as an M/L/Z path, shifted so the ink's box starts at the origin. */
export function toPath(contours: Contour[], digits = 1): { d: string; width: number; height: number } {
  const b = bounds(contours), f = (v: number) => String(Number(v.toFixed(digits)))
  const d = contours.map(c => 'M' + c.map(([x, y]) => `${f(x - b.x0)} ${f(y - b.y0)}`).join('L') + 'Z').join('')
  return { d, width: Math.ceil((b.x1 - b.x0) * 10) / 10, height: Math.ceil((b.y1 - b.y0) * 10) / 10 }
}

/** Every pair of edges from different contours that cross: must be empty for the renderer. */
export function crossings(contours: Contour[]): string[] {
  const found: string[] = []
  const hit = (a: P, b: P, c: P, d: P) => {
    const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
  }
  for (let i = 0; i < contours.length; i++) for (let j = i + 1; j < contours.length; j++) {
    const A = contours[i], B = contours[j], ba = bounds([A]), bb = bounds([B])
    if (ba.x1 < bb.x0 || bb.x1 < ba.x0 || ba.y1 < bb.y0 || bb.y1 < ba.y0) continue
    outer: for (let p = 0; p < A.length; p++) for (let q = 0; q < B.length; q++) {
      if (hit(A[p], A[(p + 1) % A.length], B[q], B[(q + 1) % B.length])) { found.push(`${i}x${j}`); break outer }
    }
  }
  return found
}
