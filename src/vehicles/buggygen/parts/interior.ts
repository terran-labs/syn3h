import type * as THREE from 'three'
import { Mesh, toGame, type V3 } from './kit'

/**
 * The cockpit tub under the force field canopy: one smooth bowl from a chrome lip on the deck
 * down to a flat bottom, with glowing lenses set into it (a large one in the middle and a ring
 * of small ones high on the wall, below the driver's sight line). No seat and no dash. Faces
 * point into the cabin. Same design as tools/buggy-bodies/build.py `make_tub`, except that the
 * deck height there came from casting rays onto the body; here it is a plane that rises toward
 * the tail, which is what those rays found to within about 2 cm.
 *
 * Built in build.py's frame (X right, Y back, Z up) and turned into the game frame by `toGame`.
 */
export const TUB = {
  /** Opening in plan: centre along the body, half length, half width, squareness (1 an ellipse). */
  y: .02, halfLen: .66, halfWid: .4, square: .6,
  /** Deck height at the opening's centre, and its rise per metre toward the tail. */
  deck: .739, deckRise: .123,
  /** Bowl bottom height; the wall falls to it as the fourth power of the way out. */
  floor: .42, lipDrop: .03, lipLift: .004,
  /** Glow lenses: centre radius, wall radius, how far up the wall (0 centre, 1 lip). */
  bigSpot: .1, smallSpot: .036, spotRing: .86,
}
/** Outline positions (in twentieths of the way round) of the small lenses. */
const SPOTS_AT = [1.5, 5, 8.5, 11.5, 15, 18.5]

export function buildInterior(detail: 0 | 1 | 2): { part: 'interior'; role: string; geometry: THREE.BufferGeometry }[] {
  const T = TUB, n = detail === 0 ? 20 : detail === 1 ? 14 : 10
  const sp = (c: number, e: number) => Math.sign(c) * Math.abs(c) ** e
  const outline = Array.from({ length: n }, (_, k) => {
    const a = 2 * Math.PI * k / n
    return [T.halfWid * sp(Math.cos(a), T.square), T.y + T.halfLen * sp(Math.sin(a), T.square)] as [number, number]
  })
  const deckAt = (y: number) => T.deck + T.deckRise * y
  const surface = (k: number, g: number): V3 => {
    const k0 = ((Math.floor(k) % n) + n) % n, k1 = (k0 + 1) % n, f = k - Math.floor(k)
    const ox = outline[k0][0] * (1 - f) + outline[k1][0] * f, oy = outline[k0][1] * (1 - f) + outline[k1][1] * f
    const top = deckAt(oy) - T.lipDrop
    return [ox * g, T.y + (oy - T.y) * g, T.floor + (top - T.floor) * g ** 4]
  }
  const bowl = new Mesh(), lip = new Mesh(), glow = new Mesh()
  const rings = (detail === 2 ? [.96, .74, .3] : [.96, .88, .74, .52, .26]).map(g => Array.from({ length: n }, (_, k) => bowl.vec(surface(k, g))))
  const rimL = outline.map(([x, y]) => lip.vert(x, y, deckAt(y) + T.lipLift)), r0 = rings[0].map(i => lip.vert(bowl.p[i * 3], bowl.p[i * 3 + 1], bowl.p[i * 3 + 2]))
  lip.skin(rimL, r0)
  for (let j = 0; j + 1 < rings.length; j++) bowl.skin(rings[j], rings[j + 1])
  const centre = bowl.vec(surface(0, 0))
  for (let k = 0; k < n; k++) bowl.tri(rings[rings.length - 1][k], rings[rings.length - 1][(k + 1) % n], centre)
  if (detail < 2) {
    const spot = (k: number, g: number, r: number, m: number) => {
      const c = surface(k, g), a = surface(k + .5, g), b = surface(k - .5, g), u = surface(k, Math.min(1, g + .03)), d = surface(k, Math.max(0, g - .03))
      let du: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv: V3 = [u[0] - d[0], u[1] - d[1], u[2] - d[2]]
      const len = (v: V3) => Math.hypot(...v), unit = (v: V3): V3 => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l] }
      const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
      // At the bowl's centre both directions collapse onto one line (build.py's tangent frame
      // went sideways there and hung the big lens under the floor): lay it flat, facing up.
      if (g === 0) { du = [1, 0, 0]; dv = [0, 1, 0] }
      du = unit(du); let nrm = unit(cross(du, dv)); dv = cross(nrm, du)
      if (nrm[2] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]]
      const at = (rr: number, lift: number, j: number) => {
        const cs = Math.cos(2 * Math.PI * j / m) * rr, sn = Math.sin(2 * Math.PI * j / m) * rr
        return glow.vert(c[0] + du[0] * cs + dv[0] * sn + nrm[0] * lift, c[1] + du[1] * cs + dv[1] * sn + nrm[1] * lift, c[2] + du[2] * cs + dv[2] * sn + nrm[2] * lift)
      }
      const from = glow.i.length
      const edge = Array.from({ length: m }, (_, j) => at(r, .003, j)), crown = Array.from({ length: m }, (_, j) => at(r * .55, .003 + r * .22, j))
      const top = glow.vert(c[0] + nrm[0] * (.003 + r * .3), c[1] + nrm[1] * (.003 + r * .3), c[2] + nrm[2] * (.003 + r * .3))
      glow.skin(edge, crown)
      for (let j = 0; j < m; j++) glow.tri(crown[j], crown[(j + 1) % m], top)
      // Each lens faces out of the bowl.
      const P = (i: number) => glow.p.slice(i * 3, i * 3 + 3) as V3
      for (let t = from; t < glow.i.length; t += 3) {
        const A = P(glow.i[t]), B = P(glow.i[t + 1]), C = P(glow.i[t + 2])
        const f = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]])
        if (f[0] * nrm[0] + f[1] * nrm[1] + f[2] * nrm[2] < 0) glow.flip(t, t + 3)
      }
    }
    spot(0, 0, T.bigSpot, 10)
    for (const k of SPOTS_AT) spot(k * n / 20, T.spotRing, T.smallSpot, 6)
  }
  const out = [{ part: 'interior' as const, role: 'trim', geometry: bowl.geometry(toGame) }, { part: 'interior' as const, role: 'chrome', geometry: lip.geometry(toGame) }]
  if (glow.triangles) out.push({ part: 'interior', role: 'glow', geometry: glow.geometry(toGame) })
  return out
}

export const INTERIOR_NUMBERS = Object.keys(TUB).length + SPOTS_AT.length
