/**
 * The GLB reader behind reference.ts, free of Node APIs so the vehicle lab exhibit can run the
 * same extraction in the browser. See reference.ts for the frames.
 */
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
interface Gltf { json: any; bin: DataView }

function readGlb(bytes: Uint8Array, label: string): Gltf {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.getUint32(0, true) !== 0x46546c67) throw new Error(`${label} is not a GLB`)
  let offset = 12, json: any, bin: DataView | undefined
  while (offset < b.byteLength) {
    const length = b.getUint32(offset, true), type = b.getUint32(offset + 4, true)
    const chunk = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
    else if (type === 0x004e4942) bin = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    offset += 8 + length
  }
  if (!json || !bin) throw new Error(`${label} lacks a JSON or BIN chunk`)
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
    out.push(a.componentType === 5126 ? g.bin.getFloat32(at, true) : a.componentType === 5125 ? g.bin.getUint32(at, true) : a.componentType === 5123 ? g.bin.getUint16(at, true) : g.bin.getUint8(at))
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

/** Every reference part from the bytes of buggy-boxarm.glb and buggy.glb (see reference.ts for frames). */
export function referenceParts(boxarmBytes: Uint8Array, originalBytes: Uint8Array): Record<PartName | 'statorNear', ReferencePart> {
  const boxarm = readGlb(boxarmBytes, 'buggy-boxarm.glb'), original = readGlb(originalBytes, 'buggy.glb')
  const out: Record<string, ReferencePart> = {}
  const add = (part: string, source: string, node: string, mesh: Mesh & { extras?: Record<string, unknown> }) => { out[part] = { name: node, source, ...mesh } }
  for (const [part, node] of [['body', 'Body'], ['sockets', 'Sockets'], ['interior', 'Interior'], ['canopy', 'Canopy'], ['strut', 'Strut'], ['shock', 'Shock']])
    add(part, 'buggy-boxarm.glb', node, nodeMesh(boxarm, node))
  add('stator', 'buggy.glb', 'RimSimple', recentre(nodeMesh(original, 'RimSimple')))
  add('statorNear', 'buggy.glb', 'Rim', recentre(nodeMesh(original, 'Rim')))
  add('wings', 'buggy.glb', 'Wings', mirrored(nodeMesh(original, 'Wings', mul(rotY(Math.PI), rotX(Math.PI / 2)))))
  return out as Record<PartName | 'statorNear', ReferencePart>
}
