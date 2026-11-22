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
import { sharedLook, warmGear } from './warm'

type N = any // TSL's arithmetic nodes are dynamically typed.
const CAPACITY = 16
/** The ring's dark edge: where it lies (the bright band ends at 0.94 of the quad), how wide, how dark. */
const EDGE_AT = 0.965, EDGE_HALF = 0.035, EDGE_ALPHA = 0.85
/** The half-width of an impact ring's edge band on screen, pixels: at least, and at most. */
const EDGE_MIN_PX = 1.5, EDGE_MAX_PX = 3

/** Metres one pixel spans at `at`, from the camera's field of view and the canvas height. */
function metresPerPixel(game: Game, at: THREE.Vector3): number {
  const cam = game.camera as THREE.PerspectiveCamera | undefined
  // No camera (a unit test): no floor or cap; the band keeps its share of the ring.
  if (!cam) return 0
  const distance = Math.max(0.1, cam.position.distanceTo(at))
  const height = (game.renderer as unknown as { domElement?: HTMLCanvasElement })?.domElement?.clientHeight || 800
  return 2 * distance * Math.tan(((cam.fov ?? 60) * Math.PI) / 360) / height
}
const UP = new THREE.Vector3(0, 0, 1)

export interface PulseOptions {
  radius: number
  seconds: number
  color: THREE.Color
}

/** Ring edges drawn at once for the whole game: the impact rings' and the Yoink's gust rings'. */
export const EDGE_SLOTS = 32

/**
 * Every ring's dark edge in the game, by day: one small instanced batch and one material, so a
 * ring holds over a bright sky or snow where its additive light alone washes out. The plain
 * premultiplied blend the Grapple's cord uses (which darkens what is behind it), colour black.
 * Each slot is an owner's ring: its transform, its fade, and where its band lies on the quad
 * (`at`, `half`, in quad radii). Strong (EDGE_ALPHA), since the post chain gives back about half
 * of any darkening; nothing at night. Owners take a range of slots once (take), write them each
 * frame (set) and commit.
 */
export class RingEdges {
  readonly mesh: THREE.InstancedMesh
  private readonly look: THREE.InstancedBufferAttribute
  private readonly day = uniform(1)
  private next = 0
  private warming = 0
  private readonly unwarm: () => void
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(private readonly game: Game) {
    const geometry = new THREE.PlaneGeometry(2, 2)
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(EDGE_SLOTS * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('edgeLook', this.look)
    const m = new THREE.MeshBasicNodeMaterial({ name: 'gear ring edge', transparent: true, depthWrite: false, side: THREE.DoubleSide })
    m.blending = THREE.CustomBlending
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
    m.fog = false
    const look: N = attribute('edgeLook', 'vec4'), r: N = uv().mul(2).sub(1).length()
    const band: N = max(float(0), float(1).sub(abs(r.sub(look.y)).div(look.z.max(1e-3)))).pow(0.7)
    m.colorNode = vec3(0, 0, 0)
    m.opacityNode = band.mul(look.x).mul(this.day).mul(EDGE_ALPHA)
    this.mesh = new THREE.InstancedMesh(geometry, m, EDGE_SLOTS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    // Darken first, then the rings' light on top.
    this.mesh.renderOrder = 3
    for (let i = 0; i < EDGE_SLOTS; i++) this.mesh.setMatrixAt(i, this.hidden)
    game.scene.add(this.mesh)
    this.unwarm = warmGear(game, [], () => { this.warming = 2 }, () => [this.mesh])
  }

  /** A range of `n` slots for one owner, taken once; its first index. */
  take(n: number): number {
    const first = this.next
    this.next = Math.min(EDGE_SLOTS, this.next + n)
    return first
  }

  /** Slot `i` this frame: the ring's world matrix, its fade (0 for none), and its band. */
  set(i: number, matrix: THREE.Matrix4 | null, fade: number, at = EDGE_AT, half = EDGE_HALF): void {
    if (i < 0 || i >= EDGE_SLOTS) return
    this.mesh.setMatrixAt(i, matrix && fade > 0 ? matrix : this.hidden)
    this.look.setXYZW(i, matrix ? Math.max(0, fade) : 0, at, half, 0)
  }

  /** After the owners' sets, once a frame (any owner may call it). */
  commit(): void {
    const arr = this.look.array as Float32Array
    let live = this.warming > 0
    for (let i = 0; i < EDGE_SLOTS && !live; i++) live = arr[i * 4] > 0
    this.mesh.visible = live
    if (this.warming > 0) this.warming--
    this.day.value = 1 - vehicleNightAmount(this.game.scene)
    this.mesh.instanceMatrix.needsUpdate = true
    this.look.needsUpdate = true
  }

  dispose(): void { this.unwarm(); this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}

/** The game's one ring-edge batch, made by its first user and disposed with its last. */
export function ringEdges(game: Game): { look: RingEdges; release(): void } {
  return sharedLook(game, 'ring edges', () => new RingEdges(game))
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
  /** Rings only: their dark edges, by day (RingEdges), and the first of this pool's slots there. */
  private readonly edges: { look: RingEdges; release(): void } | null = null
  private readonly edgeFirst: number = -1

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
      this.edges = ringEdges(game)
      this.edgeFirst = this.edges.look.take(CAPACITY)
    }
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
      // A ring races out and slows (ease-out): most of its reach in the first third of its life,
      // while it is still bright, so it reads at a glance; growing evenly, it was small while visible.
      this.transform.scale.setScalar(t < 1 ? e.radius * (this.kind === 'glow' ? 1 : 0.15 + 0.85 * (1 - (1 - t) ** 3)) : 0)
      this.transform.updateMatrix()
      this.mesh.setMatrixAt(i, this.transform.matrix)
      this.mesh.setColorAt(i, this.color.copy(e.color).multiplyScalar(t < 1 ? (this.kind === 'glow' ? (1 - t) ** 1.6 : (1 - t) ** 2) : 0))
      if (this.edges) {
        // The band's width on screen: never thinner than EDGE_MIN_PX (at 40 m it was about two
        // pixels and barely read) nor thicker than EDGE_MAX_PX (a ring bursting on your own car,
        // metres from the lens, would grow a thick black hoop). In quad radii, just outside the
        // bright band, which ends at 0.94.
        const scale = this.transform.scale.x
        let half = EDGE_HALF, at = EDGE_AT
        const mPerPx = scale > 0 ? metresPerPixel(this.game, this.transform.position) : 0
        if (mPerPx > 0) {
          const px = Math.min(EDGE_MAX_PX, Math.max(EDGE_MIN_PX, EDGE_HALF * scale / mPerPx))
          half = px * mPerPx / scale
          at = 0.94 + half
        }
        this.edges.look.set(this.edgeFirst + i, this.transform.matrix, t < 1 ? (1 - t) ** 2 : 0, at, half)
      }
      active ||= t < 1
    }
    this.settle = active ? 1 : Math.max(0, this.settle - 1)
    this.mesh.visible = active || this.warming > 0
    if (this.warming > 0) this.warming--
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.edges?.look.commit()
  }

  reset(): void {
    for (const e of this.entries) e.age = Infinity
    this.mesh.visible = false
    if (this.edges) { for (let i = 0; i < CAPACITY; i++) this.edges.look.set(this.edgeFirst + i, null, 0); this.edges.look.commit() }
  }
  /** Carry the rings and lights across a world seam with the local player. */
  shift(dx: number, dz: number): void { for (const e of this.entries) { e.at.x += dx; e.at.z += dz } }
  dispose(): void {
    this.unwarm(); this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose()
    this.edges?.release()
  }
}
