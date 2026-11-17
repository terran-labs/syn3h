import * as THREE from 'three'

/**
 * Section lofts for the generated buggy body (R&D, rd/buggygen-sections).
 *
 * The body is a stack of stations along Z. Each station describes the right half of a closed
 * cross section; the left half is its mirror. Stations are blended along Z with Catmull-Rom,
 * as the jet's bodyRings does, and the outline within a station is either a superellipse
 * (Level A, a handful of editable numbers) or a polar curve of K radii about a centre
 * (Level B, fitted automatically). The skin is one grid; a role function tags each cell
 * (paint, accent, chrome, lamp, frame) or skips it to cut an opening.
 *
 * Frame: the game's, +X right, +Y up, -Z forward, metres. Imports `three`, not
 * `three/webgpu`, so the offline harness can run it in Node; the classes are the same.
 */

export type Role = 'paint' | 'accent' | 'chrome' | 'lamp' | 'frame' | 'trim'
export interface BodyPiece { part: 'body'; role: Role; geometry: THREE.BufferGeometry }
export interface Candidate { id: string; build(detail: 0 | 1 | 2): BodyPiece[]; numbers?: number }

/**
 * Catmull-Rom over `rows` (each a list of numbers) at u in 0..1 across the rows. `mirror`
 * reflects the ends instead of clamping them: a half outline is symmetric about its poles,
 * so the curve meets the mirror line square.
 */
