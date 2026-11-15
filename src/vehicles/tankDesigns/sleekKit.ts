/**
 * Lofted tank bodies at the original tank's scale: a low dart slung between six tread pods
 * that stand as tall as it does, in the manner of the approved buggy and jet. Smooth lofted
 * surfaces, one force field bubble set into a real opening with a tub beneath it, an accent
 * stripe cut into the skin, and a sculpted pylon reaching out to each tread's pivot.
 *
 * There is exactly one cockpit: the bubble. The body does not rise into a cabin of its own
 * under it, which is what made the earlier rounds read as one cockpit stacked on another.
 *
 * A body is a few lofts. Each loft is a row of superellipse cross-sections joined by smooth
 * curves; the first one carries the cockpit. Everything goes through the shared collector in
 * expeditionKit.ts, so the result is one draw of role-tagged surfaces plus the canopy.
 */
import * as T from 'three/webgpu'
import { AXLE_SPACING, Batch, PIVOT_Y, UP, bosses, headlamp, v, type ExpeditionSpec, type Solid, type Surface, type TankHull } from './expeditionKit'

/** One cross-section: [z, halfWidth, top, bottom, centreY, exponent = 2.3, centreX = 0]. Higher exponents are squarer. */
export type Station = number[]

export interface Loft {
  stations: Station[]
  /** Also build its mirror image across the centreline. The stations describe the +X one. */
  twin?: boolean
  /** Half-width of the accent stripe along the crown, in degrees round the section. */
  stripe?: number
  /** A flat dark end with a bright lip: an intake at the front, or an exhaust at the rear. */
  mouth?: 'front' | 'rear'
  surface?: Solid
  segs?: number
  spans?: number
}
/** The force field cockpit: an ellipse of half-width `a` and half-length `b` in plan, `h` tall. */
export interface Bubble { z: number; a: number; b: number; h: number }
/** The faired beam from the body to one axle's pivots. `sweep` is how far aft of the pivot it leaves the body. */
export interface Pylon { chord: number; thick: number; sweep: number; rootX: number; rootY: number }
/** An upright blade. `lean` tips its top outward, `sweep` carries it aft. */
export interface Fin { x: number; y: number; z: number; height: number; chord: number; sweep: number; lean?: number; twin?: boolean; surface?: Solid }
/** A thin transverse wing, for a spoiler across two fins. */
export interface Wing { y: number; z: number; span: number; chord: number; surface?: Solid }
/** A bright arch across the body, after the jet's tail ring. */
export interface Hoop { z: number; y: number; width: number; height: number; radius: number; surface?: Solid }

export interface SleekSpec {
  /** The first loft carries the cockpit. */
  lofts: Loft[]
  bubble: Bubble
  /** Front, middle and rear. Omitted entries take the defaults. */
  pylons?: Partial<Pylon>[]
  fins?: Fin[]
  wing?: Wing
  hoop?: Hoop
  /** Extra headlamps set into the body, as [x, y, z, radius] for the right side: z is the buried end. */
  noseLamps?: number[][]
  fender: ExpeditionSpec['fender']
  trackWidth?: number
}

/** Distance of the arm pivots from the centreline: it puts the pods where the original's are. */
const PIVOT_X = 1.26
const PYLONS: Pylon[] = [
  { chord: .74, thick: .13, sweep: .95, rootX: .3, rootY: 1.08 },
  { chord: .86, thick: .14, sweep: .2, rootX: .3, rootY: 1.08 },
  { chord: .78, thick: .13, sweep: -.6, rootX: .3, rootY: 1.08 },
]

const cr = (a: number, b: number, c: number, d: number, t: number) =>
  .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)

