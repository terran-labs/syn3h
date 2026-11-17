import * as THREE from 'three/webgpu'
import { skin, byRole, superSections, featureTagger, featureWarp, type BodyPiece, type Ellipse, type Role, type Tagger } from './loft'
import { hullSections, columns, rings, CREASES, HullQuery, sweep, paramsAt, type HullKeys } from './hull'
import type { Features } from './dataFeatures'
import { DUCT_LAMP } from '../parts/sockets'

/**
 * The loft body from a design: the hull's keys (hull.ts) and its features (dataFeatures.ts).
 * Level C builds the fitted design; the shape editor exhibit builds whatever the sliders say.
 *
 * Every opening is cut under a separate piece that overlaps the shell, so no edge shows the
 * grid's staircase or a zero-thickness sheet: the cockpit under a swept chrome lip, each scoop
 * under a body-colour lip with a recessed dark pocket behind it, each headlight under a chrome
 * bezel at the mouth of a duct that the parts' lens sits in, and the rear panel recessed under
 * the deck's lip with the tail lamps on it.
 */
export interface LoftDesign { hull: HullKeys; features: Features }

type V3 = [number, number, number]
const piece = (role: Role, geometry: THREE.BufferGeometry): BodyPiece => ({ part: 'body', role, geometry })
const plain: Tagger = (_x, _y, _z, n) => n[1] < -.7 ? 'chrome' : 'paint'
/** Rings along the hull and the grid's column counts come from hull.ts; these are the ring counts. */
const ALONG: Record<0 | 1 | 2, number> = { 0: 46, 1: 20, 2: 12 }

/** Flip faces so each normal points along look(face centre). */
function orient(g: THREE.BufferGeometry, look: (p: THREE.Vector3) => THREE.Vector3): void {
  const p = g.getAttribute('position'), idx = g.getIndex()!
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3()
  for (let t = 0; t < idx.count; t += 3) {
    A.fromBufferAttribute(p, idx.getX(t)); B.fromBufferAttribute(p, idx.getX(t + 1)); C.fromBufferAttribute(p, idx.getX(t + 2))
    const m = A.clone().add(B).add(C).divideScalar(3)
    if (B.sub(A).cross(C.sub(A)).dot(look(m)) >= 0) continue
    const x = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, x)
  }
}

/** A surface between successive rings, and optionally a floor fanned across the last one. */
function rings2surface(list: THREE.Vector3[][], look: (p: THREE.Vector3) => THREE.Vector3, floorLook?: (p: THREE.Vector3) => THREE.Vector3): { walls: THREE.BufferGeometry; floor?: THREE.BufferGeometry } {
  const n = list[0].length, pos: number[] = [], idx: number[] = []
  list.forEach(r => r.forEach(p => pos.push(p.x, p.y, p.z)))
  for (let j = 0; j < list.length - 1; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + (i + 1) % n; idx.push(a, a + n, b, b, a + n, b + n) }
  const walls = new THREE.BufferGeometry(); walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); walls.setIndex(idx)
  orient(walls, look); walls.computeVertexNormals()
  if (!floorLook) return { walls }
  const last = list[list.length - 1], c = last.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(n), fp: number[] = [c.x, c.y, c.z], fi: number[] = []
  last.forEach(p => fp.push(p.x, p.y, p.z))
  for (let i = 0; i < n; i++) fi.push(0, 1 + i, 1 + (i + 1) % n)
  const floor = new THREE.BufferGeometry(); floor.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); floor.setIndex(fi)
  orient(floor, floorLook); floor.computeVertexNormals()
  return { walls, floor }
}

/** Mirror a right-side piece to the left, keeping faces outward. */
function mirrored(p: BodyPiece): BodyPiece {
  const g = p.geometry.clone().scale(-1, 1, 1), idx = g.getIndex()!
  for (let i = 0; i < idx.count; i += 3) { const x = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, x) }
  return piece(p.role, g)
}

