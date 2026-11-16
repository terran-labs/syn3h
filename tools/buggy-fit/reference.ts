/**
 * Reference parts of the loaded buggy, read straight from the two GLB files with no
 * dependencies, in the frame LoadedBuggySkin uses them (see its load and buildHubMotors).
 *
 *   npx tsx tools/buggy-fit/reference.ts          prints parts, triangle counts and bounds
 *
 * Frames:
 * - body, sockets, interior, canopy: buggy-boxarm.glb nodes as authored, already in the game
 *   frame (+X right, +Y up, -Z forward, metres).
 * - strut, shock: buggy-boxarm.glb nodes in their own frame (both carry extras.own_frame).
 * - stator: buggy.glb RimSimple, recentred on its bounding box centre, as `prepare` does.
 *   `statorNear` is the unused Rim, recentred the same way, for reference only.
 * - wings: buggy.glb Wings turned by rotY(pi) * rotX(pi/2), plus its mirror in X. The game
 *   mirrors with scale(-1, 1, 1) and keeps the flipped winding (the wing material is double
 *   sided); here the mirrored triangles are rewound so the pair is consistently wound.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PartName = 'body' | 'sockets' | 'interior' | 'canopy' | 'strut' | 'shock' | 'stator' | 'wings'
export const PART_NAMES: PartName[] = ['body', 'sockets', 'interior', 'canopy', 'strut', 'shock', 'stator', 'wings']

/** Indexed triangle soup with one material name per triangle. */
export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
  /** Material name of each triangle (indices.length / 3 entries). */
  materials: string[]
}

export interface ReferencePart extends Mesh {
  name: string
  source: string
  /** Node extras (the Shock carries foot and tops anchors). */
  extras?: Record<string, unknown>
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Column-major 4x4 matrices, as glTF stores them.
type M4 = number[]
const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): M4 {
  const [x, y, z, w] = q
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}
const rotX = (a: number): M4 => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]
const rotY = (a: number): M4 => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Gltf { json: any; bin: Buffer }

