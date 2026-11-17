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
import { bounds, referenceParts, type Mesh, type PartName, type ReferencePart } from './glb'

export { PART_NAMES, bounds, type Mesh, type PartName, type ReferencePart } from './glb'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

let cache: Record<PartName | 'statorNear', ReferencePart> | undefined

/** Every reference part, keyed by part name (plus `statorNear`, the unused Rim). */
export function loadReference(root = ROOT): Record<PartName | 'statorNear', ReferencePart> {
  cache ??= referenceParts(readFileSync(resolve(root, 'tools/models/buggy-boxarm.glb')), readFileSync(resolve(root, 'tools/models/buggy.glb')))
  return cache
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
