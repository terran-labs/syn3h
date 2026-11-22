/**
 * Light at a gear impact, lying on the surface. `ring`: an expanding ring (the push's reach).
 * `glow`: a soft disc at full size that fades, the light the impact throws on the ground (a
 * stand-in for a real light: no light count changes, so no shader is rebuilt). One shared
 * procedural material per pool, no image assets.
 */
import * as THREE from 'three/webgpu'
import { abs, attribute, float, max, uniform, uv, vec3 } from 'three/tsl'
import { vehicleNightAmount } from '../vehicles/skins/nightReadability'
import type { Game } from '../core/Game'
import { hotExposureNode } from '../vehicles/skins/hotExposure'
import { warmGear } from './warm'

type N = any // TSL's arithmetic nodes are dynamically typed.
const CAPACITY = 16
/** The ring's dark edge: where it lies (the bright band ends at 0.94 of the quad), how wide, how dark. */
const EDGE_AT = 0.965, EDGE_HALF = 0.035, EDGE_ALPHA = 0.85
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
  /**
   * Rings only: a thin dark band just outside each ring's bright one, by day, so a ring holds
   * over a bright sky or snow where additive light alone washes out. Its own small batch with the
   * plain premultiplied blend the Grapple's cord uses (which darkens what is behind it), sharing
   * each ring's transform and fade; nothing at night. The post chain gives back about half of any
   * darkening, so the band is drawn strong (EDGE_ALPHA).
   */
  private readonly edge: THREE.InstancedMesh | null = null
  private readonly edgeFade: THREE.InstancedBufferAttribute | null = null
  private readonly day = uniform(1)

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
    if (kind === 'ring') {
      const geometry = new THREE.PlaneGeometry(2, 2)
      this.edgeFade = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('edgeFade', this.edgeFade)
      const m = new THREE.MeshBasicNodeMaterial({ name: 'gear impact ring edge', transparent: true, depthWrite: false, side: THREE.DoubleSide })
      m.blending = THREE.CustomBlending
      m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor
      m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
      m.fog = false
      const edge: N = max(float(0), float(1).sub(abs(r.sub(EDGE_AT)).div(EDGE_HALF))).pow(0.7)
      m.colorNode = vec3(0, 0, 0)
      m.opacityNode = edge.mul(attribute('edgeFade', 'float')).mul(this.day).mul(EDGE_ALPHA)
      this.edge = new THREE.InstancedMesh(geometry, m, CAPACITY)
      this.edge.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.edge.frustumCulled = false
      this.edge.visible = false
      // Darken first, then the ring's light on top.
      this.edge.renderOrder = 3
      for (let i = 0; i < CAPACITY; i++) this.edge.setMatrixAt(i, hidden)
      game.scene.add(this.edge)
    }
    this.unwarm = warmGear(game, [], () => { this.warming = 2 }, () => this.edge ? [this.mesh, this.edge] : [this.mesh])
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
    if (this.settle === 0 && this.warming === 0 && !this.entries.some(e => e.age < e.seconds)) { this.mesh.visible = false; if (this.edge) this.edge.visible = false; return }
    let active = false
    for (let i = 0; i < CAPACITY; i++) {
      const e = this.entries[i]
      e.age += dt
      const t = e.age / e.seconds
      this.transform.position.copy(e.at)
      this.transform.quaternion.copy(e.rotation)
      // A ring races out and slows (ease-out): most of its reach in the first third of its life,
      // while it is still bright, so it reads at a glance; growing evenly, it was small while visible.
      this.transform.scale.setScalar(t < 1 ? e.radius * (this.kind === 'glow' ? 1 : 0.15 + 0.85 * (1 - (1 - t) ** 3)) : 0)
      this.transform.updateMatrix()
      this.mesh.setMatrixAt(i, this.transform.matrix)
      this.mesh.setColorAt(i, this.color.copy(e.color).multiplyScalar(t < 1 ? (this.kind === 'glow' ? (1 - t) ** 1.6 : (1 - t) ** 2) : 0))
      if (this.edge) { this.edge.setMatrixAt(i, this.transform.matrix); this.edgeFade!.setX(i, t < 1 ? (1 - t) ** 2 : 0) }
      active ||= t < 1
    }
    this.settle = active ? 1 : Math.max(0, this.settle - 1)
    this.mesh.visible = active || this.warming > 0
    if (this.warming > 0) this.warming--
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    if (this.edge) {
      this.edge.visible = this.mesh.visible
      this.edge.instanceMatrix.needsUpdate = true
      this.edgeFade!.needsUpdate = true
      this.day.value = 1 - vehicleNightAmount(this.game.scene)
    }
  }

  reset(): void { for (const e of this.entries) e.age = Infinity; this.mesh.visible = false; if (this.edge) this.edge.visible = false }
  /** Carry the rings and lights across a world seam with the local player. */
  shift(dx: number, dz: number): void { for (const e of this.entries) { e.at.x += dx; e.at.z += dz } }
  dispose(): void {
    this.unwarm(); this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose()
    if (this.edge) { this.edge.removeFromParent(); this.edge.dispose(); this.edge.geometry.dispose(); (this.edge.material as THREE.Material).dispose() }
  }
}
