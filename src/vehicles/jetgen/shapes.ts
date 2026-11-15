import * as THREE from 'three/webgpu'

/**
 * Procedural jet shapes. Everything here is generated from a few numbers at run time, so a
 * design ships as parameters, not as a model file (AGENTS.md: generate it, do not ship it).
 *
 * Frame: the game's, right handed, -Z forward, +Y up, +X right. Units are metres.
 * A "body" is a loft of superellipse cross sections along Z. A "surface" (wing, fin, canard)
 * is a loft of aerofoil sections along a curved span.
 */
export type Mat = 'paint' | 'chrome' | 'glass' | 'dark' | 'glow'
export interface Piece { mat: Mat; geometry: THREE.BufferGeometry }
/** A landing gear leg. `fold` says where the strut swings to when stowed. */
export interface Leg { hinge: [number, number, number]; fold: 'aft' | 'fore' | 'in' }
/** Feet rest at this height, the underside of the current jet's landing-gear collider. */
export const GROUND_Y = -1.283

const V = THREE.Vector3

/** Catmull-Rom through rows of numbers, u in 0..1 across the rows. */
export function cr(keys: number[][], u: number): number[] {
  const K = keys.length - 1, x = Math.min(Math.max(u, 0), 1) * K, i = Math.min(Math.floor(x), K - 1), f = x - i
  const a = keys[Math.max(i - 1, 0)], b = keys[i], c = keys[i + 1], d = keys[Math.min(i + 2, K)]
  return b.map((_, k) => .5 * (2 * b[k] + (-a[k] + c[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f))
}

/** Skin a stack of closed rings. Winding is fixed afterwards so normals always face out. */
export function loft(rings: THREE.Vector3[][], capStart = true, capEnd = true): THREE.BufferGeometry {
  const n = rings[0].length, m = rings.length, pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let j = 0; j < m; j++) for (let i = 0; i <= n; i++) { const p = rings[j][i % n]; pos.push(p.x, p.y, p.z); uv.push(i / n, j / (m - 1)) }
  const w = n + 1
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; idx.push(a, c, b, b, c, d) }
  const cap = (j: number, flip: boolean) => {
    const base = pos.length / 3, c = new V(); rings[j].forEach(p => c.add(p)); c.divideScalar(n)
    pos.push(c.x, c.y, c.z); uv.push(.5, .5); rings[j].forEach(p => { pos.push(p.x, p.y, p.z); uv.push(.5, .5) })
    for (let i = 0; i < n; i++) { const a = base + 1 + i, b = base + 1 + (i + 1) % n; if (flip) idx.push(base, b, a); else idx.push(base, a, b) }
  }
  if (capStart) cap(0, false)
  if (capEnd) cap(m - 1, true)
  // Signed volume about the centroid tells us whether the faces point in; flip if so.
  const centre = new V(); for (let i = 0; i < pos.length; i += 3) centre.add(new V(pos[i], pos[i + 1], pos[i + 2])); centre.divideScalar(pos.length / 3)
  let volume = 0; const P = (i: number) => new V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(centre)
  for (let i = 0; i < idx.length; i += 3) volume += P(idx[i]).dot(P(idx[i + 1]).cross(P(idx[i + 2])))
  if (volume < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx)
  g.computeVertexNormals()
  // The seam column is duplicated for UVs; share its normals so no crease shows.
  const nr = g.getAttribute('normal')
  for (let j = 0; j < m; j++) {
    const a = j * w, b = a + n, s = new V(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize()
    nr.setXYZ(a, s.x, s.y, s.z); nr.setXYZ(b, s.x, s.y, s.z)
  }
  return g
}

/** Rings for a body. Keys are rows of [z, halfWidth, top, bottom, centreY, exponent]. */
export function bodyRings(keys: number[][], x = 0, seg = 10, around = 28, mirror = false): THREE.Vector3[][] {
  const rings: THREE.Vector3[][] = [], N = (keys.length - 1) * seg
  for (let j = 0; j <= N; j++) {
    const [z, w, t, b, y, e] = cr(keys, j / N), ring: THREE.Vector3[] = [], p = 2 / Math.max(e, 1.2)
    for (let i = 0; i < around; i++) {
      const a = i / around * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      ring.push(new V((mirror ? -1 : 1) * (x + Math.max(w, .002) * Math.sign(c) * Math.abs(c) ** p), y + Math.max(s >= 0 ? t : b, .002) * Math.sign(s) * Math.abs(s) ** p, z))
    }
    rings.push(ring)
  }
  return rings
}

/**
 * Rings for a lifting surface. Keys are rows of [x, y, zLeadingEdge, chord, thickness] from
 * root to tip; the span may curve, so a wing can crank up or drop into a tip pod.
 * Returns the parameter of each ring so the caller can split the tip off as chrome.
 */
export function surfRings(keys: number[][], n = 22, around = 20, mirror = false): { rings: THREE.Vector3[][]; t: number[] } {
  const ts = Array.from({ length: n + 1 }, (_, j) => 1 - (1 - j / n) ** 1.5)
  const rings = ts.map(t => {
    const [x, y, z, ch, tk] = cr(keys, t), [x2, y2] = cr(keys, Math.min(1, t + .002)), [x1, y1] = cr(keys, Math.max(0, t - .002))
    let tx = x2 - x1, ty = y2 - y1; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
    // Round the tip off instead of ending in a flat slab.
    const r = t > .92 ? Math.max(.12, Math.sqrt(1 - ((t - .92) / .08) ** 2)) : 1, c = ch * r, z0 = z + (ch - c) * .5, ring: THREE.Vector3[] = []
    for (let i = 0; i < around; i++) {
      const a = i / around * Math.PI * 2, u = (1 - Math.cos(a)) / 2, h = tk * c * 1.3 * Math.sqrt(u) * (1 - u) * Math.sign(Math.sin(a))
      ring.push(new V((mirror ? -1 : 1) * (x - ty * h), y + tx * h, z0 + u * c))
    }
    return ring
  })
  return { rings, t: ts }
}

/** Collects the pieces of one design. The design functions in designs.ts drive it. */
export class Builder {
  readonly pieces: Piece[] = []
  readonly legs: Leg[] = []
  /** Hover thruster ports, on the belly. */
  readonly hover: [number, number, number][] = []
  /** Rear nozzles: position and half size, for effects. */
  readonly nozzles: { x: number; y: number; z: number; r: number }[] = []
  private fus: number[][] = []

  add(mat: Mat, geometry: THREE.BufferGeometry): void { this.pieces.push({ mat, geometry }) }

  body(mat: Mat, keys: number[][], o: { x?: number; mirror?: boolean; seg?: number; around?: number; caps?: [boolean, boolean] } = {}): void {
    const caps = o.caps ?? [true, true]
    for (const m of o.mirror ? [false, true] : [false]) this.add(mat, loft(bodyRings(keys, o.x ?? 0, o.seg ?? 10, o.around ?? 28, m), caps[0], caps[1]))
  }

  /** The main hull. Later calls (canopy, scoop, ports) sit on its surface. */
  fuselage(keys: number[][]): void {
    const N = (keys.length - 1) * 12; this.fus = Array.from({ length: N + 1 }, (_, j) => cr(keys, j / N))
    this.body('paint', keys, { seg: 12, around: 40 })
  }

  /** Hull section at z: [halfWidth, top, bottom, centreY, exponent]. */
  at(z: number): number[] {
    const f = this.fus; if (z <= f[0][0]) return f[0].slice(1); if (z >= f[f.length - 1][0]) return f[f.length - 1].slice(1)
    let i = 0; while (f[i + 1][0] < z) i++
    const k = (z - f[i][0]) / (f[i + 1][0] - f[i][0]); return f[i].slice(1).map((v, j) => v + (f[i + 1][j + 1] - v) * k)
  }
  /** Height of the hull's skin above (side 1) or below (side -1) the point x at station z. */
  skin(z: number, x = 0, side: 1 | -1 = 1): number {
    const [w, t, b, y, e] = this.at(z), f = Math.min(.999, Math.abs(x) / w)
    return y + side * (side > 0 ? t : b) * (1 - f ** e) ** (1 / e)
  }

  /** Black glass inlaid in the hull with a chrome surround, as on the reference. */
  canopy(z0: number, z1: number, widthFraction = .62, bulge = .06): void {
    const make = (a: number, b: number, f: number, bg: number) => Array.from({ length: 19 }, (_, i) => {
      const s = i / 18, z = a + (b - a) * s, [w, t, , y, e] = this.at(z), env = Math.max(.03, Math.sin(Math.PI * s)) ** .45
      const ff = Math.min(.97, f * env), d = t * (1 - (1 - ff ** e) ** (1 / e))
      return [z, w * ff, d + bg * env, .02, y + t - d, 2.3]
    })
    const rim = .1
    this.body('chrome', make(z0 - rim, z1 + rim, widthFraction + .12, bulge * .45), { seg: 2, around: 24 })
    this.body('glass', make(z0, z1, widthFraction, bulge), { seg: 2, around: 24 })
  }

  /** A raised intake on top of the hull with a dark mouth and chrome lip. */
  scoop(z0: number, z1: number, halfWidth: number, height: number, x = 0): void {
    const y = (z: number) => this.skin(z, x) - .04, L = z1 - z0, mirror = x !== 0
    this.body('paint', [[z0, halfWidth, height, .05, y(z0), 4], [z0 + L * .35, halfWidth, height * .96, .05, y(z0 + L * .35), 4], [z0 + L * .75, halfWidth * .8, height * .5, .05, y(z0 + L * .75), 3], [z1, halfWidth * .45, .02, .05, y(z1), 2.5]], { x, mirror, seg: 6 })
    this.body('chrome', [[z0 - .012, halfWidth * 1.04, height * 1.05, .05, y(z0), 4], [z0 + .05, halfWidth * 1.04, height * 1.05, .05, y(z0), 4]], { x, mirror, seg: 1 })
    this.body('dark', [[z0 - .02, halfWidth * .86, height * .86, .0, y(z0) + .015, 4], [z0 + .04, halfWidth * .86, height * .86, .0, y(z0) + .015, 4]], { x, mirror, seg: 1 })
  }

  /** Wing, fin or canard. `tipFrom` 0..1 turns the outer part chrome. */
  surf(keys: number[][], o: { mat?: Mat; tip?: Mat; tipFrom?: number; mirror?: boolean } = {}): void {
    for (const m of o.mirror === false ? [false] : [false, true]) {
      const { rings, t } = surfRings(keys, 24, 22, m)
      const k = o.tipFrom === undefined ? rings.length - 1 : Math.max(1, t.findIndex(v => v >= o.tipFrom!))
      this.add(o.mat ?? 'paint', loft(rings.slice(0, k + 1), true, k === rings.length - 1))
      if (k < rings.length - 1) this.add(o.tip ?? 'chrome', loft(rings.slice(k), false, true))
    }
  }

  /** An engine pod with a chrome inlet spike, mirrored left and right. */
  engine(x: number, y: number, z0: number, z1: number, r: number): void {
    const L = z1 - z0, k = (z: number, f: number, e = 2.2) => [z, r * f, r * f, r * f, y, e]
    this.body('paint', [k(z0, .78), k(z0 + L * .2, 1), k(z0 + L * .65, 1), k(z1, .74)], { x, mirror: true, seg: 8, around: 24 })
    this.body('dark', [k(z0 - .01, .66), k(z0 + .05, .66)], { x, mirror: true, seg: 1, around: 24 })
    this.body('chrome', [k(z0 - .42, .02), k(z0 - .25, .2), k(z0 - .05, .42), k(z0 + .1, .5)], { x, mirror: true, seg: 5, around: 20 })
    this.nozzle(z1, y, r * .7, r * .7, x)
  }

  /** A rear nozzle: chrome rim, dark throat and a glow disc. Mirrored when x is not 0. */
  nozzle(z: number, y: number, halfWidth: number, halfHeight: number, x = 0, exponent = 2.2): void {
    const mirror = x !== 0, k = (dz: number, f: number) => [z + dz, halfWidth * f, halfHeight * f, halfHeight * f, y, exponent]
    this.body('chrome', [k(-.12, 1.12), k(.1, 1.1), k(.24, .98)], { x, mirror, seg: 4, around: 28 })
    this.body('dark', [k(.2, .9), k(.26, .9)], { x, mirror, seg: 1, around: 28 })
    this.body('glow', [k(.262, .72), k(.27, .72)], { x, mirror, seg: 1, around: 28 })
    for (const sx of mirror ? [1, -1] : [1]) this.nozzles.push({ x: x * sx, y, z: z + .27, r: Math.max(halfWidth, halfHeight) })
  }

  /** A chrome-rimmed hover port on the underside, as on the reference's belly. */
  port(x: number, z: number, halfWidth: number, halfLength: number, y?: number): void {
    for (const sx of x === 0 ? [1] : [1, -1]) {
      const py = y ?? this.skin(z, x, -1) + .03
      const slab = (mat: Mat, f: number, depth: number) => {
        const g = loft(bodyRings([[0, halfWidth * f, halfLength * f, halfLength * f, 0, 3], [depth, halfWidth * f, halfLength * f, halfLength * f, 0, 3]], 0, 1, 28))
        g.rotateX(Math.PI / 2); g.translate(x * sx, py, z); this.add(mat, g)
      }
      slab('chrome', 1.16, .07); slab('dark', .96, .085); slab('glow', .7, .09)
      this.hover.push([x * sx, py - .09, z])
    }
  }

  leg(hinge: [number, number, number], fold: Leg['fold']): void {
    this.legs.push({ hinge, fold })
    if (hinge[0] !== 0) this.legs.push({ hinge: [-hinge[0], hinge[1], hinge[2]], fold })
  }
}
