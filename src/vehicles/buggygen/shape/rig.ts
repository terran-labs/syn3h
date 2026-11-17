import type { CageData } from '../cage/generator'
import { data as cage250 } from '../cage/cage250'
import { field, type ScaledRegion, type Shape } from './handles'
import { findFeatures, type Feature, type FeatureId } from './features'

/**
 * The rig: the handles' smooth field everywhere, except on the sculpted features, which move
 * as rigid bodies. Each feature takes the rotation and translation that best follow the field
 * over its own points (least squares, Horn's quaternion method), plus one uniform scale if a
 * handle sizes it; the paint around it blends from that rigid motion into the field over the
 * feature's blend radius. So a nose stretch moves the headlight duct forward and tilts it with
 * the nose, but never lengthens it.
 *
 * Features that cross the mirror plane (hood scoop, cockpit rim) may only pitch, rise and
 * slide, which keeps both halves one rigid piece.
 */
export type V3 = [number, number, number]

/** A similarity: p -> to + scale * R (p - from), R row major. */
export interface Motion { from: V3; to: V3; R: number[]; scale: number }

export const applyMotion = (m: Motion, p: ArrayLike<number>, out: number[] | Float32Array | Float64Array = [0, 0, 0], o = 0) => {
  const x = p[0] - m.from[0], y = p[1] - m.from[1], z = p[2] - m.from[2], R = m.R, s = m.scale
  out[o] = m.to[0] + s * (R[0] * x + R[1] * y + R[2] * z)
  out[o + 1] = m.to[1] + s * (R[3] * x + R[4] * y + R[5] * z)
  out[o + 2] = m.to[2] + s * (R[6] * x + R[7] * y + R[8] * z)
  return out
}
/** A direction under a motion's rotation (no scale or translation). */
export const turn = (m: Motion, d: ArrayLike<number>, out: number[] | Float32Array = [0, 0, 0], o = 0) => {
  const R = m.R
  out[o] = R[0] * d[0] + R[1] * d[1] + R[2] * d[2]; out[o + 1] = R[3] * d[0] + R[4] * d[1] + R[5] * d[2]; out[o + 2] = R[6] * d[0] + R[7] * d[1] + R[8] * d[2]
  return out
}

/** Largest eigenvector of a symmetric 4x4 matrix (cyclic Jacobi). */
function topEigenvector(A: number[][]): number[] {
  const a = A.map(r => [...r]), v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2
    if (off < 1e-30) break
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 4; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq }
      for (let k = 0; k < 4; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk }
      for (let k = 0; k < 4; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq }
    }
  }
  let best = 0
  for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k
  return v.map(r => r[best])
}

/** Best rotation taking centred points `a` onto centred points `b` (flat xyz arrays). */
function bestRotation(a: number[], b: number[], centred: boolean): number[] {
  if (centred) {
    // Pitch only: a rotation about the x axis, from the y and z parts.
    let sin = 0, cos = 0
    for (let i = 0; i < a.length; i += 3) { sin += a[i + 1] * b[i + 2] - a[i + 2] * b[i + 1]; cos += a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] }
    const t = Math.atan2(sin, cos), c = Math.cos(t), s = Math.sin(t)
    return [1, 0, 0, 0, c, -s, 0, s, c]
  }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < a.length; i += 3) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[i + r] * b[i + c]
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S
  const [w, x, y, z] = topEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ])
  return [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ]
}

/** The rigid motion (no scale) that best takes points `a` onto points `b` (flat xyz arrays). */
export function fitMotion(a: ArrayLike<number>, b: ArrayLike<number>): Motion {
  const n = a.length / 3, from: V3 = [0, 0, 0], to: V3 = [0, 0, 0]
  for (let i = 0; i < a.length; i++) { from[i % 3] += a[i] / n; to[i % 3] += b[i] / n }
  const ca: number[] = [], cb: number[] = []
  for (let i = 0; i < a.length; i++) { ca.push(a[i] - from[i % 3]); cb.push(b[i] - to[i % 3]) }
  return { from, to, R: bestRotation(ca, cb, false), scale: 1 }
}

