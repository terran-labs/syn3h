import type * as THREE from 'three/webgpu'
import { buildParts, type PartPiece } from '../parts'
import { buggyBody } from '../body'
import { isDefaultShape, type Shape } from './handles'
import { shapedBody } from './body'
import { applyMotion, fitMotion, rig as makeRig, type Motion, type Rig } from './rig'
import { Surface } from '../parts/surface'

/**
 * The buggy's other parts following a shaped body. They are built once against the shipped
 * body, exactly as the game builds them, then moved:
 *
 * - canopy and cockpit tub with the cockpit rim's rigid motion (so they stay on the rim and
 *   inside the body, and scale with it);
 * - headlight lenses and bezels with the headlight duct's rigid motion (they stay seated);
 * - the other small fittings (the side lamp and its bezel, the swellings over the arm roots
 *   and shock tops) rigidly, by the motion that best follows the rig's field over them, then
 *   along the body's normal so they stand as deep in the shaped body as in the shipped one;
 * - the skid plate, which runs the body's length, by the rig's field point by point;
 * - suspension, hub stators and wings not at all: the wheels, axle mounts and shock tops are
 *   the physics' and do not move.
 *
 * The shock tops are the shipped body's, unchanged.
 */
type Built = ReturnType<typeof buildParts>

const shipped = new Map<number, { parts: Built; surface: Surface }>()
function shippedParts(detail: 0 | 1 | 2): { parts: Built; surface: Surface } {
  let b = shipped.get(detail)
  if (!b) {
    const body = buggyBody.build(detail).filter(p => p.part === 'body').map(p => p.geometry)
    shipped.set(detail, b = { parts: buildParts(detail, body), surface: Surface.from(body) })
  }
  return b
}

/** Connected pieces of an indexed geometry: a label per vertex. */
function islands(g: THREE.BufferGeometry): Int32Array {
  const n = g.attributes.position.count, parent = Int32Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x }
  const idx = g.index
  if (idx) for (let k = 0; k < idx.count; k += 3) { const a = find(idx.getX(k)); for (let j = 1; j < 3; j++) { const b = find(idx.getX(k + j)); if (a !== b) parent[b] = a } }
  else for (let k = 0; k < n; k += 3) { parent[k + 1] = parent[k + 2] = k }
  return Int32Array.from({ length: n }, (_, i) => find(i))
}

/** A copy of `g` with every vertex moved by `f`, normals recomputed. */
function moved(g: THREE.BufferGeometry, f: (p: number[], vertex: number, out: number[]) => void): THREE.BufferGeometry {
  const out = g.clone(), pos = out.attributes.position as THREE.BufferAttribute, p = [0, 0, 0], q = [0, 0, 0]
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i)
    f(p, i, q)
    pos.setXYZ(i, q[0], q[1], q[2])
  }
  pos.needsUpdate = true
  out.computeVertexNormals()
  out.computeBoundingSphere()
  return out
}

/** How close (m) a fitting's centre must be to the duct's centre to ride with it. */
const DUCT_REACH = .24
/** Islands whose centres lie this close together are one fitting (a lens, its bezel and halo). */
const SAME_FITTING = .08
/** A fitting larger than this (m from its centre) is not small: it follows the field point by point. */
const SMALL = .3

/** Signed height of `p` over a surface along the nearest point's normal, and that normal. */
function standoff(surface: Surface, p: number[]): { h: number; n: number[] } | undefined {
  const hit = surface.near(p as [number, number, number], .5).nearest(p as [number, number, number])
  if (!hit) return undefined
  return { h: (p[0] - hit.point[0]) * hit.normal[0] + (p[1] - hit.point[1]) * hit.normal[1] + (p[2] - hit.point[2]) * hit.normal[2], n: hit.normal }
}