/** The parts' duct lens frame (right side): centre, facing, and the lens outline's axes. */
function ductFrame(): { c: V3; n: V3; u: V3; w: V3; a: number; b: number } {
  const L = DUCT_LAMP, n = new THREE.Vector3(...L.axis).normalize(), maj = new THREE.Vector3(...L.major)
  const u = maj.addScaledVector(n, -maj.dot(n)).normalize(), w = new THREE.Vector3().crossVectors(n, u)
  return { c: [...L.centre] as V3, n: n.toArray() as V3, u: u.toArray() as V3, w: w.toArray() as V3, a: L.a, b: L.b }
}

/** Builds the body at one detail level. */
export function buildLoft(d: LoftDesign, detail: 0 | 1 | 2): BodyPiece[] {
  const F = d.features, q = new HullQuery(d.hull), c = F.cockpit, s = F.scoop
  const zEnd = d.hull.z[d.hull.z.length - 1], near = detail < 2
  const D = ductFrame(), ductA = D.a * F.head.scale, ductB = D.b * F.head.scale
  const dot = (p: V3, v: V3) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]
  /** A point's place in the duct frame: across the outline (1 at the rim) and along the axis. */
  const ductLocal = (x: number, y: number, z: number) => {
    const r: V3 = [Math.abs(x) - D.c[0], y - D.c[1], z - D.c[2]]
    return { m: Math.hypot(dot(r, D.u) / ductA, dot(r, D.w) / ductB), along: dot(r, D.n), r }
  }

  const CUTS: Ellipse[] = [
    { role: null, plane: 'xz', c: [0, c.z], r: [c.halfWidth, c.halfLength], band: [.35, 2], facing: .1, snap: .035 },
    { role: null, plane: 'zy', c: [s.z, s.y], r: [s.halfLength, s.halfHeight], band: [.45, 1.2], facing: .35, snap: .045, tilt: s.tilt },
    { role: 'accent', plane: 'xz', c: [0, 0], r: [F.stripe, 99], band: [.2, 2], facing: .2, snap: .08 },
  ]
  /** The duct cut: cells near the lens axis inside its outline; the mid level paints them dark instead. */
  const duct = (rest: Tagger, role: Role | null): Tagger => (x, y, z, n) => {
    if (z < -1.2) { const l = ductLocal(x, y, z); if (l.m < 1 && Math.abs(l.along) < .15) return role }
    return rest(x, y, z, n)
  }
  const stripeEnds = (tag: Tagger): Tagger => (x, y, z, n) => { const r = tag(x, y, z, n); return r === 'accent' && z < F.stripeStart ? 'paint' : r }
  const mid: Ellipse[] = [CUTS[0], { ...CUTS[1], role: 'frame' }, CUTS[2]]
  const tag = detail === 0 ? duct(stripeEnds(featureTagger(CUTS, plain)), null) : detail === 1 ? duct(stripeEnds(featureTagger(mid, plain)), 'frame') : plain
  const stripeWarp = featureWarp([CUTS[2]]), cutWarp = featureWarp([CUTS[0], CUTS[1]])
  /** The stripe snaps only where it is drawn: ahead of its start the columns converge and a snap would fold cells. */
  const ellipseWarp = (p: THREE.Vector3) => { const x = p.x; if (p.z > F.stripeStart - .03) stripeWarp(p); if (p.x === x) cutWarp(p) }
  /** Grid vertices near the duct rim move onto it, keeping their place along the axis. */
  const warp = (p: THREE.Vector3) => {
    if (p.z < -1.2 && p.x !== 0) {
      const l = ductLocal(p.x, p.y, p.z)
      if (Math.abs(l.along) < .15 && Math.abs(l.m - 1) * Math.min(ductA, ductB) < .04 && l.m > 1e-6) {
        const k = 1 / l.m - 1, du = dot(l.r, D.u) * k, dw = dot(l.r, D.w) * k, sx = Math.sign(p.x)
        p.x += sx * (D.u[0] * du + D.w[0] * dw); p.y += D.u[1] * du + D.w[1] * dw; p.z += D.u[2] * du + D.w[2] * dw
        return
      }
    }
    ellipseWarp(p)
  }

  // The hull: open at the tail when near, where the recessed rear panel closes it.
  const pieces = skin(hullSections(d.hull), 0, 0, tag, {
    us: rings(ALONG[detail]), vs: columns(detail), creases: CREASES, caps: [true, !near],
    // No fold within the nose and tail tips, where the columns converge into slivers.
    creaseRing: (_j, u) => u > .05 && u < .985,
    warp: near ? warp : undefined,
  })

  if (near) {
    pieces.push(...rearPanel(d, detail))
    // Cockpit lip.
    const n = detail ? 20 : 40
    const path = Array.from({ length: n }, (_, i) => {
      const a = i / n * Math.PI * 2, x = c.halfWidth * Math.cos(a), z = c.z + c.halfLength * Math.sin(a)
      return new THREE.Vector3(x, q.top(Math.abs(x), z) + c.lipHeight * .3, z)
    })
    pieces.push(piece('chrome', sweep(path, () => new THREE.Vector3(0, 1, 0), c.lipWidth, c.lipHeight, detail ? 4 : 6, true)))
  }
  if (detail === 0) {
    const right: BodyPiece[] = []
    // Scoop: lip, recessed walls and a dark floor.
    const k = 18, ct = Math.cos(s.tilt), st = Math.sin(s.tilt)
    const at = (a: number, scale: number, inset: number) => {
      const u = s.halfLength * scale * Math.cos(a), w = s.halfHeight * scale * Math.sin(a), z = s.z + u * ct - w * st, y = s.y + u * st + w * ct
      return new THREE.Vector3(q.side(y, z) - inset, y, z)
    }
    const rim = Array.from({ length: k }, (_, i) => at(i / k * Math.PI * 2, 1, 0))
    right.push(piece('paint', sweep(rim.map(p => p.clone().add(new THREE.Vector3(.004, 0, 0))), () => new THREE.Vector3(1, 0, 0), s.lip, s.lip * .7, 5, true)))
    const sc = rings2surface([[1, .006], [.86, s.depth]].map(([sc, dd]) => Array.from({ length: k }, (_, i) => at(i / k * Math.PI * 2, sc, dd))),
      p => new THREE.Vector3(.02, s.y - p.y, s.z - p.z), () => new THREE.Vector3(1, 0, 0))
    right.push(piece('frame', sc.walls), piece('frame', sc.floor!))
    // Headlight duct on the parts' lens axis: bezel, chrome walls, dark floor behind the lens.
    const m = 14, ring = (scale: number) => Array.from({ length: m }, (_, i) => {
      const t = i / m * Math.PI * 2, p: V3 = [D.c[0] + (D.u[0] * ductA * Math.cos(t) + D.w[0] * ductB * Math.sin(t)) * scale, D.c[1] + (D.u[1] * ductA * Math.cos(t) + D.w[1] * ductB * Math.sin(t)) * scale, D.c[2] + (D.u[2] * ductA * Math.cos(t) + D.w[2] * ductB * Math.sin(t)) * scale]
      return p
    })
    // The bezel is planar: fit a plane (offset along the axis, tilting across it) through
    // where the rim meets the nose, as the parts seat their lamps, so a nose that has moved
    // under the fixed lens gives a tilted clean ring rather than a ragged one.
    const rimPts = ring(1), offs = rimPts.map(p => { const hit = q.surface(p, D.n, .3); return hit ? dot([hit[0] - p[0], hit[1] - p[1], hit[2] - p[2]], D.n) : NaN })
    const ok = offs.map((o, i) => [o, Math.cos(i / m * Math.PI * 2), Math.sin(i / m * Math.PI * 2)]).filter(([o]) => Number.isFinite(o))
    const mean = ok.reduce((t, [o]) => t + o, 0) / Math.max(ok.length, 1)
    const tc = ok.reduce((t, [o, cs]) => t + (o - mean) * cs, 0) / Math.max(ok.reduce((t, [, cs]) => t + cs * cs, 0), 1e-6)
    const ts = ok.reduce((t, [o, , sn]) => t + (o - mean) * sn, 0) / Math.max(ok.reduce((t, [, , sn]) => t + sn * sn, 0), 1e-6)
    const lip = rimPts.map((p, i) => { const t = i / m * Math.PI * 2, o = mean + tc * Math.cos(t) + ts * Math.sin(t); return new THREE.Vector3(p[0] + D.n[0] * o, p[1] + D.n[1] * o, p[2] + D.n[2] * o) })
    const floor = ring(.9).map(p => new THREE.Vector3(p[0] - D.n[0] * F.head.depth, p[1] - D.n[1] * F.head.depth, p[2] - D.n[2] * F.head.depth))
    const axis = new THREE.Vector3(...D.n)
    right.push(piece('chrome', sweep(lip, () => axis, F.head.bezel, F.head.bezel * .8, 5, true)))
    const dc = rings2surface([lip, floor], p => new THREE.Vector3(D.c[0] - p.x, D.c[1] - p.y, D.c[2] - p.z).addScaledVector(axis, .05), () => axis)
    right.push(piece('chrome', dc.walls), piece('frame', dc.floor!))
    for (const p of right) pieces.push(p, mirrored(p))
  }
  // Wing and end plates riding the fin line.
  const wingTag = featureTagger([CUTS[2]], plain), small = detail === 2 ? 2 : detail ? 3 : 5
  pieces.push(...skin(superSections(F.wing), detail === 2 ? 3 : 5, small * 2, wingTag))
  for (const side of [1, -1]) for (const p of skin(superSections(F.plate), detail === 2 ? 3 : 6, small, () => 'paint')) {
    const pos = p.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) pos.setX(i, side * (pos.getX(i) + paramsAt(d.hull, pos.getZ(i))[4] - F.plateInset))
    if (side < 0) { const idx = p.geometry.getIndex()!; for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t) } }
    p.geometry.computeVertexNormals(); pieces.push(p)
  }
  return byRole(pieces)

  /** The tail: a flat rim, a recess `depth` deep under the deck lip, its floor with the tail lamps. */
  function rearPanel(dd: LoftDesign, det: 0 | 1 | 2): BodyPiece[] {
    const R = dd.features.rear, t = dd.features.tail, f = hullSections(dd.hull)(1).half, vs = columns(det)
    const H = vs.length - 1, N = 2 * H
    const outer = Array.from({ length: N }, (_, i) => { const [x, y] = f(i <= H ? vs[i] : vs[N - i]); return new THREE.Vector3(i <= H ? x : -x, y, zEnd) })
    let yb = Infinity, yt = -Infinity, xm = 0; for (const p of outer) { yb = Math.min(yb, p.y); yt = Math.max(yt, p.y); xm = Math.max(xm, Math.abs(p.x)) }
    const y0 = yb + R.inset, y1 = yt - R.lip, kx = (xm - R.inset) / xm
    const inner = outer.map(p => new THREE.Vector3(p.x * kx, y0 + (p.y - yb) / (yt - yb) * (y1 - y0), zEnd))
    const deep = inner.map(p => new THREE.Vector3(p.x, p.y, zEnd - R.depth))
    const back = () => new THREE.Vector3(0, 0, 1)
    const face = rings2surface([outer, inner], back)
    const centre = new THREE.Vector3(0, (y0 + y1) / 2, zEnd - R.depth)
    const recess = rings2surface([inner, deep], p => centre.clone().sub(p).setZ(0).add(new THREE.Vector3(0, 0, .01)), back)
    const out = [piece('paint', face.walls), piece('paint', recess.walls), piece('paint', recess.floor!)]
    // Tail lamp bars on the recess floor.
    const row = (z: number, k: number) => [z, t.depth * k, t.halfHeight * k, t.halfHeight * k, y0 + (y1 - y0) * t.y, 4]
    const bar = skin(superSections([row(-t.halfLength, .6), row(-t.halfLength + .01, 1), row(t.halfLength - .01, 1), row(t.halfLength, .6)]), det ? 4 : 6, det ? 3 : 4, () => 'lamp')[0]
    // A bar this thin has near-degenerate tips; face normals averaged per vertex keep them consistent.
    bar.geometry.rotateY(Math.PI / 2).translate(t.x * kx, 0, zEnd - R.depth); bar.geometry.computeVertexNormals()
    out.push(bar, mirrored(bar))
    return out
  }
}

