/** A seeded swarm gathering at Plasma Thunder's muzzle. One instanced draw per charge. */
import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import { graphicsLevel, levelNumber } from '../core/quality'
import { warmGear } from './warm'

const COUNT = 24
export class ChargeMotes {
  private readonly geometry = new THREE.SphereGeometry(0.08, 6, 4)
  private readonly mesh: THREE.InstancedMesh
  private readonly transform = new THREE.Object3D()
  private readonly unwarm: () => void
  private warming = 0

  constructor(game: Game, material: THREE.Material, private readonly seed = 23) {
    this.mesh = new THREE.InstancedMesh(this.geometry, material, COUNT)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < COUNT; i++) this.mesh.setMatrixAt(i, hidden)
    game.scene.add(this.mesh)
    this.unwarm = warmGear(game, [], () => { this.warming = 2 }, () => [this.mesh])
  }

  update(at: THREE.Vector3, charge: number, time: number): void {
    const active = charge >= 0
    this.mesh.position.copy(at)
    this.mesh.count = levelNumber(graphicsLevel.value) === 0 ? 6 : COUNT
    for (let i = 0; i < this.mesh.count; i++) {
      // Golden-angle spacing keeps the swarm evenly distributed at either particle count.
      const phase = (time * 0.7 + i * 0.618034 + this.seed * 0.013) % 1
      const radius = (0.2 + (1 - phase) * 2.4) * (1 - Math.max(0, charge) * 0.65)
      const angle = i * 2.399963 + time * (1.2 + charge)
      this.transform.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * radius * 0.65, Math.sin(angle) * radius)
      this.transform.scale.setScalar(active ? 0.5 + phase * (0.7 + charge) : 0)
      this.transform.updateMatrix()
      this.mesh.setMatrixAt(i, this.transform.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.visible = active || this.warming > 0
    if (this.warming > 0) this.warming--
  }

  hide(): void { this.mesh.visible = false }
  dispose(): void { this.unwarm(); this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose() }
}
