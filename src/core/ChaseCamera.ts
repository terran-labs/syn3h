/**
 * Chase camera: follows a vehicle from behind and above, and never dips under the terrain.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../shared/params'
import type { Terrain } from '../world/Terrain'
import type { Game, System } from './Game'

export const camDistance = defineParam({
  id: 'camera.distance', label: 'Distance', group: 'Camera', scope: 'client',
  default: 9, min: 3, max: 30, step: 0.5,
})
export const camHeight = defineParam({
  id: 'camera.height', label: 'Height', group: 'Camera', scope: 'client',
  default: 3.5, min: 0.5, max: 15, step: 0.5,
})

export class ChaseCamera implements System {
  target: THREE.Object3D | null = null
  private readonly desired = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(private readonly game: Game, private readonly terrain: Terrain) {}

  update(dt: number): void {
    const t = this.target
    if (!t) return
    // Follow the heading only, so rolls and flips do not swing the camera.
    this.forward.set(0, 0, -1).applyQuaternion(t.quaternion)
    this.forward.y = 0
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1)
    this.forward.normalize()

    this.desired.copy(t.position).addScaledVector(this.forward, -camDistance.value)
    this.desired.y += camHeight.value
    const ground = this.terrain.heightAt(this.desired.x, this.desired.z) + 1
    if (this.desired.y < ground) this.desired.y = ground

    const k = 1 - Math.exp(-dt * 5)
    this.game.camera.position.lerp(this.desired, k)
    this.look.copy(t.position)
    this.look.y += 1
    this.game.camera.lookAt(this.look)
  }
}