/** Every part at one detail level, following the shaped body. */
export function shapedParts(s: Shape, detail: 0 | 1 | 2, body: THREE.BufferGeometry[], r?: Rig): Built {
  if (isDefaultShape(s)) return buildParts(detail, body)
  const R = r ?? makeRig(s), { parts: base, surface: before } = shippedParts(detail), cockpit = R.motion.cockpit, duct = R.motion.headlight
  let after: Surface | undefined
  const sockets = base.pieces.filter(p => p.part === 'sockets')
  // Sockets: group every piece's islands into fittings by their centres (both halves apart).
  const fittings: { centre: number[]; count: number; radius: number; members: [number, number][]; motion?: Motion }[] = []
  const labels = sockets.map(p => islands(p.geometry))
  sockets.forEach((piece, k) => {
    const pos = piece.geometry.attributes.position, sums = new Map<number, number[]>()
    for (let i = 0; i < pos.count; i++) { const c = sums.get(labels[k][i]) ?? [0, 0, 0, 0]; c[0] += pos.getX(i); c[1] += pos.getY(i); c[2] += pos.getZ(i); c[3]++; sums.set(labels[k][i], c) }
    for (const [label, c] of sums) {
      const centre = [c[0] / c[3], c[1] / c[3], c[2] / c[3]]
      let f = fittings.find(x => Math.hypot(x.centre[0] - centre[0], x.centre[1] - centre[1], x.centre[2] - centre[2]) < SAME_FITTING)
      if (!f) fittings.push(f = { centre, count: 0, radius: 0, members: [] })
      f.members.push([k, label])
    }
  })
  const fittingOf = new Map<string, (typeof fittings)[number]>()
  for (const f of fittings) for (const [k, label] of f.members) fittingOf.set(`${k}:${label}`, f)
  for (const f of fittings) {
    // Radius and the field's pull over the fitting's own vertices.
    const a: number[] = [], b: number[] = [], q = [0, 0, 0]
    for (const [k, label] of f.members) {
      const pos = sockets[k].geometry.attributes.position
      for (let i = 0; i < pos.count; i++) if (labels[k][i] === label) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
        f.radius = Math.max(f.radius, Math.hypot(p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]))
        R.map(p, q); a.push(...p); b.push(...q)
      }
    }
    const mirrored = [Math.abs(f.centre[0]), f.centre[1], f.centre[2]]
    if (Math.hypot(mirrored[0] - duct.from[0], mirrored[1] - duct.from[1], mirrored[2] - duct.from[2]) < DUCT_REACH) {
      // In the duct: the duct's own motion (for the left duct, its mirror image).
      const sx = f.centre[0] < 0 ? -1 : 1
      f.motion = sx > 0 ? duct : { from: [-duct.from[0], duct.from[1], duct.from[2]], to: [-duct.to[0], duct.to[1], duct.to[2]], R: [duct.R[0], -duct.R[1], -duct.R[2], -duct.R[3], duct.R[4], duct.R[5], -duct.R[6], duct.R[7], duct.R[8]], scale: duct.scale }
    } else if (f.radius < SMALL) {
      const m = fitMotion(a, b), d0 = standoff(before, f.centre)
      after ??= Surface.from(body)
      const there = applyMotion(m, f.centre) as number[], d1 = d0 && standoff(after, there)
      if (d0 && d1) for (let j = 0; j < 3; j++) m.to[j] += (d0.h - d1.h) * d1.n[j]
      f.motion = m
    }
  }
  const pieces: PartPiece[] = base.pieces.map(piece => {
    const g = piece.geometry
    if (piece.part === 'canopy' || piece.part === 'interior') return { ...piece, geometry: moved(g, (p, _, o) => applyMotion(cockpit, p, o)) }
    if (piece.part !== 'sockets') return { ...piece, geometry: g.clone() }
    const k = sockets.indexOf(piece)
    return { ...piece, geometry: moved(g, (p, i, o) => { const m = fittingOf.get(`${k}:${labels[k][i]}`)?.motion; if (m) applyMotion(m, p, o); else R.map(p, o) }) }
  })
  return { pieces, shockTops: base.shockTops }
}

/**
 * A body source for Syn3hBuggySkin: the shaped body and the parts that follow it. The default
 * shape builds exactly what the game builds.
 */
export function shapedSource(s: Shape) {
  const r = isDefaultShape(s) ? undefined : makeRig(s)
  return {
    build: (detail: 0 | 1 | 2) => shapedBody(s, detail, r),
    parts: (detail: 0 | 1 | 2, body: THREE.BufferGeometry[]) => shapedParts(s, detail, body, r),
  }
}
