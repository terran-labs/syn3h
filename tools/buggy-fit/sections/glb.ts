/**
 * Throwaway GLB reader for the section fit: reads one mesh node's primitives as flat
 * triangle soups, one per material. Node transforms in buggy-boxarm.glb are identity, so the
 * positions are already in the game frame. Offline only; never shipped.
 */
import { readFileSync } from 'node:fs'

export interface Prim { material: string; pos: Float32Array; idx: Uint32Array }

export function readMesh(file: string, node: string): Prim[] {
  const b = readFileSync(file), jl = b.readUInt32LE(12)
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'))
  const binStart = 20 + jl + 8
  const n = j.nodes.find((x: { name: string }) => x.name === node || x.name.replace(/\.\d+$/, '') === node)
  if (!n) throw new Error(`no node ${node}`)
  const acc = (i: number) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], off = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string]!, count = a.count * comps
    const ab = b.buffer.slice(b.byteOffset + off, b.byteOffset + off + count * (a.componentType === 5126 || a.componentType === 5125 ? 4 : 2))
    if (a.componentType === 5126) return new Float32Array(ab)
    if (a.componentType === 5125) return new Uint32Array(ab)
    return Uint32Array.from(new Uint16Array(ab))
  }
  return j.meshes[n.mesh].primitives.map((p: { attributes: { POSITION: number }; indices: number; material: number }) => ({
    material: j.materials[p.material].name, pos: acc(p.attributes.POSITION) as Float32Array, idx: Uint32Array.from(acc(p.indices)),
  }))
}

/** All triangles of a node as [ax,ay,az,bx,...] per triangle, with a material index per triangle. */
export function triangles(prims: Prim[]): { tri: Float32Array; mat: Uint8Array; names: string[] } {
  const total = prims.reduce((s, p) => s + p.idx.length / 3, 0), tri = new Float32Array(total * 9), mat = new Uint8Array(total)
  let t = 0
  prims.forEach((p, m) => {
    for (let i = 0; i < p.idx.length; i += 3, t++) {
      for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) tri[t * 9 + k * 3 + c] = p.pos[p.idx[i + k] * 3 + c]
      mat[t] = m
    }
  })
  return { tri, mat, names: prims.map(p => p.material) }
}

export const REF = new URL('../../../public/models/buggy-boxarm.glb', import.meta.url).pathname
