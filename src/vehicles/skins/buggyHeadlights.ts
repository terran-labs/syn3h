import * as T from 'three/webgpu'

interface LampFace {
  position: T.Vector3
  direction: T.Vector3
  color: T.Color
}

/** Snapshots static lamp faces before merging destroys their separate mesh identities.
 * Positions and normals are in frame-local space. Only front-facing triangles contribute;
 * the foremost surface on each side wins over secondary fittings behind the main lamps.
 */
export class BuggyHeadlights {
  private readonly faces: (LampFace | undefined)[] = [undefined, undefined]

  constructor(root: T.Object3D, frame: T.Object3D, isLamp: (mesh: T.Mesh, material: T.Material) => boolean) {
    frame.updateWorldMatrix(true, true)
    root.updateWorldMatrix(true, true)
    const inverse = frame.matrixWorld.clone().invert()
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3()
    const normal = new T.Vector3(), edge = new T.Vector3(), centre = new T.Vector3()
    root.traverse(object => {
      const mesh = object as T.Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry, vertices = geometry.getAttribute('position'), indices = geometry.index
      const matrix = inverse.clone().multiply(mesh.matrixWorld)
      const reflected = matrix.determinant() < 0
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const [materialIndex, material] of materials.entries()) {
        if (!isLamp(mesh, material)) continue
        const sums = [0, 1].map(() => ({ position: new T.Vector3(), direction: new T.Vector3(), area: 0 }))
        const count = indices?.count ?? vertices.count
        for (let i = 0; i + 2 < count; i += 3) {
          if (Array.isArray(mesh.material) && !geometry.groups.some(g => g.materialIndex === materialIndex && i >= g.start && i < g.start + g.count)) continue
          a.fromBufferAttribute(vertices, indices ? indices.getX(i) : i).applyMatrix4(matrix)
          b.fromBufferAttribute(vertices, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(matrix)
          c.fromBufferAttribute(vertices, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(matrix)
          normal.subVectors(b, a).cross(edge.subVectors(c, a))
          // A reflected mesh flips winding, but its outward normal still faces away from the lens.
          if (reflected) normal.negate()
          const area = normal.length()
          if (area < 1e-10 || normal.z / area > -.5) continue
          centre.copy(a).add(b).add(c).multiplyScalar(1 / 3)
          const sum = sums[centre.x < 0 ? 0 : 1]
          sum.position.addScaledVector(centre, area)
          sum.direction.add(normal)
          sum.area += area
        }
        sums.forEach((sum, side) => {
          if (!sum.area) return
          sum.position.multiplyScalar(1 / sum.area)
          if (this.faces[side] && this.faces[side]!.position.z <= sum.position.z) return
          const lamp = material as T.MeshStandardMaterial
          const emission = lamp.emissive?.clone().multiplyScalar(lamp.emissiveIntensity ?? 1)
          // The beam follows emitted light, not the lens's reflective base tint.
          const color = emission && Math.max(emission.r, emission.g, emission.b) > 0
            ? emission : lamp.color?.clone() ?? new T.Color(0xffffff)
          this.faces[side] = {
            position: sum.position, direction: sum.direction.normalize(),
            color,
          }
        })
      }
    })
  }

  sample(index: number, position: T.Vector3, direction: T.Vector3, color: T.Color): boolean {
    const face = this.faces[index]
    if (!face) return false
    position.copy(face.position); direction.copy(face.direction); color.copy(face.color)
    return true
  }
}
