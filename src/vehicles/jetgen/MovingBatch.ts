import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Several small moving parts drawn as one mesh. The source meshes stay in the scene graph as
 * invisible transform handles, so the mechanism that moves them is unchanged; `update()` copies
 * their vertices into one dynamic buffer in the frame of `root`. A few hundred vertices cost
 * microseconds on the CPU, where a draw for every fitting, petal and flap costs the GPU more.
 * The sources must share one material and hang below `root`.
 */
export class MovingBatch {
  readonly mesh: THREE.Mesh
  private readonly parts: { source: THREE.Mesh; offset: number }[] = []
  private readonly matrix = new THREE.Matrix4()
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly vertex = new THREE.Vector3()

  constructor(private readonly root: THREE.Object3D, sources: THREE.Mesh[], name: string) {
    const geometries: THREE.BufferGeometry[] = []
    let offset = 0
    for (const source of sources) {
      const g = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone()
      for (const attribute of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(attribute)) g.deleteAttribute(attribute)
      this.parts.push({ source, offset }); offset += g.attributes.position.count
      geometries.push(g); source.visible = false
    }
    const geometry = mergeGeometries(geometries)
    geometries.forEach(g => g.dispose())
    ;(geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    ;(geometry.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    this.mesh = new THREE.Mesh(geometry, sources[0].material); this.mesh.name = name
    this.mesh.castShadow = sources.some(o => o.castShadow)
    // The parts move inside one buffer, so a bounding sphere taken now would go stale.
    this.mesh.frustumCulled = false
    root.add(this.mesh)
    this.update()
  }

  /** Call after the handles have moved. Does not allocate. */
  update(): void {
    const positions = this.mesh.geometry.attributes.position, normals = this.mesh.geometry.attributes.normal
    for (const { source, offset } of this.parts) {
      // The handle's transform relative to the root, from local matrices only.
      this.matrix.identity()
      for (let o: THREE.Object3D | null = source; o && o !== this.root; o = o.parent) { o.updateMatrix(); this.matrix.premultiply(o.matrix) }
      this.normalMatrix.getNormalMatrix(this.matrix)
      const g = source.geometry, p = g.attributes.position, n = g.attributes.normal
      const count = g.index?.count ?? p.count
      for (let i = 0; i < count; i++) {
        const index = g.index ? g.index.getX(i) : i
        this.vertex.fromBufferAttribute(p, index).applyMatrix4(this.matrix)
        positions.setXYZ(offset + i, this.vertex.x, this.vertex.y, this.vertex.z)
        this.vertex.fromBufferAttribute(n, index).applyNormalMatrix(this.normalMatrix)
        normals.setXYZ(offset + i, this.vertex.x, this.vertex.y, this.vertex.z)
      }
    }
    positions.needsUpdate = true; normals.needsUpdate = true
  }

  dispose(): void { this.mesh.geometry.dispose() }
}
