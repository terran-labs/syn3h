import * as THREE from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import { attribute, float, uniform, vec3 } from 'three/tsl'
import { vehicleDecoration } from './decoration'
import { heatOwner } from './lavaGlow'
import { mergedSurfaces } from './mergeStatic'
import type { Decorate } from './showroom'

type Paint = { body: THREE.Color; accent: THREE.Color }
type Standard = THREE.MeshStandardMaterial
type StandardNode = THREE.MeshStandardNodeMaterial

interface DistanceGraph {
  color: Node<'vec3'>
  emission: Node<'vec3'>
  roughness: Node<'float'>
  metalness: Node<'float'>
  decorated?: NonNullable<StandardNode['emissiveNode']>
}

const paintByMaterial = new WeakMap<THREE.Material, Paint>()
const fallback = new THREE.Color()
const colorOf = (key: keyof Paint) => uniform(fallback.clone()).onObjectUpdate(({ material }) =>
  (material && paintByMaterial.get(material)?.[key]) || fallback)
const paint = { body: colorOf('body'), accent: colorOf('accent') }
const distanceGraphs = new Map<string, DistanceGraph>()
const rgb = (color: THREE.Color) => [color.r, color.g, color.b] as const

const nearSources = new WeakMap<THREE.Material, readonly Standard[]>()
const nearGraphs = new Map<string, DistanceGraph>()

// The near hull includes live brake, headlamp and cockpit emission. Bind the source
// colours on each draw so two buggies can share a program and still light independently.
function nearGraph(material: StandardNode, sources: readonly Standard[]): DistanceGraph {
  nearSources.set(material, sources)
  const key = JSON.stringify(sources.map(s => [s.roughness, s.metalness, s.emissiveIntensity]))
  const cached = nearGraphs.get(key)
  if (cached) return cached
  const index = attribute('surfaceId', 'float').round()
  let color: Node<'vec3'> = vec3(0), emission: Node<'vec3'> = vec3(0)
  let roughness: Node<'float'> = float(0), metalness: Node<'float'> = float(0)
  for (const [i, surface] of sources.entries()) {
    const read = (field: 'color' | 'emissive') => uniform(new THREE.Color()).onObjectUpdate(
      ({material}) => (material && nearSources.get(material)?.[i]?.[field]) || fallback)
    const mask = index.equal(i).select(1, 0)
    color = color.add(read('color').mul(mask))
    emission = emission.add(read('emissive').mul(surface.emissiveIntensity).mul(mask))
    roughness = roughness.add(mask.mul(surface.roughness))
    metalness = metalness.add(mask.mul(surface.metalness))
  }
  const graph = { color, emission, roughness, metalness }
  nearGraphs.set(key, graph)
  return graph
}

function distanceGraph(sources: readonly Standard[], colors: Paint): DistanceGraph {
  const layout = sources.map(source => ({
    color: source.color === colors.body ? 'body' as const
      : source.color === colors.accent ? 'accent' as const : rgb(source.color),
    emissive: rgb(source.emissive),
    intensity: source.emissiveIntensity,
    roughness: source.roughness,
    metalness: source.metalness,
  }))
  const key = JSON.stringify(layout)
  const previous = distanceGraphs.get(key)
  if (previous) return previous

  const index = attribute('surfaceId', 'float').round()
  let color: Node<'vec3'> = vec3(0), emission: Node<'vec3'> = vec3(0)
  let roughness: Node<'float'> = float(0), metalness: Node<'float'> = float(0)
  for (const [i, surface] of layout.entries()) {
    const mask = index.equal(i).select(1, 0)
    const tint = typeof surface.color === 'string' ? paint[surface.color] : vec3(...surface.color)
    color = color.add(tint.mul(mask))
    emission = emission.add(vec3(...surface.emissive).mul(surface.intensity).mul(mask))
    roughness = roughness.add(mask.mul(surface.roughness))
    metalness = metalness.add(mask.mul(surface.metalness))
  }
  const graph = { color, emission, roughness, metalness }
  distanceGraphs.set(key, graph)
  return graph
}

/** The buggy's packed surfaces share plain graphs. The showroom
 * still owns each material and its tier switches, and the skin owns all posed buffers. */
export function decorateBuggyDistance(roots: readonly THREE.Object3D[], colors: Paint, near: readonly THREE.Object3D[] = []): Decorate {
  const entries: { mesh: THREE.Mesh; plain: StandardNode; sources: readonly Standard[] }[] = []
  const liveSources = new Set<StandardNode>()
  for (const root of [...roots, ...near]) root.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshStandardNodeMaterial)) return
    const sources = mergedSurfaces.get(mesh.material)
    if (near.includes(root)) liveSources.add(mesh.material)
    if (sources) entries.push({ mesh, plain: mesh.material, sources })
  })

  return Object.assign((root: THREE.Object3D) => {
    const applied: [StandardNode, DistanceGraph][] = []
    if (heatOwner(root)) {
      for (const { mesh, plain, sources } of entries) {
        if (mesh.material !== plain) continue
        const graph = liveSources.has(plain) ? nearGraph(plain, sources) : distanceGraph(sources, colors)
        paintByMaterial.set(plain, colors)
        plain.colorNode = graph.color
        plain.roughnessNode = graph.roughness
        plain.metalnessNode = graph.metalness
        plain.emissiveNode = graph.decorated ?? graph.emission
        // This opts into the existing per-object heat node without making the material
        // a pooled showroom material. Dispose still belongs to this skin.
        plain.userData.sharedShowroom = true
        if (graph.decorated) plain.userData.nightReadable = plain.userData.lavaGlow = true
        applied.push([plain, graph])
      }
    }
    vehicleDecoration(root)
    for (const [plain, graph] of applied) {
      graph.decorated ??= plain.emissiveNode ?? undefined
      plain.emissiveNode = graph.decorated ?? null
    }
  }, { decorationId: vehicleDecoration.decorationId })
}