/** What the rig needs of a cage, worked out once: features, their centres and the blend weights. */
interface Prepared {
  base: Float64Array
  features: Feature[]
  centres: V3[]
  regions: ScaledRegion[]
  /** Per point, the feature it belongs to, or -1. */
  owner: Int16Array
  /** Per point that is in no feature: [feature, weight] pairs for the features it blends toward. */
  blends: [number, number][][]
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Blend weights toward each feature for one default-frame point, or [] if none reaches it. */
function weightsAt(prep: Pick<Prepared, 'base' | 'features'>, x: number, y: number, z: number): [number, number][] {
  const out: [number, number][] = []
  let total = 0
  prep.features.forEach((f, k) => {
    let d = Infinity
    for (const v of f.points) d = Math.min(d, Math.hypot(prep.base[v * 3] - x, prep.base[v * 3 + 1] - y, prep.base[v * 3 + 2] - z))
    const w = 1 - smooth(0, f.blend, d)
    if (w > 0) { out.push([k, w]); total += w }
  })
  // Where two features' blends overlap, share rather than overshoot.
  if (total > 1) for (const e of out) e[1] /= total
  return out
}

const prepared = new WeakMap<CageData, Prepared>()
function prepare(cage: CageData): Prepared {
  let p = prepared.get(cage)
  if (p) return p
  const base = Float64Array.from(cage.v, x => x / 1000), n = base.length / 3, features = findFeatures(cage)
  const owner = new Int16Array(n).fill(-1)
  features.forEach((f, k) => { for (const v of f.points) owner[v] = k })
  const centres = features.map(f => {
    const c: V3 = [0, 0, 0]
    for (const v of f.points) for (let k = 0; k < 3; k++) c[k] += base[v * 3 + k] / f.points.length
    // A feature on the mirror plane is centred on it (both halves together).
    if (f.centred) c[0] = 0
    return c
  })
  const regions = features.flatMap((f, k) => f.size ? [{ centre: centres[k], radius: radiusOf(base, f, centres[k]) + f.blend, handle: f.size }] : [])
  const blends = Array.from({ length: n }, (_, i) => owner[i] >= 0 ? [] : weightsAt({ base, features }, base[i * 3], base[i * 3 + 1], base[i * 3 + 2]))
  p = { base, features, centres, regions, owner, blends }
  prepared.set(cage, p)
  return p
}
function radiusOf(base: Float64Array, f: Feature, c: V3): number {
  let r = 0
  for (const v of f.points) r = Math.max(r, Math.hypot(base[v * 3] - c[0], base[v * 3 + 1] - c[1], base[v * 3 + 2] - c[2]))
  return r
}

export interface Rig {
  /** Shaped half cage points, metres, xyz. */
  points: Float64Array
  /** Each feature's rigid motion. */
  motion: Record<FeatureId, Motion>
  /** Each feature's half cage point indices. */
  features: Record<FeatureId, number[]>
  /** Any default-frame point (either half) to the shaped frame, by the same field and blends. */
  map(p: ArrayLike<number>, out?: number[]): number[]
}

/** The rig applied to a cage (cage250 by default). */
export function rig(s: Shape, cage: CageData = cage250): Rig {
  const P = prepare(cage), { base, features, centres, regions, owner, blends } = P, n = base.length / 3
  const moved = new Float64Array(base.length), tmp = [0, 0, 0]
  for (let i = 0; i < n; i++) { field(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], s, regions, tmp); moved[i * 3] = tmp[0]; moved[i * 3 + 1] = tmp[1]; moved[i * 3 + 2] = tmp[2] }
  // Each feature's rigid motion, fitted to where the field would take its points.
  const motions = features.map((f, k): Motion => {
    const from = centres[k], to: V3 = [0, 0, 0]
    for (const v of f.points) for (let j = 0; j < 3; j++) to[j] += moved[v * 3 + j] / f.points.length
    if (f.centred) to[0] = 0
    const a: number[] = [], b: number[] = []
    for (const v of f.points) for (let j = 0; j < 3; j++) { a.push(base[v * 3 + j] - from[j]); b.push(moved[v * 3 + j] - to[j]) }
    return { from, to, R: bestRotation(a, b, f.centred), scale: 1 + (f.size ? s[f.size] : 0) }
  })
  const points = new Float64Array(base.length)
  for (let i = 0; i < n; i++) {
    if (owner[i] >= 0) {
      applyMotion(motions[owner[i]], base.subarray(i * 3, i * 3 + 3), points, i * 3)
      if (base[i * 3] === 0) points[i * 3] = 0
      continue
    }
    let x = moved[i * 3], y = moved[i * 3 + 1], z = moved[i * 3 + 2]
    for (const [k, w] of blends[i]) {
      applyMotion(motions[k], base.subarray(i * 3, i * 3 + 3), tmp)
      x += w * (tmp[0] - moved[i * 3]); y += w * (tmp[1] - moved[i * 3 + 1]); z += w * (tmp[2] - moved[i * 3 + 2])
    }
    points[i * 3] = base[i * 3] === 0 ? 0 : x; points[i * 3 + 1] = y; points[i * 3 + 2] = z
  }
  const motion = Object.fromEntries(features.map((f, k) => [f.id, motions[k]])) as Record<FeatureId, Motion>
  const featurePoints = Object.fromEntries(features.map(f => [f.id, f.points])) as Record<FeatureId, number[]>
  const map = (p: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] => {
    // The field and blends are for the right half; the left half is its mirror image.
    const sx = p[0] < 0 ? -1 : 1, x0 = p[0] * sx, y0 = p[1], z0 = p[2]
    field(x0, y0, z0, s, regions, out)
    const fx = out[0], fy = out[1], fz = out[2]
    let x = fx, y = fy, z = fz
    for (const [k, w] of weightsAt(P, x0, y0, z0)) {
      applyMotion(motions[k], [x0, y0, z0], tmp)
      x += w * (tmp[0] - fx); y += w * (tmp[1] - fy); z += w * (tmp[2] - fz)
    }
    out[0] = x * sx; out[1] = y; out[2] = z
    return out
  }
  return { points, motion, features: featurePoints, map }
}

/** The features of a cage, for checks. */
export const cageFeatures = (cage: CageData = cage250): Feature[] => prepare(cage).features
