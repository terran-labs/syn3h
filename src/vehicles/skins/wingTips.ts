import * as THREE from 'three/webgpu'

/** Tip anchors follow the vertices actually drawn, including deformation and geometry edits. */
export class WingTipAnchors {
  private version = -1
  private position?: THREE.BufferAttribute
  private readonly tips = [-1, -1]
  private readonly transform = new THREE.Matrix4()
  private readonly previousTransform = new THREE.Matrix4()

  constructor(readonly mesh: THREE.Mesh, private readonly vertices?: readonly number[]) {}

  /** Fill a point in root-local coordinates. Hidden surfaces never emit trails. */
  get(side: -1 | 1, root: THREE.Object3D, out: THREE.Vector3): boolean {
    this.transform.identity()
    let node: THREE.Object3D | null = this.mesh
    while (node !== root) {
      if (!node || !node.visible) return false
      if (node.matrixAutoUpdate) node.updateMatrix()
      this.transform.premultiply(node.matrix)
      node = node.parent
    }
    if (!root.visible) return false
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    if (position !== this.position || position.version !== this.version || !this.transform.equals(this.previousTransform)) {
      this.tips[0] = this.tips[1] = -1
      let left = Infinity, right = -Infinity
      const count = this.vertices?.length ?? position.count
      for (let n = 0; n < count; n++) {
        const i = this.vertices ? this.vertices[n] : n
        out.fromBufferAttribute(position, i).applyMatrix4(this.transform)
        if (out.x < left) { left = out.x; this.tips[0] = i }
        if (out.x > right) { right = out.x; this.tips[1] = i }
      }
      this.position = position
      this.version = position.version
      this.previousTransform.copy(this.transform)
    }
    const index = this.tips[side < 0 ? 0 : 1]
    if (index < 0) return false
    out.fromBufferAttribute(position, index).applyMatrix4(this.transform)
    return true
  }
}
