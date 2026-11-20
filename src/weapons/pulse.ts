/**
 * Light at a gear impact, lying on the surface. `ring`: an expanding ring (the push's reach).
 * `glow`: a soft disc at full size that fades, the light the impact throws on the ground (a
 * stand-in for a real light: no light count changes, so no shader is rebuilt). One shared
 * procedural material per pool, no image assets.
 */
import * as THREE from 'three/webgpu'
import { float, max, uv } from 'three/tsl'
import type { Game } from '../core/Game'
import { hotExposureNode } from '../vehicles/skins/hotExposure'
import { warmGear } from './warm'

type N = any // TSL's arithmetic nodes are dynamically typed.
const CAPACITY = 16
const UP = new THREE.Vector3(0, 0, 1)

export interface PulseOptions {
  radius: number
  seconds: number
  color: THREE.Color
}

/** A bounded pool; a busy scene replaces the oldest ring instead of allocating more. */
export class ImpactPulses {
  private readonly geometry = new THREE.PlaneGeometry(2, 2)
  private readonly material = new THREE.MeshBasicNodeMaterial({ name: 'gear impact ring', transparent: true, depthWrite: false, side: THREE.DoubleSide })
  private readonly mesh: THREE.InstancedMesh
  private readonly entries = Array.from({ length: CAPACITY }, () => ({ age: Infinity, seconds: 1, radius: 1, at: new THREE.Vector3(), rotation: new THREE.Quaternion(), color: new THREE.Color() }))
  private cursor = 0
  private warming = 0
  private readonly transform = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly unwarm: () => void

  constructor(private readonly game: Game, private readonly kind: 'ring' | 'glow' = 'ring') {
    if (kind === 'glow') this.material.name = 'gear impact light'
    const r: N = uv().mul(2).sub(1).length()
    const band = max(float(0), float(1).sub(r.sub(0.74).abs().div(0.2)))
    const shape = kind === 'glow' ? max(float(0), float(1).sub(r)).pow(2.2) : band.pow(2).add(max(float(0), float(1).sub(r)).pow(3).mul(0.18))
    this.material.colorNode = shape.mul(hotExposureNode())
    this.material.opacityNode = shape.mul(kind === 'glow' ? 1 : 0.65)
    this.material.blending = THREE.AdditiveBlending
    this.material.fog = false
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.renderOrder = 4
    // Allocate instance colors before warm-up, so first use cannot change the shader layout.
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const black = new THREE.Color(0, 0, 0)
    for (let i = 0; i < CAPACITY; i++) {
      this.mesh.setMatrixAt(i, hidden)
      this.mesh.setColorAt(i, black)
    }
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    game.scene.add(this.mesh)
    this.unwarm = warmGear(game, [], () => { this.warming = 2 }, () => [this.mesh])
  }

  get active(): number { return this.entries.filter(e => e.age < e.seconds).length }

  emit(at: THREE.Vector3, normal: THREE.Vector3, options: PulseOptions): void {
    const e = this.entries[this.cursor++ % CAPACITY]
    e.age = 0
    e.seconds = Math.max(0.05, options.seconds)
    e.radius = Math.max(0.1, options.radius)
    e.at.copy(at).addScaledVector(normal, 0.09)
    e.rotation.setFromUnitVectors(UP, normal.clone().normalize())
    e.color.copy(options.color)
  }

  /** Frames left to write zeros after the last entry ended; then the pool sits idle. */
  private settle = 0

  update(dt: number): void {
    // Nothing alive and the last zeros written: skip the loop and the uploads entirely.
    if (this.settle === 0 && this.warming === 0 && !this.entries.some(e => e.age < e.seconds)) { this.mesh.visible = false; return }
    let active = false
    for (let i = 0; i < CAPACITY; i++) {
      const e = this.entries[i]
      e.age += dt
      const t = e.age / e.seconds
      this.transform.position.copy(e.at)
      this.transform.quaternion.copy(e.rotation)
      this.transform.scale.setScalar(t < 1 ? e.radius * (this.kind === 'glow' ? 1 : 0.15 + 0.85 * t) : 0)
      this.transform.updateMatrix()
      this.mesh.setMatrixAt(i, this.transform.matrix)
      this.mesh.setColorAt(i, this.color.copy(e.color).multiplyScalar(t < 1 ? (this.kind === 'glow' ? (1 - t) ** 1.6 : (1 - t) ** 2) : 0))
      active ||= t < 1
    }
    this.settle = active ? 1 : Math.max(0, this.settle - 1)
    this.mesh.visible = active || this.warming > 0
    if (this.warming > 0) this.warming--
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  reset(): void { for (const e of this.entries) e.age = Infinity; this.mesh.visible = false }
  /** Carry the rings and lights across a world seam with the local player. */
  shift(dx: number, dz: number): void { for (const e of this.entries) { e.at.x += dx; e.at.z += dz } }
  dispose(): void { this.unwarm(); this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose() }
}
