// The buggy body as a coarse control cage plus run-time Loop subdivision.
//
// A cage stores half the body (x >= 0); vertices with x exactly 0 lie on the mirror plane and
// are shared by both halves. Coordinates are integers in millimetres. Every face carries a
// role tag; edges between roles are crisp automatically, and `c` lists any further crisp edges.
// Detail 0, 1 and 2 subdivide `levels[detail]` times.
import * as THREE from 'three'
import {subdivide, type Cage} from './subdivide'

export interface CageData {
  /** Role names, indexed by the face tags. */
  roles: string[]
  /** Half cage vertex coordinates, integer millimetres, xyz. */
  v: number[]
  /** Triangles of the half cage, counter clockwise from outside. */
  f: number[]
  /** Role tag per triangle. */
  t: number[]
  /** Crease edges of the half cage as vertex pairs. */
  c: number[]
  /** Subdivision levels for detail 0, 1 and 2. */
  levels: [number, number, number]
}

export interface BodyPart { part: 'body'; role: string; geometry: THREE.BufferGeometry }
export interface Candidate { id: string; build(detail: 0 | 1 | 2): BodyPart[]; numbers?: number }

/** Mirrors the half cage into the full cage, in metres. */
export function fullCage(d: CageData): Cage {
  const n = d.v.length / 3, mirror = new Uint32Array(n)
  const positions: number[] = d.v.map(x => x / 1000)
  for (let i = 0; i < n; i++) {
    if (d.v[i * 3] === 0) { mirror[i] = i; continue }
    mirror[i] = positions.length / 3
    positions.push(-positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
  }
  const faces = [...d.f], tags = [...d.t], creases = [...d.c]
  for (let i = 0; i < d.f.length; i += 3) faces.push(mirror[d.f[i]], mirror[d.f[i + 2]], mirror[d.f[i + 1]])
  tags.push(...d.t)
  for (const v of d.c) creases.push(mirror[v])
  return {positions, faces, tags, creases}
}

/** Corner normals: each corner averages the faces of its role around it that bend less than about 40 degrees. */
export function cornerNormals(positions: Float32Array, faces: Uint32Array, tags: Uint8Array): Float32Array {
  const faceCount = faces.length / 3, fn = new Float32Array(faceCount * 3)
  const vertexCount = positions.length / 3, count = new Uint32Array(vertexCount + 1)
  for (let f = 0; f < faceCount; f++) {
    const a = faces[f * 3] * 3, b = faces[f * 3 + 1] * 3, c = faces[f * 3 + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    fn[f * 3] = uy * vz - uz * vy; fn[f * 3 + 1] = uz * vx - ux * vz; fn[f * 3 + 2] = ux * vy - uy * vx
    for (let k = 0; k < 3; k++) count[faces[f * 3 + k] + 1]++
  }
  for (let v = 0; v < vertexCount; v++) count[v + 1] += count[v]
  const incident = new Uint32Array(count[vertexCount]), fill = count.slice(0, vertexCount)
  for (let f = 0; f < faceCount; f++) for (let k = 0; k < 3; k++) incident[fill[faces[f * 3 + k]]++] = f
  const out = new Float32Array(faceCount * 9), cos = Math.cos(40 * Math.PI / 180)
  for (let f = 0; f < faceCount; f++) {
    const nx = fn[f * 3], ny = fn[f * 3 + 1], nz = fn[f * 3 + 2], nl = Math.hypot(nx, ny, nz) || 1
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k]
      let x = 0, y = 0, z = 0
      for (let i = count[v]; i < count[v + 1]; i++) {
        const g = incident[i]
        if (tags[g] !== tags[f]) continue
        const gx = fn[g * 3], gy = fn[g * 3 + 1], gz = fn[g * 3 + 2]
        if ((gx * nx + gy * ny + gz * nz) / ((Math.hypot(gx, gy, gz) || 1) * nl) < cos) continue
        x += gx; y += gy; z += gz
      }
      const l = Math.hypot(x, y, z) || 1
      out[f * 9 + k * 3] = x / l; out[f * 9 + k * 3 + 1] = y / l; out[f * 9 + k * 3 + 2] = z / l
    }
  }
  return out
}

/** One geometry per role, unindexed so creases keep their split normals. */
export function buildBody(d: CageData, levels: number): BodyPart[] {
  const s = subdivide(fullCage(d), levels)
  const normals = cornerNormals(s.positions, s.faces, s.tags)
  const parts: BodyPart[] = []
  d.roles.forEach((role, r) => {
    let count = 0
    for (let f = 0; f < s.tags.length; f++) if (s.tags[f] === r) count++
    if (!count) return
    const pos = new Float32Array(count * 9), nor = new Float32Array(count * 9)
    let o = 0
    for (let f = 0; f < s.tags.length; f++) if (s.tags[f] === r) {
      for (let k = 0; k < 3; k++) { const v = s.faces[f * 3 + k] * 3; pos[o + k * 3] = s.positions[v]; pos[o + k * 3 + 1] = s.positions[v + 1]; pos[o + k * 3 + 2] = s.positions[v + 2] }
      nor.set(normals.subarray(f * 9, f * 9 + 9), o); o += 9
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    parts.push({part: 'body', role: role.replace(/:.*/, ''), geometry})
  })
  return parts
}

export function candidate(id: string, d: CageData): Candidate {
  return {id, build: detail => buildBody(d, d.levels[detail]), numbers: d.v.length + d.f.length + d.t.length + d.c.length}
}