/** Stations filled out and joined by Catmull-Rom curves into evenly stepped rings. */
function rings(stations: Station[], spans: number): number[][] {
  const full = stations.map(s => [s[0], s[1], s[2], s[3], s[4], s[5] ?? 2.3, s[6] ?? 0]), out: number[][] = []
  for (let i = 0; i < full.length - 1; i++) {
    const p0 = full[Math.max(0, i - 1)], p1 = full[i], p2 = full[i + 1], p3 = full[Math.min(full.length - 1, i + 2)]
    for (let k = 0; k < spans; k++) out.push(p1.map((_, f) => f === 0 ? p1[0] + (p2[0] - p1[0]) * k / spans : cr(p0[f], p1[f], p2[f], p3[f], k / spans)))
  }
  out.push(full[full.length - 1])
  // The curves may overshoot a little at a tip; a section never turns inside out.
  for (const r of out) { r[1] = Math.max(r[1], .004); r[2] = Math.max(r[2], .004); r[3] = Math.max(r[3], .004); r[5] = Math.max(r[5], 1.4) }
  return out
}

/** Height of a loft's upper surface over (x, z), or of its centre line outside its plan. */
function crown(ring: number[][], x: number, z: number): number {
  let i = 0
  while (i < ring.length - 2 && ring[i + 1][0] < z) i++
  const a = ring[i], b = ring[i + 1], t = Math.min(1, Math.max(0, (z - a[0]) / Math.max(1e-6, b[0] - a[0])))
  const s = a.map((q, k) => q + (b[k] - q) * t), u = Math.min(1, Math.abs(x - s[6]) / s[1])
  return s[4] + s[2] * Math.max(0, 1 - u ** s[5]) ** (1 / s[5])
}

/** Smooth normals for a grid of points: rings by columns, the columns closing on themselves when `wrap`. */
function normals(P: T.Vector3[][], wrap: boolean, flip: boolean): T.Vector3[][] {
  const N = P.map(row => row.map(() => v(0, 0, 0))), cols = P[0].length, e1 = v(0, 0, 0), e2 = v(0, 0, 0), n = v(0, 0, 0)
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < (wrap ? cols : cols - 1); j++) {
    const k = (j + 1) % cols
    for (const [a, b, c] of [[[i, j], [i, k], [i + 1, j]], [[i, k], [i + 1, k], [i + 1, j]]]) {
      n.crossVectors(e1.subVectors(P[b[0]][b[1]], P[a[0]][a[1]]), e2.subVectors(P[c[0]][c[1]], P[a[0]][a[1]]))
      if (flip) n.negate()
      N[a[0]][a[1]].add(n); N[b[0]][b[1]].add(n); N[c[0]][c[1]].add(n)
    }
  }
  for (const row of N) for (const q of row) { if (q.lengthSq() < 1e-20) q.copy(UP); else q.normalize() }
  return N
}

interface Corner { p: T.Vector3; n: T.Vector3 }
/** A convex outline in plan (x, z), anticlockwise, that faces above it are cut away inside. */
type Hole = [number, number][]

/** Split a convex polygon by the line through a and b: the part to its left, and the rest. */
function split(poly: Corner[], ax: number, az: number, bx: number, bz: number): [Corner[], Corner[]] {
  const d = (c: Corner) => (bx - ax) * (c.p.z - az) - (bz - az) * (c.p.x - ax), left: Corner[] = [], right: Corner[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = d(p), dq = d(q)
    if (dp >= 0) left.push(p); if (dp <= 0) right.push(p)
    if (dp * dq < 0) { const t = dp / (dp - dq), c = { p: p.p.clone().lerp(q.p, t), n: p.n.clone().lerp(q.n, t).normalize() }; left.push(c); right.push(c) }
  }
  return [left, right]
}

