import * as THREE from 'three/webgpu'

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
 * Frame: the game's, +X right, +Y up, -Z forward, metres.
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

/** What a cell of the skin is, from its centre and its normal; null leaves the cell out (an opening). */
export type Tagger = (x: number, y: number, z: number, n: [number, number, number]) => Role | null

/**
 * Skin `sections` as one grid of `along` rings by `half * 2` columns, closed around and
 * capped at both ends. `us` optionally places the rings (u values, ascending). Normals come
 * from the grid's own tangents, so cells of different roles still shade as one surface.
 */
export function skin(sections: Sections, along: number, half: number, tag: Tagger = () => 'paint', o: { us?: number[]; caps?: boolean | [boolean, boolean]; vs?: number[]; warp?: (p: THREE.Vector3) => void; creases?: number[]; creaseRing?: (j: number, u: number) => boolean } = {}): BodyPiece[] {
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
  if (o.warp) { const v = new THREE.Vector3(); for (let k = 0; k < P.length; k += 3) { v.set(P[k], P[k + 1], P[k + 2]); o.warp(v); P[k] = v.x; P[k + 1] = v.y; P[k + 2] = v.z } }
  /** Index of grid point (j, i), rings clamped, columns wrapped. */
  const at = (j: number, i: number) => (Math.min(Math.max(j, 0), m - 1) * N + ((i % N) + N) % N) * 3
  /** Cross product of (a1 - a0) and (b1 - b0), normalised, written to out at k. */
  const crossInto = (out: Float32Array, k: number, a0: number, a1: number, b0: number, b1: number) => {
    const ax = P[a1] - P[a0], ay = P[a1 + 1] - P[a0 + 1], az = P[a1 + 2] - P[a0 + 2]
    let bx = P[b1] - P[b0], by = P[b1 + 1] - P[b0 + 1], bz = P[b1 + 2] - P[b0 + 2]
    if (bx * bx + by * by + bz * bz < 1e-12) { bx = 0; by = 0; bz = 1 }
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, l = Math.hypot(x, y, z) || 1
    out[k] = x / l; out[k + 1] = y / l; out[k + 2] = z / l
  }
  // Vertex normals: around-tangent cross along-tangent points out for this ring order.
  const Nn = new Float32Array(P.length)
  for (let j = 0; j < m; j++) for (let i = 0; i < N; i++) crossInto(Nn, (j * N + i) * 3, at(j, i - 1), at(j, i + 1), at(j - 1, i), at(j + 1, i))
  // Crease columns: vertices on them take a normal from the cell's own side, so the surface
  // folds crisply along that grid line and stays smooth everywhere else. `creaseRing` can turn
  // the fold off near the ends, where the columns converge and a fold would only show shards.
  const creaseCol = new Uint8Array(N)
  for (let i = 0; i < N; i++) { const v = i <= H ? vs[i] : vs[N - i]; if (o.creases?.some(c => Math.abs(c - v) < 1e-6)) creaseCol[i] = 1 }
  const creaseRow = Uint8Array.from(us, (u, j) => o.creaseRing ? +o.creaseRing(j, u) : 1)
  /** Per role: positions, normals, indices, and the index already given to each grid vertex variant. */
  const pieces = new Map<Role, { pos: number[]; nor: number[]; idx: number[]; seen: Int32Array }>()
  const side = new Float32Array(3)
  const vertex = (g: { pos: number[]; nor: number[]; seen: Int32Array }, j: number, ii: number, cell: number) => {
    const k = (j * N + ii) * 3, crease = creaseCol[ii] && creaseRow[j], variant = crease ? (cell === ii ? 1 : 2) : 0, key = k + variant
    let id = g.seen[key]
    if (id >= 0) return id
    id = g.seen[key] = g.pos.length / 3
    g.pos.push(P[k], P[k + 1], P[k + 2])
    if (crease) { crossInto(side, 0, at(j, cell), at(j, cell + 1), at(j - 1, ii), at(j + 1, ii)); g.nor.push(side[0], side[1], side[2]) }
    else g.nor.push(Nn[k], Nn[k + 1], Nn[k + 2])
    return id
  }
  const group = (role: Role) => { let g = pieces.get(role); if (!g) pieces.set(role, g = { pos: [], nor: [], idx: [], seen: new Int32Array(m * N * 3).fill(-1) }); return g }
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < N; i++) {
    const a = at(j, i), b = at(j + 1, i), c = at(j, i + 1), d = at(j + 1, i + 1)
    const role = tag((P[a] + P[b] + P[c] + P[d]) / 4, (P[a + 1] + P[b + 1] + P[c + 1] + P[d + 1]) / 4, (P[a + 2] + P[b + 2] + P[c + 2] + P[d + 2]) / 4,
      [(Nn[a] + Nn[d]) / 2, (Nn[a + 1] + Nn[d + 1]) / 2, (Nn[a + 2] + Nn[d + 2]) / 2])
    if (!role) continue
    const g = group(role), i1 = (i + 1) % N
    const v00 = vertex(g, j, i, i), v01 = vertex(g, j, i1, i), v10 = vertex(g, j + 1, i, i), v11 = vertex(g, j + 1, i1, i)
    g.idx.push(v00, v01, v10, v01, v11, v10)
  }
  // End caps: a fan from the ring's centre, each triangle tagged like a cell facing along Z.
  const caps = Array.isArray(o.caps) ? o.caps : [o.caps !== false, o.caps !== false]
  for (const [j, s, on] of [[0, -1, caps[0]], [m - 1, 1, caps[1]]] as const) {
    if (!on) continue
    let cx = 0, cy = 0, cz = 0; for (let i = 0; i < N; i++) { const k = at(j, i); cx += P[k]; cy += P[k + 1]; cz += P[k + 2] } cx /= N; cy /= N; cz /= N
    for (let i = 0; i < N; i++) {
      const a = at(j, i), b = at(j, i + 1)
      const role = tag((cx + P[a] + P[b]) / 3, (cy + P[a + 1] + P[b + 1]) / 3, (cz + P[a + 2] + P[b + 2]) / 3, [0, 0, s]); if (!role) continue
      const g = group(role), base = g.pos.length / 3
      g.pos.push(cx, cy, cz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2]); g.nor.push(0, 0, s, 0, 0, s, 0, 0, s)
      if (s > 0) g.idx.push(base, base + 1, base + 2); else g.idx.push(base, base + 2, base + 1)
    }
  }
  return [...pieces].map(([role, g]) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3))
    geometry.setIndex(g.idx)
    return { part: 'body' as const, role, geometry }
  })
}

