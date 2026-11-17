import * as THREE from 'three/webgpu'
import { crRows, type Sections } from './loft'

/**
 * The buggy hull as a designed section, not a fitted radius list.
 *
 * Each cross section's right half runs through five named points, bottom to top:
 *   floor centre (0, floorY), floor edge (floorW, floorY), widest point (width, widestY),
 *   shoulder peak (shoulderX, shoulderY), deck valley (valleyX, valleyY), crown (0, crownY).
 * Cubic segments join them; the floor edge and the shoulder are creases, every other point
 * is smooth (the widest point has a vertical tangent, the ends meet the mirror line square).
 * Each of the nine numbers is a smooth curve along the body through a few keys (HullKeys),
 * so the surface is fair by construction and every number is a handle: ride height, floor
 * width, width, belt line, fender line, fender height, deck dip and crown.
 */

/** Section parameters, in this order. */
export const HULL_PARAMS = ['floorY', 'floorW', 'width', 'widestY', 'shoulderX', 'shoulderY', 'valleyX', 'valleyY', 'crownY'] as const
export type HullParam = typeof HULL_PARAMS[number]

/**
 * Wheel arches and the flank: smooth bulges added to the section where the wheels are, so
 * each is one handle instead of a ripple in the keys. Amounts in metres outward; positions
 * and half lengths along Z. The arches swell the widest point and shoulder together (the
 * fender over the wheel); the flank swells only the widest point (the side between the arch
 * and the scoop).
 */
export interface Arches { front: number; rear: number; flank: number; frontZ: number; rearZ: number; flankZ: number; length: number; flankLength: number }
/** Keys along Z: `z` positions shared by every parameter, then one row of values per parameter. */
export interface HullKeys { z: number[]; values: Record<HullParam, number[]>; arches?: Arches }

const bump = (z: number, c: number, r: number) => { const t = Math.min(1, Math.abs(z - c) / r); return (1 - t * t) ** 2 }

/** Where the five segments sit in the outline parameter v (0 floor centre, 1 crown). */
export const SEGMENTS = [0, .17, .37, .6, .78, 1]
/** Columns per segment at each detail level. */
export const COLUMNS: Record<0 | 1 | 2, number[]> = { 0: [3, 3, 4, 3, 3], 1: [2, 2, 3, 2, 2], 2: [1, 1, 2, 1, 1] }
/** Outline v of the creases: the floor edge and the shoulder. */
export const CREASES = [SEGMENTS[1], SEGMENTS[3]]

export function columns(detail: 0 | 1 | 2): number[] {
  const vs = [0]
  COLUMNS[detail].forEach((n, s) => { for (let k = 1; k <= n; k++) vs.push(SEGMENTS[s] + (SEGMENTS[s + 1] - SEGMENTS[s]) * k / n) })
  return vs
}

/** Parameters at z: Catmull-Rom of each key row against the shared key positions. */
export function paramsAt(k: HullKeys, z: number): number[] {
  const zs = k.z, n = zs.length
  // u at which the key z curve reaches z: the keys are spaced unevenly, so find the span first.
  let i = 0; while (i < n - 2 && z > zs[i + 1]) i++
  const f = Math.min(1, Math.max(0, (z - zs[i]) / (zs[i + 1] - zs[i]))), u = (i + f) / (n - 1)
  let rows = ROWS.get(k)
  if (!rows) { rows = zs.map((_, r) => HULL_PARAMS.map(p => k.values[p][r])); ROWS.set(k, rows) }
  const q = crRows(rows, u), a = k.arches
  if (a) {
    const arch = a.front * bump(z, a.frontZ, a.length) + a.rear * bump(z, a.rearZ, a.length), flank = a.flank * bump(z, a.flankZ, a.flankLength)
    q[2] += arch + flank; q[4] += arch
  }
  return q
}
const ROWS = new WeakMap<HullKeys, number[][]>()

type V2 = [number, number]
const norm = (x: number, y: number): V2 => { const l = Math.hypot(x, y) || 1; return [x / l, y / l] }

/** The half outline of one section as a function of v. */
export function outline(q: number[]): (v: number) => V2 {
  const [floorY, floorW, width, widestY, shoulderX, shoulderY, valleyX, valleyY, crownY] = q
  const P: V2[] = [[0, floorY], [Math.min(floorW, width - .01), floorY], [width, widestY], [Math.min(shoulderX, width), Math.max(shoulderY, widestY + .01)], [Math.min(valleyX, shoulderX - .02), valleyY], [0, crownY]]
  // Tangents leaving (out) and arriving (in) at each point.
  const d = (a: number, b: number) => norm(P[b][0] - P[a][0], P[b][1] - P[a][1])
  const smoothAt = (i: number) => norm(P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1])
  const tOut: V2[] = [[1, 0], d(1, 2), [0, 1], d(3, 4), smoothAt(4)]
  const tIn: V2[] = [[1, 0], [1, 0], [0, 1], d(2, 3), smoothAt(4), [-1, 0]]
  return v => {
    let s = 0; while (s < 4 && v > SEGMENTS[s + 1]) s++
    const t = Math.min(1, Math.max(0, (v - SEGMENTS[s]) / (SEGMENTS[s + 1] - SEGMENTS[s])))
    const A = P[s], B = P[s + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]) * .5
    const a = tOut[s], b = tIn[s + 1]
    const c1: V2 = [A[0] + a[0] * L * .75, A[1] + a[1] * L * .75], c2: V2 = [B[0] - b[0] * L * .75, B[1] - b[1] * L * .75]
    const m = 1 - t
    return [m * m * m * A[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * B[0], m * m * m * A[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * B[1]]
  }
}