/** Emit a grid as smooth triangles, optionally leaving a hole in the faces that look up. */
function skin(batch: Batch, P: T.Vector3[][], wrap: boolean, flip: boolean, surface: (i: number, j: number) => Surface, hole?: Hole) {
  const N = normals(P, wrap, flip), cols = P[0].length
  const emit = (s: Surface, a: Corner, b: Corner, c: Corner) => flip ? batch.smooth(s, a.p, c.p, b.p, a.n, c.n, b.n) : batch.smooth(s, a.p, b.p, c.p, a.n, b.n, c.n)
  let x0 = 0, x1 = 0, z0 = 0, z1 = 0
  if (hole) { x0 = Math.min(...hole.map(h => h[0])); x1 = Math.max(...hole.map(h => h[0])); z0 = Math.min(...hole.map(h => h[1])); z1 = Math.max(...hole.map(h => h[1])) }
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < (wrap ? cols : cols - 1); j++) {
    const k = (j + 1) % cols, s = surface(i, j)
    const at = (r: number, c: number): Corner => ({ p: P[r][c], n: N[r][c] })
    for (const tri of [[at(i, j), at(i, k), at(i + 1, j)], [at(i, k), at(i + 1, k), at(i + 1, j)]]) {
      const near = hole && tri.every(c => c.n.y > 0) && tri.some(c => c.p.x >= x0 && c.p.x <= x1) && tri.some(c => c.p.z >= z0 && c.p.z <= z1)
      if (!near) { emit(s, tri[0], tri[1], tri[2]); continue }
      // Keep what lies outside the outline: peel off the part beyond each edge in turn.
      let rest = tri
      for (let e = 0; e < hole.length && rest.length >= 3; e++) {
        const a = hole[e], b = hole[(e + 1) % hole.length], [inside, outside] = split(rest, a[0], a[1], b[0], b[1])
        for (let f = 1; f < outside.length - 1; f++) emit(s, outside[0], outside[f], outside[f + 1])
        rest = inside
      }
    }
  }
}

interface Build { segs: number; spans: number; matrix?: T.Matrix4; hole?: Hole; plain?: boolean }

/** One lofted body. In its own frame it runs along Z; `matrix` stands it up as a pylon or a fin. */
function loft(batch: Batch, l: Loft, o: Build, mirror = false) {
  const ring = rings(mirror ? l.stations.map(s => { const c = [...s]; c[6] = -(s[6] ?? 0); return c }) : l.stations, o.spans), segs = o.segs
  const P = ring.map(([z, w, top, bot, cy, n, cx]) => Array.from({ length: segs }, (_, j) => {
    const a = j / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = 2 / n
    return v(cx + w * Math.sign(c) * Math.abs(c) ** e, cy + (s >= 0 ? top : bot) * Math.sign(s) * Math.abs(s) ** e, z)
  }))
  if (o.matrix) for (const row of P) for (const p of row) p.applyMatrix4(o.matrix)
  const base = l.surface ?? 'paint', last = ring.length - 2
  skin(batch, P, true, false, (i, j) => {
    if (l.mouth === 'front' && i === 0 || l.mouth === 'rear' && i === last) return 'chrome'
    if (o.plain) return base
    const a = (j + .5) / segs * 360
    if (l.stripe && Math.abs(a - 90) < l.stripe) return 'accent'
    return Math.sin(a * Math.PI / 180) < -.55 && base === 'paint' ? 'frame' : base
  }, o.hole)
  // Close both ends: a tip takes the body's surface, a mouth is dark.
  for (const end of [0, ring.length - 1]) {
    const centre = P[end].reduce((s, p) => s.add(p), v(0, 0, 0)).multiplyScalar(1 / segs)
    const out = centre.clone().sub(P[end ? end - 1 : 1].reduce((s, p) => s.add(p), v(0, 0, 0)).multiplyScalar(1 / segs))
    const mouth = l.mouth === (end ? 'rear' : 'front')
    for (let j = 0; j < segs; j++) batch.tri(mouth ? 'frame' : base, centre, P[end][j], P[end][(j + 1) % segs], out)
  }
  return ring
}