export function crRows(rows: ArrayLike<number>[], u: number, mirror = false): number[] {
  const K = rows.length - 1, x = Math.min(Math.max(u, 0), 1) * K, i = Math.min(Math.floor(x), K - 1), f = x - i
  const at = (k: number) => rows[mirror ? (k < 0 ? -k : k > K ? 2 * K - k : k) : Math.min(Math.max(k, 0), K)]
  const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2), out: number[] = []
  for (let k = 0; k < b.length; k++) out.push(.5 * (2 * b[k] + (-a[k] + c[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f))
  return out
}

/** A half outline: v runs 0 (bottom of the mirror line) to 1 (top of it). Returns [x, y]. */
export type Half = (v: number) => [number, number]
/** A section along the body: u runs 0 (nose) to 1 (tail). Returns z and the outline there. */
export type Sections = (u: number) => { z: number; half: Half }

/**
 * Level A outline: [z, halfWidth, top, bottom, centreY, exponent, bottomExponent], the jet's
 * bodyRings row with an optional second exponent for the lower half (a flat floor under a
 * rounded deck). Bigger exponents are squarer.
 */
export function superSections(rows: number[][]): Sections {
  return u => {
    const row = crRows(rows, u), [z, w, t, b, y, e] = row, eb = row[6] ?? e
    return { z, half: v => {
      const a = (v - .5) * Math.PI, c = Math.cos(a), s = Math.sin(a), p = 2 / Math.max(s >= 0 ? e : eb, 1.2)
      return [Math.max(w, .002) * Math.abs(c) ** p, y + Math.max(s >= 0 ? t : b, .002) * Math.sign(s) * Math.abs(s) ** p]
    } }
  }
}

/**
 * Level B outline: rows of [z, centreY, r0 ... rK-1], radii at K angles spread evenly from
 * straight down to straight up on the right side, measured from (0, centreY).
 */
export function polarSections(rows: number[][]): Sections {
  return u => {
    const row = crRows(rows, u), z = row[0], y = row[1], r = row.slice(2).map(x => [x])
    return { z, half: v => {
      const a = (v - .5) * Math.PI, d = Math.max(crRows(r, v, true)[0], .002)
      return [d * Math.cos(a), y + d * Math.sin(a)]
    } }
  }
}

/** What a cell of the skin is, from its centre and the Y part of its normal; null leaves the cell out (an opening). */
export type Tagger = (x: number, y: number, z: number, ny: number, v: number) => Role | null

/**
 * Skin `sections` as one grid of `along` rings by `half * 2` columns, closed around and
 * capped at both ends. `us` optionally places the rings (u values, ascending). Normals come
 * from the grid's own tangents, so cells of different roles still shade as one surface.
 */
export function skin(sections: Sections, along: number, half: number, tag: Tagger = () => 'paint', o: { us?: number[]; capRole?: Role | null; vs?: number[] } = {}): BodyPiece[] {
  const us = o.us ?? Array.from({ length: along }, (_, j) => j / (along - 1))
  const vs = o.vs ?? Array.from({ length: half + 1 }, (_, i) => i / half)
  const H = vs.length - 1, N = 2 * H, m = us.length
  const P = new Float32Array(m * N * 3)
  us.forEach((u, j) => {
    const { z, half: h } = sections(u)
    for (let i = 0; i < N; i++) {
      const [x, y] = h(i <= H ? vs[i] : vs[N - i]), k = (j * N + i) * 3
      P[k] = i <= H ? x : -x; P[k + 1] = y; P[k + 2] = z
      if (i === 0 || i === H) P[k] = 0
    }
  })
  const p = (j: number, i: number) => { const k = (Math.min(Math.max(j, 0), m - 1) * N + ((i % N) + N) % N) * 3; return new THREE.Vector3(P[k], P[k + 1], P[k + 2]) }
  // Vertex normals: around-tangent cross along-tangent points out for this ring order.
  const Nn = new Float32Array(P.length)
  for (let j = 0; j < m; j++) for (let i = 0; i < N; i++) {
    const ti = p(j, i + 1).sub(p(j, i - 1)), tj = p(j + 1, i).sub(p(j - 1, i))
    if (tj.lengthSq() < 1e-12) tj.set(0, 0, 1)
    const n = ti.cross(tj).normalize(), k = (j * N + i) * 3
    Nn[k] = n.x; Nn[k + 1] = n.y; Nn[k + 2] = n.z
  }
  const pieces = new Map<Role, { pos: number[]; nor: number[] }>()
  const put = (role: Role, verts: [number, number][]) => {
    let g = pieces.get(role); if (!g) pieces.set(role, g = { pos: [], nor: [] })
    for (const [j, i] of verts) { const k = (j * N + (i % N)) * 3; g.pos.push(P[k], P[k + 1], P[k + 2]); g.nor.push(Nn[k], Nn[k + 1], Nn[k + 2]) }
  }
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < N; i++) {
    const c = p(j, i).add(p(j + 1, i)).add(p(j, i + 1)).add(p(j + 1, i + 1)).multiplyScalar(.25)
    const k0 = (j * N + i) * 3, k1 = ((j + 1) * N + (i + 1) % N) * 3, ny = (Nn[k0 + 1] + Nn[k1 + 1]) / 2
    const role = tag(c.x, c.y, c.z, ny, i < H ? (vs[i] + vs[i + 1]) / 2 : (vs[N - i] + vs[N - i - 1]) / 2)
    if (!role) continue
    put(role, [[j, i], [j, i + 1], [j + 1, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]])
  }
  const capRole = o.capRole === undefined ? 'paint' : o.capRole
  if (capRole) for (const [j, s] of [[0, -1], [m - 1, 1]]) {
    const c = new THREE.Vector3(); for (let i = 0; i < N; i++) c.add(p(j, i)); c.divideScalar(N)
    let g = pieces.get(capRole); if (!g) pieces.set(capRole, g = { pos: [], nor: [] })
    for (let i = 0; i < N; i++) {
      const a = p(j, i), b = p(j, i + 1), tri = s > 0 ? [c, a, b] : [c, b, a]
      for (const q of tri) { g.pos.push(q.x, q.y, q.z); g.nor.push(0, 0, s) }
    }
  }
  return [...pieces].map(([role, g]) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3))
    return { part: 'body' as const, role, geometry: weld(geometry) }
  })
}

/** Share vertices with equal position and normal, so pieces are indexed like a hand mesh. */
export function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), map = new Map<string, number>(), pos: number[] = [], nor: number[] = [], idx: number[] = []
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)},${n.getX(i).toFixed(3)},${n.getY(i).toFixed(3)},${n.getZ(i).toFixed(3)}`
    let k = map.get(key)
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)) }
    idx.push(k)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx)
  return out
}

/** Join pieces of the same role into one geometry each. */
export function byRole(pieces: BodyPiece[]): BodyPiece[] {
  const groups = new Map<Role, THREE.BufferGeometry[]>()
  for (const p of pieces) { const l = groups.get(p.role) ?? []; l.push(p.geometry); groups.set(p.role, l) }
  return [...groups].map(([role, gs]) => {
    const pos: number[] = [], nor: number[] = [], idx: number[] = []
    for (const g of gs) {
      const base = pos.length / 3, P = g.getAttribute('position'), Nn = g.getAttribute('normal')
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i)) }
      const I = g.getIndex(); if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(base + i)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geometry.setIndex(idx)
    return { part: 'body' as const, role, geometry }
  })
}

/** Ring counts per detail level: [along, half columns]. */
export const DETAIL: Record<0 | 1 | 2, [number, number]> = { 0: [64, 22], 1: [26, 10], 2: [11, 5] }
