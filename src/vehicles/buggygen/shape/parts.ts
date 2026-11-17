import type * as THREE from 'three/webgpu'
import { buildParts, type PartPiece } from '../parts'
import { buggyBody } from '../body'
import { isDefaultShape, type Shape } from './handles'
import { shapedBody } from './body'
import { applyMotion, rig as makeRig, type Motion, type Rig } from './rig'

/**
 * The buggy's other parts following a shaped body. They are built once against the shipped
 * body, exactly as the game builds them, then moved:
 *
 * - canopy and cockpit tub with the cockpit rim's rigid motion (so they stay on the rim and
 *   inside the body, and scale with it);
 * - headlight lenses and bezels with the headlight duct's rigid motion (they stay seated);
 * - skid plate and the swellings over the arm roots and shock tops by the rig's field;
 * - suspension, hub stators and wings not at all: the wheels, axle mounts and shock tops are
 *   the physics' and do not move.
 *
 * The shock tops are the shipped body's, unchanged.
 */
type Built = ReturnType<typeof buildParts>

const shipped = new Map<number, Built>()
function shippedParts(detail: 0 | 1 | 2): Built {
  let b = shipped.get(detail)
  if (!b) shipped.set(detail, b = buildParts(detail, buggyBody.build(detail).filter(p => p.part === 'body').map(p => p.geometry)))
  return b
}

/** A motion for a point on either half: the rig's motions are for the right half (x >= 0). */
function moveMirrored(m: Motion, p: number[], out: number[]): void {
  const sx = p[0] < 0 ? -1 : 1
  applyMotion(m, [p[0] * sx, p[1], p[2]], out)
  out[0] *= sx
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

/** Every part at one detail level, following the shaped body. */
export function shapedParts(s: Shape, detail: 0 | 1 | 2, body: THREE.BufferGeometry[], r?: Rig): Built {
  if (isDefaultShape(s)) return buildParts(detail, body)
  const R = r ?? makeRig(s), base = shippedParts(detail), cockpit = R.motion.cockpit, duct = R.motion.headlight
  const pieces: PartPiece[] = base.pieces.map(piece => {
    const g = piece.geometry
    if (piece.part === 'canopy' || piece.part === 'interior') return { ...piece, geometry: moved(g, (p, _, o) => applyMotion(cockpit, p, o)) }
    if (piece.part !== 'sockets') return { ...piece, geometry: g.clone() }
    // Sockets: lenses and bezels ride with the duct they sit in, the rest with the field.
    const label = islands(g), pos = g.attributes.position, centre = new Map<number, number[]>()
    for (let i = 0; i < pos.count; i++) {
      const c = centre.get(label[i]) ?? [0, 0, 0, 0]
      c[0] += Math.abs(pos.getX(i)); c[1] += pos.getY(i); c[2] += pos.getZ(i); c[3]++
      centre.set(label[i], c)
    }
    const inDuct = new Set<number>()
    for (const [k, c] of centre) if (Math.hypot(c[0] / c[3] - duct.from[0], c[1] / c[3] - duct.from[1], c[2] / c[3] - duct.from[2]) < DUCT_REACH) inDuct.add(k)
    return { ...piece, geometry: moved(g, (p, i, o) => { if (inDuct.has(label[i])) moveMirrored(duct, p, o); else R.map(p, o) }) }
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