/** The cockpit: a hole's outline, a bright rim, the force field dome and a tub with a seat. */
function cockpit(batch: Batch, b: Bubble, top: (x: number, z: number) => number, level: 0 | 1 | 2): [number, number, number] {
  const count = level === 0 ? 28 : level === 1 ? 12 : 8, domeRings = level === 0 ? 6 : level === 1 ? 3 : 2
  const at = (k: number, scale: number) => { const a = k / count * Math.PI * 2; return [Math.cos(a) * b.a * scale, b.z + Math.sin(a) * b.b * scale] }
  const edge = Array.from({ length: count }, (_, k) => { const [x, z] = at(k, 1); return top(x, z) })
  const mean = edge.reduce((s, y) => s + y, 0) / count
  // The dome springs from the rim, which follows the body, and evens out toward its crown.
  const dome = Array.from({ length: domeRings + 1 }, (_, m) => {
    const phi = m / domeRings * Math.PI / 2, s = Math.sin(phi)
    return Array.from({ length: count }, (_, k) => { const [x, z] = at(k, .97 * Math.cos(phi)); return v(x, edge[k] + (mean - edge[k]) * s + b.h * s + .03, z) })
  })
  skin(batch, dome, true, true, () => level === 2 ? 'trim' : 'canopy')
  const eye: [number, number, number] = [0, mean + Math.min(.32, b.h * .52), b.z - b.b * .05]
  if (level) return eye
  const lip = (scale: number, lift: number) => Array.from({ length: count }, (_, k) => { const [x, z] = at(k, scale); return v(x, (scale > 1 ? top(x, z) : edge[k]) + lift, z) })
  skin(batch, [lip(1.1, .012), lip(.96, .055)], true, true, () => 'chrome')
  // The tub walls the cockpit off from the inside of the hull.
  const floor = mean - .55
  const well = Array.from({ length: count }, (_, k) => { const [x, z] = at(k, .82); return v(x, floor, z) })
  skin(batch, [lip(.96, .055), well], true, true, () => 'trim')
  for (let k = 0; k < count; k++) batch.tri('trim', v(0, floor, b.z), well[k], well[(k + 1) % count], UP)
  // A seat behind the eye, and a low dash ahead of it that leaves the view over the nose clear.
  const back = b.z + b.b * .5
  batch.box('trim', [.5, .16, .5], [0, floor + .2, back - .3]); batch.box('trim', [.48, .62, .12], [0, floor + .5, back])
  batch.box('accent', [.32, .035, .09], [0, floor + .8, back - .075])
  batch.box('trim', [b.a * 1.1, .1, .22], [0, floor + .42, b.z - b.b * .62]); batch.box('accent', [b.a * .7, .02, .1], [0, floor + .48, b.z - b.b * .62])
  return eye
}

const pylonOf = (spec: SleekSpec, axle: number): Pylon => ({ ...PYLONS[axle], ...spec.pylons?.[axle] })
/** Station of a pylon `t` of the way from the body to the pivot: its centre and half-chord. */
function pylonAt(p: Pylon, axle: number, t: number) {
  const tipZ = (axle - 1) * AXLE_SPACING - .55
  return { x: p.rootX + (PIVOT_X - .12 - p.rootX) * t, y: p.rootY + (PIVOT_Y - p.rootY) * t, z: tipZ + p.sweep * (1 - t), half: p.chord * .5 * (1 - .45 * t), thick: p.thick * (1 - .4 * t) }
}

function pylons(batch: Batch, spec: SleekSpec, level: 0 | 1) {
  for (let axle = 0; axle < 3; axle++) for (const sx of [-1, 1]) {
    const p = pylonOf(spec, axle), tipZ = (axle - 1) * AXLE_SPACING - .55, length = PIVOT_X - .12 - p.rootX
    // Built along its own Z, then turned to run outward: its X becomes the chord.
    const stations = [0, .5, 1].map(t => { const s = pylonAt(p, axle, t); return [t * length, s.half, s.thick, s.thick, s.y, 2, -sx * p.sweep * (1 - t)] })
    const matrix = new T.Matrix4().makeRotationY(sx * Math.PI / 2).setPosition(sx * p.rootX, 0, tipZ)
    loft(batch, { stations }, { segs: level ? 6 : 10, spans: level ? 1 : 2, matrix, plain: true })
  }
}