/** Share vertices with equal position and normal, so pieces are indexed like a hand mesh. */
export function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), pos: number[] = [], nor: number[] = [], idx: number[] = []
  const buckets = new Map<number, number[]>(), q = (v: number) => Math.round(v * 1e5)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i)
    const h = (q(x) * 73856093) ^ (q(y) * 19349663) ^ (q(z) * 83492791)
    let list = buckets.get(h), k = -1
    if (list) for (const c of list) if (q(pos[c * 3]) === q(x) && q(pos[c * 3 + 1]) === q(y) && q(pos[c * 3 + 2]) === q(z) && Math.abs(nor[c * 3] - nx) + Math.abs(nor[c * 3 + 1] - ny) + Math.abs(nor[c * 3 + 2] - nz) < 2e-3) { k = c; break }
    if (k < 0) { k = pos.length / 3; pos.push(x, y, z); nor.push(nx, ny, nz); if (list) list.push(k); else buckets.set(h, [k]) }
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

/**
 * A feature drawn on the skin: an ellipse in one of the three planes, mirrored in X, whose
 * cells take `role` (null cuts an opening). It applies only within `band` along the plane's
 * missing axis (y for 'xz', |x| for 'zy', z for 'xy') and to cells whose normal points the
 * way `facing` says along that axis, so a side scoop does not also print on the floor. Grid
 * vertices within `snap` metres of the edge move onto it, so the edge follows the ellipse
 * instead of the grid's staircase. A radius over 10 m makes a straight stripe.
 */
export interface Ellipse { role: Role | null; plane: 'xz' | 'zy' | 'xy'; c: [number, number]; r: [number, number]; band: [number, number]; facing: number; snap?: number; /** Turns the ellipse in its plane, radians. */ tilt?: number }

const coords = (e: Ellipse, x: number, y: number, z: number): [number, number, number] => e.plane === 'xz' ? [Math.abs(x), z, y] : e.plane === 'zy' ? [z, y, Math.abs(x)] : [Math.abs(x), y, z]
const facingOf = (e: Ellipse, n: [number, number, number], x: number) => e.plane === 'xz' ? n[1] : e.plane === 'zy' ? n[0] * (Math.sign(x) || 1) : n[2]
/** Ellipse measure: below 1 is inside. A centre at 0 across X makes one ellipse over both halves. */
const local = (e: Ellipse, a: number, b: number): [number, number] => {
  const da = a - e.c[0], db = b - e.c[1], t = e.tilt ?? 0, cs = Math.cos(t), sn = Math.sin(t)
  return [da * cs + db * sn, -da * sn + db * cs]
}
const measureE = (e: Ellipse, a: number, b: number) => { const [u, w] = local(e, a, b); return Math.hypot(u / e.r[0], e.r[1] > 10 ? 0 : w / e.r[1]) }

/** Tag cells by the first feature that contains them, else by `rest`. */
export function featureTagger(list: Ellipse[], rest: Tagger): Tagger {
  return (x, y, z, n) => {
    for (const e of list) {
      const [a, b, w] = coords(e, x, y, z)
      if (w < e.band[0] || w > e.band[1] || facingOf(e, n, x) * Math.sign(e.facing) < Math.abs(e.facing)) continue
      if (measureE(e, a, b) < 1) return e.role
    }
    return rest(x, y, z, n)
  }
}

/** Move grid vertices close to a feature's edge onto it, scaling about the centre. */
export function featureWarp(list: Ellipse[]): (p: THREE.Vector3) => void {
  return p => {
    for (const e of list) {
      const [a, b, w] = coords(e, p.x, p.y, p.z)
      if (!e.snap || w < e.band[0] || w > e.band[1]) continue
      const m = measureE(e, a, b); if (m < 1e-6) continue
      // Scaling about the centre onto m = 1 is the same in the turned frame, so no turn is needed here.
      const na = e.c[0] + (a - e.c[0]) / m, nb = e.r[1] > 10 ? b : e.c[1] + (b - e.c[1]) / m
      if (Math.hypot(na - a, nb - b) > e.snap) continue
      const sx = Math.sign(p.x) || 1
      if (e.plane === 'xz') { if (p.x !== 0) p.x = sx * Math.max(na, 0); p.z = nb }
      else if (e.plane === 'zy') { p.z = na; p.y = nb }
      else { if (p.x !== 0) p.x = sx * Math.max(na, 0); p.y = nb }
      return
    }
  }
}