function readGlb(file: string): Gltf {
  const b = readFileSync(file)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`)
  let offset = 12, json: any, bin: Buffer | undefined
  while (offset < b.length) {
    const length = b.readUInt32LE(offset), type = b.readUInt32LE(offset + 4)
    const chunk = b.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'))
    else if (type === 0x004e4942) bin = chunk
    offset += 8 + length
  }
  if (!json || !bin) throw new Error(`${file} lacks a JSON or BIN chunk`)
  return { json, bin }
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
function accessor(g: Gltf, index: number): number[] {
  const a = g.json.accessors[index], view = g.json.bufferViews[a.bufferView]
  const n = COMPONENTS[a.type], size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType]
  const stride = view.byteStride || n * size, base = (view.byteOffset || 0) + (a.byteOffset || 0)
  const out: number[] = []
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) {
    const at = base + i * stride + c * size
    out.push(a.componentType === 5126 ? g.bin.readFloatLE(at) : a.componentType === 5125 ? g.bin.readUInt32LE(at) : a.componentType === 5123 ? g.bin.readUInt16LE(at) : g.bin.readUInt8(at))
  }
  return out
}

/** World matrix of every node, by walking the scene graph. */
function worldMatrices(g: Gltf): M4[] {
  const out: M4[] = []
  const visit = (i: number, parent: M4) => {
    const n = g.json.nodes[i]
    const local = n.matrix ? n.matrix : trs(n.translation, n.rotation, n.scale)
    out[i] = mul(parent, local)
    for (const c of n.children ?? []) visit(c, out[i])
  }
  for (const s of g.json.scenes) for (const i of s.nodes) visit(i, identity())
  return out
}

/** A node by name, allowing Blender's numeric suffix ('Body.001'), as LoadedBuggySkin's nodeNamed. */
function nodeIndex(g: Gltf, name: string): number {
  const re = new RegExp(`^${name}(\\.?\\d+)?$`)
  const i = g.json.nodes.findIndex((n: any) => re.test(n.name ?? ''))
  if (i < 0) throw new Error(`no node ${name}`)
  return i
}

/** Every triangle of one node (and its descendants), transformed by `transform * world`. */
function nodeMesh(g: Gltf, name: string, transform = identity()): Mesh & { extras?: Record<string, unknown> } {
  const world = worldMatrices(g), root = nodeIndex(g, name)
  const positions: number[] = [], indices: number[] = [], materials: string[] = []
  const visit = (i: number) => {
    const n = g.json.nodes[i], m = mul(transform, world[i])
    if (n.mesh !== undefined) for (const p of g.json.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) continue
      const base = positions.length / 3, pos = accessor(g, p.attributes.POSITION)
      for (let v = 0; v < pos.length; v += 3) {
        const [x, y, z] = [pos[v], pos[v + 1], pos[v + 2]]
        positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
      }
      const idx = p.indices !== undefined ? accessor(g, p.indices) : Array.from({ length: pos.length / 3 }, (_, k) => k)
      const material = p.material !== undefined ? g.json.materials[p.material].name ?? `material${p.material}` : 'none'
      for (let k = 0; k < idx.length; k += 3) { indices.push(base + idx[k], base + idx[k + 1], base + idx[k + 2]); materials.push(material) }
    }
    for (const c of n.children ?? []) visit(c)
  }
  visit(root)
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), materials, extras: g.json.nodes[root].extras }
}

export function bounds(positions: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], positions[i + c]); max[c] = Math.max(max[c], positions[i + c])
  }
  return { min, max }
}

function recentre(mesh: Mesh): Mesh {
  const { min, max } = bounds(mesh.positions)
  const c = [0, 1, 2].map(k => (min[k] + max[k]) / 2)
  for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) mesh.positions[i + k] -= c[k]
  return mesh
}

/** The wing and its mirror in X, the mirrored triangles rewound. */
function mirrored(mesh: Mesh): Mesh {
  const n = mesh.positions.length / 3
  const positions = new Float32Array(n * 6), indices = new Uint32Array(mesh.indices.length * 2)
  positions.set(mesh.positions)
  for (let i = 0; i < n; i++) { positions[(n + i) * 3] = -mesh.positions[i * 3]; positions[(n + i) * 3 + 1] = mesh.positions[i * 3 + 1]; positions[(n + i) * 3 + 2] = mesh.positions[i * 3 + 2] }
  indices.set(mesh.indices)
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const o = mesh.indices.length + t
    indices[o] = mesh.indices[t] + n; indices[o + 1] = mesh.indices[t + 2] + n; indices[o + 2] = mesh.indices[t + 1] + n
  }
  return { positions, indices, materials: [...mesh.materials, ...mesh.materials] }
}

let cache: Record<string, ReferencePart> | undefined

/** Every reference part, keyed by part name (plus `statorNear`, the unused Rim). */
export function loadReference(root = ROOT): Record<PartName | 'statorNear', ReferencePart> {
  if (cache) return cache as Record<PartName | 'statorNear', ReferencePart>
  const boxarm = readGlb(resolve(root, 'public/models/buggy-boxarm.glb'))
  const original = readGlb(resolve(root, 'public/models/buggy.glb'))
  const out: Record<string, ReferencePart> = {}
  const add = (part: string, source: string, node: string, mesh: Mesh & { extras?: Record<string, unknown> }) => { out[part] = { name: node, source, ...mesh } }
  for (const [part, node] of [['body', 'Body'], ['sockets', 'Sockets'], ['interior', 'Interior'], ['canopy', 'Canopy'], ['strut', 'Strut'], ['shock', 'Shock']])
    add(part, 'buggy-boxarm.glb', node, nodeMesh(boxarm, node))
  add('stator', 'buggy.glb', 'RimSimple', recentre(nodeMesh(original, 'RimSimple')))
  add('statorNear', 'buggy.glb', 'Rim', recentre(nodeMesh(original, 'Rim')))
  add('wings', 'buggy.glb', 'Wings', mirrored(nodeMesh(original, 'Wings', mul(rotY(Math.PI), rotX(Math.PI / 2)))))
  cache = out
  return out as Record<PartName | 'statorNear', ReferencePart>
}

/** Mesh to a three.js BufferGeometry: one group per run of equal material, names in userData.materials. */
export async function toBufferGeometry(mesh: Mesh) {
  const THREE = await import('three')
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  const names: string[] = []
  let start = 0
  for (let t = 1; t <= mesh.materials.length; t++) if (t === mesh.materials.length || mesh.materials[t] !== mesh.materials[start]) {
    if (!names.includes(mesh.materials[start])) names.push(mesh.materials[start])
    g.addGroup(start * 3, (t - start) * 3, names.indexOf(mesh.materials[start])); start = t
  }
  g.userData.materials = names
  g.computeVertexNormals()
  return g
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fmt = (v: number[]) => v.map(x => x.toFixed(3).padStart(7)).join(' ')
  for (const [part, p] of Object.entries(loadReference())) {
    const { min, max } = bounds(p.positions)
    const counts = new Map<string, number>()
    for (const m of p.materials) counts.set(m, (counts.get(m) ?? 0) + 1)
    console.log(`${part.padEnd(10)} ${p.source}:${p.name.padEnd(9)} ${String(p.indices.length / 3).padStart(5)} tris ${String(p.positions.length / 3).padStart(5)} verts  min ${fmt(min)}  max ${fmt(max)}`)
    console.log(`           ${[...counts].map(([m, n]) => `${m} ${n}`).join(', ')}`)
  }
}