/** The hull as loft sections from nose (u 0) to tail (u 1). */
export function hullSections(k: HullKeys): Sections {
  const z0 = k.z[0], z1 = k.z[k.z.length - 1]
  return u => { const z = z0 + (z1 - z0) * u; return { z, half: outline(paramsAt(k, z)) } }
}

/** Ring positions along u: even in Z with extra rings near the nose and tail, where curvature is high. */
export function rings(count: number): number[] {
  return Array.from({ length: count }, (_, j) => { const t = j / (count - 1); return t - .35 * Math.sin(2 * Math.PI * t) / (2 * Math.PI) })
}

/** Surface queries for placing features on the hull. */
export class HullQuery {
  constructor(private readonly k: HullKeys) {}
  private readonly cache = new Map<number, V2[]>()
  /** Outline points at z (to the nearest 0.1 mm, cached), right half from floor centre to crown. */
  private poly(z: number): V2[] {
    const key = Math.round(z * 1e4); let p = this.cache.get(key)
    if (!p) { const f = outline(paramsAt(this.k, key / 1e4)); p = Array.from({ length: 81 }, (_, i) => f(i / 80)); this.cache.set(key, p) }
    return p
  }
  /** Where the line from p along d (unit) leaves the hull, searching t in [-reach, reach]; undefined if it never crosses. */
  surface(p: [number, number, number], d: [number, number, number], reach = .3): [number, number, number] | undefined {
    const at = (t: number): [number, number, number] => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]
    const inside = (t: number) => { const [x, y, z] = at(t); return this.contains(x, y, z) }
    let lo = -reach, hi = reach
    if (!inside(lo) || inside(hi)) return undefined
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m }
    return at((lo + hi) / 2)
  }
  /** Height of the upper surface at (x, z): the highest outline point at that x. */
  top(x: number, z: number): number {
    const p = this.poly(z); let y = -Infinity
    for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; if ((ax - x) * (bx - x) <= 0 && ax !== bx) y = Math.max(y, ay + (by - ay) * (x - ax) / (bx - ax)) }
    return y
  }
  /** Half width of the side at height y and z: the outermost outline point at that height. */
  side(y: number, z: number): number {
    const p = this.poly(z); let x = 0
    for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; if ((ay - y) * (by - y) <= 0 && ay !== by) x = Math.max(x, ax + (bx - ax) * (y - ay) / (by - ay)) }
    return x
  }
  /** True when (x, y) lies inside the section at z. */
  contains(x: number, y: number, z: number): boolean {
    if (z < this.k.z[0] || z > this.k.z[this.k.z.length - 1]) return false
    const p = this.poly(z), all = [...p, ...p.slice().reverse().map(([a, b]) => [-a, b] as V2)]
    let inside = false
    for (let i = 0, j = all.length - 1; i < all.length; j = i++) { const [xi, yi] = all[i], [xj, yj] = all[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside }
    return inside
  }
  /** The frontmost z (searching back from the nose) where the hull contains (x, y): the nose surface there. */
  front(x: number, y: number): number {
    let lo = this.k.z[0], hi = 0
    if (!this.contains(x, y, hi)) return NaN
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (this.contains(x, y, m)) hi = m; else lo = m }
    return hi
  }
}

/** A tube swept along a closed or open path with an elliptical section (half width across, half height up). */
export function sweep(path: THREE.Vector3[], up: (i: number) => THREE.Vector3, halfW: number, halfH: number, around: number, closed: boolean): THREE.BufferGeometry {
  const n = path.length, pos: number[] = [], nor: number[] = [], idx: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const t = next.clone().sub(prev).normalize(), u = up(i).clone().projectOnPlane(t).normalize(), s = new THREE.Vector3().crossVectors(t, u)
    for (let a = 0; a < around; a++) {
      const ang = a / around * Math.PI * 2, c = Math.cos(ang), q = Math.sin(ang)
      const p = path[i].clone().addScaledVector(s, c * halfW).addScaledVector(u, q * halfH)
      const nn = s.clone().multiplyScalar(c / halfW).addScaledVector(u, q / halfH).normalize()
      pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z)
    }
  }
  const rows = closed ? n : n - 1
  for (let i = 0; i < rows; i++) for (let a = 0; a < around; a++) {
    const A = i * around + a, B = i * around + (a + 1) % around, C = ((i + 1) % n) * around + a, D = ((i + 1) % n) * around + (a + 1) % around
    idx.push(A, C, B, B, C, D)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx)
  // Wind outward: compare the first face's normal with the stored one.
  const p0 = new THREE.Vector3().fromArray(pos, idx[0] * 3), p1 = new THREE.Vector3().fromArray(pos, idx[1] * 3), p2 = new THREE.Vector3().fromArray(pos, idx[2] * 3)
  if (p1.sub(p0).cross(p2.sub(p0)).dot(new THREE.Vector3().fromArray(nor, idx[0] * 3)) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
  return g
}
