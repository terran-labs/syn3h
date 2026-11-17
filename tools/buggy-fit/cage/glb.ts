// Throwaway GLB reader for the cage lane: reads one node's mesh into flat arrays in the
// node's world frame. Handles float positions and integer indices, no compression.
import {readFileSync} from 'node:fs'

export interface RefMesh { pos: Float32Array; index: Uint32Array; group: Uint8Array; materials: string[] }

type Json = Record<string, any>

function mat4Mul(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]
  return r
}
function nodeMatrix(n: Json): number[] {
  if (n.matrix) return n.matrix
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1]
}

export function readGlb(path: string): { json: Json; bin: Buffer } {
  const buf = readFileSync(path)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  const binStart = 20 + jsonLen
  const binLen = buf.readUInt32LE(binStart)
  return {json, bin: buf.subarray(binStart + 8, binStart + 8 + binLen)}
}

function accessor(json: Json, bin: Buffer, i: number): ArrayLike<number> {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView]
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comps = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type as string]!
  const n = a.count * comps
  const ab = bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * ({5126: 4, 5125: 4, 5123: 2, 5121: 1}[a.componentType as number]!))
  if (v.byteStride && v.byteStride !== comps * 4) throw new Error('strided accessor not supported')
  switch (a.componentType) {
    case 5126: return new Float32Array(ab)
    case 5125: return new Uint32Array(ab)
    case 5123: return new Uint16Array(ab)
    case 5121: return new Uint8Array(ab)
  }
  throw new Error('bad component type')
}

/** The named node's mesh, transformed by its world matrix, with per-triangle material group. */
export function readNode(path: string, name: string): RefMesh {
  const {json, bin} = readGlb(path)
  const parent = new Map<number, number>()
  json.nodes.forEach((n: Json, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)))
  const ni = json.nodes.findIndex((n: Json) => n.name === name)
  if (ni < 0) throw new Error(`no node ${name}: ${json.nodes.map((n: Json) => n.name).join(', ')}`)
  let m = nodeMatrix(json.nodes[ni])
  for (let p = parent.get(ni); p !== undefined; p = parent.get(p)) m = mat4Mul(nodeMatrix(json.nodes[p]), m)
  const mesh = json.meshes[json.nodes[ni].mesh]
  const pos: number[] = [], index: number[] = [], group: number[] = [], materials: string[] = []
  for (const prim of mesh.primitives) {
    const base = pos.length / 3
    const P = accessor(json, bin, prim.attributes.POSITION)
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2]
      pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
    }
    const I = accessor(json, bin, prim.indices)
    const mat = json.materials[prim.material]?.name ?? 'none'
    let g = materials.indexOf(mat); if (g < 0) { g = materials.length; materials.push(mat) }
    for (let i = 0; i < I.length; i++) index.push(I[i] + base)
    for (let i = 0; i < I.length / 3; i++) group.push(g)
  }
  return {pos: new Float32Array(pos), index: new Uint32Array(index), group: new Uint8Array(group), materials}
}
