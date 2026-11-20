import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import { attribute, float, materialEmissive, uniform, vec3 } from 'three/tsl'
import { vehicleDecoration } from '../skins/decoration'
import { addLavaGlow, heatOwner } from '../skins/lavaGlow'
import { mergedSurfaces } from '../skins/mergeStatic'
import { addNightReadability } from '../skins/nightReadability'
import { applyShowroom, type Decorate } from '../skins/showroom'

type Standard = T.MeshStandardMaterial
type StandardNode = T.MeshStandardNodeMaterial
type Emission = NonNullable<StandardNode['emissiveNode']>

interface PackedGraph {
  readonly colorNode: Node<'vec3'>
  readonly emissiveNode: Node<'vec3'>
  readonly roughnessNode: Node<'float'>
  readonly metalnessNode: Node<'float'>
  decorated?: Emission
}

// Each mesh owns its paint, lights and heat. The graph's cache keys contain the
// packed layout, never an actor's colors, uniform instances, or material IDs.
const packedSources = new WeakMap<T.Object3D, readonly Standard[]>()
const packedGraphs = new Map<string, PackedGraph>()
let plainEmission: Emission | undefined

function packedGraph(sources: readonly Standard[]): PackedGraph {
  const key = sources.map(source => `${source.roughness}/${source.metalness}`).join(',')
  const cached = packedGraphs.get(key)
  if (cached) return cached

  const idx = attribute('surfaceId', 'float')
  let colorNode: Node<'vec3'> = vec3(0), emissiveNode: Node<'vec3'> = vec3(0)
  let roughnessNode: Node<'float'> = float(0), metalnessNode: Node<'float'> = float(0)
  for (const [i, source] of sources.entries()) {
    const mask = idx.round().equal(i).select(1, 0)
    const own = (object: T.Object3D | null | undefined) => object ? packedSources.get(object)?.[i] : undefined
    const fallbackColor = source.color.clone(), fallbackEmission = source.emissive.clone()
    const fallbackIntensity = source.emissiveIntensity
    const color = uniform(fallbackColor).onObjectUpdate(({ object }) => own(object)?.color ?? fallbackColor)
    const emissive = uniform(fallbackEmission).onObjectUpdate(({ object }) => own(object)?.emissive ?? fallbackEmission)
    const intensity = uniform(fallbackIntensity).onObjectUpdate(({ object }) => own(object)?.emissiveIntensity ?? fallbackIntensity)
    colorNode = colorNode.add(color.mul(mask))
    emissiveNode = emissiveNode.add(emissive.mul(intensity).mul(mask))
    roughnessNode = roughnessNode.add(mask.mul(source.roughness))
    metalnessNode = metalnessNode.add(mask.mul(source.metalness))
  }
  const graph = { colorNode, emissiveNode, roughnessNode, metalnessNode }
  packedGraphs.set(key, graph)
  return graph
}

/**
 * The showroom owns the actual material instances and their tier switches. Share these
 * hovercraft's plain shader nodes without sharing that ownership or changing other vehicles.
 * The regular showroom already shares the higher-tier graphs by their source signatures.
 */
export function applyHoverShowroom(root: T.Object3D): () => void {
  if (!heatOwner(root)) return applyShowroom(root, vehicleDecoration)
  const plain = new Set<T.Material>()
  root.traverse(object => {
    if (object instanceof T.Mesh && !Array.isArray(object.material)) plain.add(object.material)
  })

  const decorate: Decorate = Object.assign((group: T.Object3D) => {
    const packed = new Map<StandardNode, PackedGraph>()
    const basic = new Map<T.Mesh, Standard>()
    group.traverse(object => {
      if (!(object instanceof T.Mesh) || Array.isArray(object.material) || !plain.has(object.material)) return
      const source = object.material
      // Opt these particular materials into the existing per-object heat decoration.
      // They still belong to the craft and are disposed by the normal showroom lifecycle.
      source.userData.sharedShowroom = true
      const surfaces = mergedSurfaces.get(source)
      if (source instanceof T.MeshStandardNodeMaterial && surfaces) {
        packedSources.set(object, surfaces)
        const graph = packedGraph(surfaces)
        source.colorNode = graph.colorNode
        source.roughnessNode = graph.roughnessNode
        source.metalnessNode = graph.metalnessNode
        source.emissiveNode = graph.decorated ?? graph.emissiveNode
        if (graph.decorated) source.userData.nightReadable = source.userData.lavaGlow = true
        packed.set(source, graph)
      } else if (source instanceof T.MeshStandardMaterial) {
        basic.set(object, source)
      }
    })

    // The existing plain night hook still edits each material's own emissive color.
    // Read that live value with the renderer's material reference before adding lava.
    addNightReadability(group)
    const converted = new Map<Standard, StandardNode>()
    const emission = plainEmission ?? materialEmissive
    for (const [mesh, source] of basic) {
      let material = converted.get(source)
      if (!material) {
        material = Object.assign(new T.MeshStandardNodeMaterial(), source)
        material.emissiveNode = emission
        if (plainEmission) material.userData.lavaGlow = true
        converted.set(source, material)
      }
      mesh.material = material
    }
    addLavaGlow(group)
    for (const [material, graph] of packed) {
      graph.decorated ??= material.emissiveNode ?? undefined
      material.emissiveNode = graph.decorated ?? null
    }
    for (const material of converted.values()) {
      plainEmission ??= material.emissiveNode ?? undefined
      material.emissiveNode = plainEmission ?? null
    }
  }, { decorationId: vehicleDecoration.decorationId })
  return applyShowroom(root, decorate)
}
