import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, Scene, SpriteNodeMaterial, Vector2 } from 'three/webgpu'
import { attribute, float, fract, mix, sin, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import type { System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import { PARTICLE_SHARES, particleBudget, windX, windZ } from './params'
import { windDrift } from '../world/weather'
export type VentKind = 'flame' | 'embers' | 'smoke'
export interface VentOptions { kind: VentKind; radius: number; height: number; intensity: number }
interface Vent extends VentOptions { x: number; y: number; z: number; birth: number }
/** Stable integer hash for repeatable particle placement, independent of frame rate. */
function seed(i: number) { let n = Math.imul(i + 1, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return ((n ^ n >>> 16) >>> 0) / 4294967296 }
export class Emitters implements System {
  private readonly vents: Vent[] = []
  private readonly materials = new Map<VentKind, SpriteNodeMaterial>()
  private readonly meshes: Mesh<InstancedBufferGeometry, SpriteNodeMaterial>[] = []
  private readonly clock = uniform(0)
  private readonly wind = uniform(new Vector2())
  private dirty = false
  private budget = -1
  /** At most 48 particles per vent, 2400 globally by default, and three draws. */
  particleCount = 0
  get ventCount() { return this.vents.length }
  constructor(private readonly scene: Scene) {}
  addVent(position: { x: number; y: number; z: number }, options: VentOptions) {
    if (![position.x, position.y, position.z, options.radius, options.height, options.intensity].every(Number.isFinite)) throw new Error('Vent values must be finite')
    if (options.radius <= 0 || options.height <= 0 || options.intensity < 0) throw new Error('Invalid vent dimensions')
    this.vents.push({ ...options, ...position, birth: this.clock.value }); this.dirty = true
  }
  private release() {
    for (const mesh of this.meshes) { this.scene.remove(mesh); mesh.geometry.dispose() }
    this.meshes.length = 0; this.particleCount = 0
  }
  clear() { this.vents.length = 0; this.release(); this.dirty = false }
  private rebuild() {
    this.release()
    this.budget = Math.max(0, Math.floor(Math.min(particleBudget.value, qualityBudget().particles) * PARTICLE_SHARES.vents))
    // Equal allocation avoids starving late vents when the budget is reduced on phones.
    const perVent = Math.min(48, Math.floor(this.budget / Math.max(1, this.vents.length)))
    for (const kind of ['flame', 'embers', 'smoke'] as const) {
      const origins: number[] = [], settings: number[] = [], seeds: number[] = []
      this.vents.forEach((vent, index) => {
        if (vent.kind !== kind || vent.intensity === 0) return
        for (let i = 0; i < perVent; i++) {
          origins.push(vent.x, vent.y, vent.z)
          settings.push(vent.radius, vent.height, Math.min(vent.intensity, 4), vent.birth)
          seeds.push(seed(index * 48 + i), seed(index * 48 + i + 10007))
        }
      })
      const count = seeds.length / 2
      if (!count) continue
      const plane = new PlaneGeometry(1, 1)
      const geometry = new InstancedBufferGeometry().copy(plane as unknown as InstancedBufferGeometry)
      plane.dispose(); geometry.instanceCount = count
      geometry.setAttribute('ventOrigin', new InstancedBufferAttribute(new Float32Array(origins), 3))
      geometry.setAttribute('ventSettings', new InstancedBufferAttribute(new Float32Array(settings), 4))
      geometry.setAttribute('particleSeed', new InstancedBufferAttribute(new Float32Array(seeds), 2))
      const material = this.material(kind)
      const mesh = new Mesh(geometry, material)
      // The vertex shader moves particles outside the base quad's CPU bounds.
      mesh.frustumCulled = false; mesh.renderOrder = kind === 'smoke' ? 2 : 1
      this.scene.add(mesh); this.meshes.push(mesh); this.particleCount += count
    }
    this.dirty = false
  }
  private material(kind: VentKind): SpriteNodeMaterial {
    const cached = this.materials.get(kind)
    if (cached) return cached
    const origin = attribute('ventOrigin', 'vec3'), config = attribute('ventSettings', 'vec4'), random = attribute('particleSeed', 'vec2')
    const lifetime = kind === 'smoke' ? 8 : kind === 'embers' ? 3 : 2
    const age = fract(this.clock.sub(config.w).div(lifetime).add(random.x))
    const angle = random.y.mul(Math.PI * 2)
    const spread = kind === 'smoke' ? age.mul(2).add(0.5) : float(1).sub(age.mul(0.6))
    const radius = config.x.mul(spread).mul(random.x.sqrt())
    const drift = this.wind.mul(age).mul(lifetime)
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: kind === 'smoke' ? NormalBlending : AdditiveBlending })
    material.positionNode = origin.add(vec3(angle.cos().mul(radius).add(drift.x), age.mul(config.y), angle.sin().mul(radius).add(drift.y)))
    const size = kind === 'embers' ? float(0.16).add(random.y.mul(0.14)) : config.x.mul(kind === 'smoke' ? 2 : 1.3).mul(kind === 'smoke' ? age.add(0.5) : float(1).sub(age.mul(0.7)))
    material.scaleNode = vec2(size, size.mul(kind === 'flame' ? 2.3 : 1))
    const disc = float(1).sub(smoothstep(0.1, 0.5, uv().sub(0.5).length()))
    const fade = smoothstep(0, 0.1, age).mul(float(1).sub(smoothstep(0.45, 1, age)))
    material.opacityNode = disc.mul(disc).mul(fade).mul(config.z).mul(kind === 'smoke' ? 0.26 : 0.75)
    // Smoke is lit from below by the fire it rises from: warm at the base, cooling to grey.
    material.colorNode = kind === 'smoke' ? mix(vec3(0.9, 0.32, 0.08), uniform(new Color(0x45414a)), smoothstep(0, 0.45, age)) : mix(vec3(4, 1.5, 0.12), vec3(1.5, 0.035, 0.001), age)
    this.materials.set(kind, material)
    return material
  }
  /** Where the wind is sampled: the vent nearest this point (the camera), set by the owner. */
  readonly listener = { x: 0, y: 0, z: 0 }
  private readonly drift = { x: 0, y: 0, z: 0 }
  update(dt: number) {
    // The weather's wind at the vent nearest the camera (one sample: all vents share one
    // uniform, and the nearest is the one that is seen), plus the old lava.windX and windZ
    // sliders as an offset so saved worlds keep their lean.
    let near: Vent | null = null, best = Infinity
    for (const v of this.vents) { const d = (v.x - this.listener.x) ** 2 + (v.z - this.listener.z) ** 2; if (d < best) { best = d; near = v } }
    const at = near ?? this.listener
    windDrift(at.x, at.y, at.z, this.drift)
    this.clock.value += dt; this.wind.value.set(this.drift.x + windX.value, this.drift.z + windZ.value)
    if (this.dirty || Math.floor(Math.min(particleBudget.value, qualityBudget().particles) * PARTICLE_SHARES.vents) !== this.budget) this.rebuild()
  }
  dispose() {
    this.clear()
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}
