import type * as THREE from 'three'
import { Mesh, type V3 } from './kit'

/**
 * The flight wings: a broad swept planform, nearly flat, that LoadedBuggySkin scales open and
 * flexes vertex by vertex (wingVertexSyn3h) and draws as a force field. Each half is a low
 * faceted roof: a bevelled rim rising a few centimetres from the outline, then two roof
 * planes meeting along a ridge that runs from the root out toward the tip, with a spine down
 * the centre line ahead of it. Top surface only; the force field draws both sides.
 *
 * Frame: the game's (+X right, +Y up, -Z forward), both halves, as LoadedBuggySkin holds them
 * after its quarter turn and mirror. Plan coordinates (x, z) in metres.
 */
export const WINGS = {
  /** Root chord on the centre line: leading and trailing ends. */
  rootFront: -5.33, rootBack: 5.21,
  /** Straight leading edge from the root to the start of the tip. */
  tipFrontX: 6.59, tipFrontZ: -1.27,
  /** Trailing edge: swept forward from the root to a kink, then straight out to the tip. */
  kinkX: 3.70, kinkZ: 3.64, tipBackX: 6.62, tipBackZ: 3.66,
  /** Rounded tip: furthest reach, and the squareness of its curve (1 an ellipse, lower squarer). */
  span: 7.97, tipSquare: .5,
  /** Rim bevel: inset in plan and rise. */
  bevel: .13, rise: .073,
  /** Roof ridge: where it leaves the centre line, a middle point, its outer end, and its height. */
  ridgeRootZ: .56, ridgeMidX: 4.05, ridgeMidZ: .74, ridgeTipX: 6.05, ridgeTipZ: 1.29, ridge: .3,
  /** Spine on the centre line ahead of the ridge: forward end and its height. */
  spineZ: -3.83, spine: .19,
}

/** Half outline in plan, from the root's trailing end round the tip to the root's leading end. */
function outline(w = WINGS): [number, number][] {
  const cz = (w.tipBackZ + w.tipFrontZ) / 2, bz = (w.tipBackZ - w.tipFrontZ) / 2, cx = (w.tipBackX + w.tipFrontX) / 2, ax = w.span - cx
  const tip = [60, 30, 0, -30, -60].map(d => {
    const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t)
    return [cx + ax * Math.abs(c) ** w.tipSquare, cz + bz * Math.sign(s) * Math.abs(s) ** w.tipSquare] as [number, number]
  })
  // Of the five tip points the end two are replaced by the tip's own corners.
  return [[0, w.rootBack], [w.kinkX, w.kinkZ], [w.tipBackX, w.tipBackZ], ...tip.slice(1, 4), [w.tipFrontX, w.tipFrontZ], [w.tipFrontX / 2, w.rootFront + (w.tipFrontZ - w.rootFront) / 2], [0, w.rootFront]]
}

export function buildWings(detail: 0 | 1 | 2): { part: 'wings'; role: string; geometry: THREE.BufferGeometry }[] {
  void detail // 29 triangles a side already: every level uses the same wing.
  const w = WINGS, rim = outline(w), n = rim.length
  // Inset ring: each point moved inward along the outline's averaged normal; root points stay on the centre line.
  const inset = rim.map(([x, z], k) => {
    const [px, pz] = rim[Math.max(0, k - 1)], [nx, nz] = rim[Math.min(n - 1, k + 1)]
    let dx = nz - pz, dz = -(nx - px)
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l
    // The outline runs clockwise seen from above, so (dz, -dx) rotated points inward; check by the centre.
    if (dx * (3 - x) + dz * (0 - z) < 0) { dx = -dx; dz = -dz }
    return x === 0 ? [0, z + Math.sign(-z) * w.bevel] : [x + dx * w.bevel, z + dz * w.bevel]
  })
  const ridge: V3[] = [[0, w.ridge * .96, w.ridgeRootZ], [w.ridgeMidX, w.ridge, w.ridgeMidZ], [w.ridgeTipX, w.ridge * .98, w.ridgeTipZ]]
  const spine: V3 = [0, w.spine, w.spineZ]
  const m = new Mesh()
  for (const side of [1, -1]) {
    const v = (p: V3) => m.vert(side * p[0], p[1], p[2])
    const r0 = rim.map(([x, z]) => v([x, 0, z])), r1 = inset.map(([x, z]) => v([x, w.rise, z]))
    for (let k = 0; k + 1 < n; k++) m.quad(r0[k], r0[k + 1], r1[k + 1], r1[k])
    // Roof: zip the inset ring against the ridge as the ring sees it going round (root, out to
    // the tip, back to the root, then forward along the spine), always taking the shorter diagonal.
    const rp = ridge.map(v), sp = v(spine)
    const seq = [rp[0], rp[1], rp[2], rp[1], rp[0], sp]
    const P = (i: number) => m.p.slice(i * 3, i * 3 + 3)
    const d2 = (a: number, b: number) => { const A = P(a), B = P(b); return (A[0] - B[0]) ** 2 + (A[2] - B[2]) ** 2 }
    let i = 0, j = 0
    while (i < n - 1 || j < seq.length - 1) {
      const ringNext = i < n - 1 && (j === seq.length - 1 || d2(r1[i + 1], seq[j]) < d2(r1[i], seq[j + 1]))
      if (ringNext) { m.tri(r1[i], r1[i + 1], seq[j]); i++ } else { m.tri(r1[i], seq[j + 1], seq[j]); j++ }
    }
    // Faces must point up; each half was wound by its walk, so fix them by their normal.
    const from = m.i.length - (n - 1) * 6 - (n - 1 + seq.length - 1) * 3
    let up = 0
    for (let t = from; t < m.i.length; t += 3) {
      const a = P(m.i[t]), b = P(m.i[t + 1]), c = P(m.i[t + 2])
      up += (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    }
    if (up < 0) m.flip(from)
  }
  return [{ part: 'wings', role: 'canopy', geometry: m.geometry() }]
}

export const WINGS_NUMBERS = Object.keys(WINGS).length