function fin(batch: Batch, f: Fin, sx: number, level: 0 | 1) {
  const lean = (f.lean ?? 0) * sx, half = f.chord / 2
  // Built along its own Z, then stood up: its Y becomes the chord, pointing forward.
  const stations = [0, .55, 1].map(t => [t * f.height, .035 * (1 - .5 * t), half * (1 - .5 * t), half * (1 - .5 * t), -f.sweep * t, 2, lean * t])
  const matrix = new T.Matrix4().makeRotationX(-Math.PI / 2).setPosition(sx * f.x, f.y, f.z)
  loft(batch, { stations, surface: f.surface ?? 'accent' }, { segs: level ? 4 : 8, spans: level ? 1 : 2, matrix, plain: true })
}

function wing(batch: Batch, w: Wing, level: 0 | 1) {
  const stations = [-1, 0, 1].map(t => [(t + 1) * w.span, w.chord / 2, .035, .03, w.y, 2, 0])
  const matrix = new T.Matrix4().makeRotationY(Math.PI / 2).setPosition(-w.span, 0, w.z)
  loft(batch, { stations, surface: w.surface ?? 'paint' }, { segs: level ? 4 : 8, spans: 1, matrix, plain: true })
}

function hoop(batch: Batch, h: Hoop) {
  const point = (k: number) => { const a = k / 10 * Math.PI; return v(Math.cos(a) * h.width, h.y + Math.sin(a) * h.height, h.z) }
  for (let k = 0; k < 10; k++) batch.rod(h.surface ?? 'chrome', point(k), point(k + 1), h.radius, 6, true)
}

/** Lamp positions for the right side: two headlamps on the front pylon and what the body adds. */
function headlamps(spec: SleekSpec): number[][] {
  const p = pylonOf(spec, 0)
  const pod = (t: number, r: number) => { const s = pylonAt(p, 0, t); return [s.x, s.y + .03, s.z - s.half * .6, r] }
  return [pod(.42, .15), pod(.82, .13), ...(spec.noseLamps ?? [])]
}

export function sleekHull(spec: SleekSpec): TankHull {
  const lamps = headlamps(spec)
  const build = (batch: Batch, level: 0 | 1 | 2): [number, number, number] => {
    let main: number[][] = []
    const outline: Hole = Array.from({ length: 28 }, (_, k) => { const a = k / 28 * Math.PI * 2; return [Math.cos(a) * spec.bubble.a, spec.bubble.z + Math.sin(a) * spec.bubble.b] })
    spec.lofts.forEach((l, i) => {
      const o: Build = level === 0 ? { segs: l.segs ?? (i ? 14 : 24), spans: l.spans ?? (i ? 3 : 5), hole: i ? undefined : outline }
        : level === 1 ? { segs: i ? 8 : 12, spans: 2 } : { segs: i ? 6 : 8, spans: 1 }
      const ring = loft(batch, l, o)
      if (l.twin) loft(batch, l, o, true)
      if (!i) main = ring
    })
    const eye = cockpit(batch, spec.bubble, (x, z) => crown(main, x, z), level)
    if (level === 2) return eye
    pylons(batch, spec, level)
    for (const f of spec.fins ?? []) { fin(batch, f, 1, level); if (f.twin) fin(batch, f, -1, level) }
    if (spec.wing) wing(batch, spec.wing, level)
    for (const sx of [-1, 1]) {
      for (const [x, y, z, r] of lamps) headlamp(batch, sx * x, y, z, r, level, .16)
      // Tail lamps ride the trailing edge of the rear pylon.
      const s = pylonAt(pylonOf(spec, 2), 2, .55)
      batch.box('tail', [.34, .07, .06], [sx * s.x, s.y, s.z + s.half - .01])
    }
    if (level === 0) { if (spec.hoop) hoop(batch, spec.hoop); bosses(batch, PIVOT_X, PIVOT_X - .16) }
    return eye
  }
  const ends = spec.lofts.flatMap(l => l.stations.map(s => Math.abs(s[0])))
  return {
    trackWidth: spec.trackWidth ?? .93, fender: spec.fender, smoothFenders: true, pivotX: PIVOT_X,
    halfLength: Math.max(...ends),
    headlamps: [-1, 1].flatMap(sx => lamps.map(([x, y, z]) => v(sx * x, y, z - .18))),
    near: (batch, level) => build(batch, level),
    far: batch => { build(batch, 2) },
  }
}
