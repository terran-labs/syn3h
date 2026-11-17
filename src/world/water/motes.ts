/**
 * Motes: what hangs in a liquid round the camera. Specks of silt drifting in water, catching
 * the light near the surface; sparks and glowing grit rising in lava. They are what tells the
 * eye the water is a volume and which way it is moving.
 *
 * One instanced batch with no per-frame uploads. Each mote has a fixed place in a box of world
 * space that tiles round the camera (its position is wrapped into the box centred on the lens),
 * so motes stay put in the world as you move and never run out. Shown only while the camera is
 * in a liquid; the count is a share of the quality level's particle budget.
 */
import * as T from 'three/webgpu'
import { attribute, cameraPosition, float, fract, mix, renderGroup, sin, smoothstep, time, uniform, uv, vec2, vec3 } from 'three/tsl'
import { qualityBudget } from '../../core/quality'

/** Edge of the box of motes round the camera, metres. */
const BOX = 14
/** Largest batch: the Cinematic share. */
export const MOTE_CAPACITY = 480
/** Motes for a level's particle budget: a tenth of it, at most the batch. */
export const motesFor = (particles: number) => Math.max(0, Math.min(MOTE_CAPACITY, Math.floor(particles * 0.1)))

export class Motes {
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.SpriteNodeMaterial>
  /** 0..1: how much of the view is in a liquid. */
  private readonly amount = uniform(0)
  /** 0 water, 1 lava. */
  private readonly lava = uniform(0)
  private readonly tint = uniform(new T.Color(0.6, 0.85, 0.9))

  constructor(private readonly scene: T.Scene) {
    const plane = new T.PlaneGeometry(1, 1)
    const g = new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry)
    plane.dispose()
    const seeds = new Float32Array(MOTE_CAPACITY * 4)
    let s = 977
    const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < seeds.length; i++) seeds[i] = next()
    g.setAttribute('moteSeed', new T.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = 0
    for (const u of [this.amount, this.lava, this.tint]) (u as unknown as { setGroup(g: unknown): { onRenderUpdate(f: () => unknown): void } }).setGroup(renderGroup).onRenderUpdate(() => u.value)
    const seed = attribute('moteSeed', 'vec4')
    // Water silt drifts slowly sideways and sinks a little; lava grit rises fast and curls.
    const drift = mix(vec3(0.12, -0.03, 0.07), vec3(0.15, 0.9, -0.1), this.lava).mul(time)
    const curl = vec3(sin(time.mul(0.7).add(seed.w.mul(30))), 0, sin(time.mul(0.6).add(seed.x.mul(30)))).mul(mix(float(0.15), float(0.6), this.lava))
    const home = seed.xyz.mul(BOX).add(drift)
    // Wrap into the box round the camera.
    const local = fract(home.sub(cameraPosition).div(BOX)).sub(0.5).mul(BOX)
    const material = new T.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending })
    material.fog = false
    material.positionNode = cameraPosition.add(local).add(curl)
    const size = mix(float(0.025).add(seed.w.mul(0.03)), float(0.04).add(seed.w.mul(0.07)), this.lava)
    material.scaleNode = vec2(size, size)
    const r = uv().sub(0.5).length()
    const disc = float(1).sub(smoothstep(0.15, 0.5, r))
    // Fade at the edge of the box so the wrap is never seen, and very close to the lens.
    const edge = smoothstep(BOX * 0.5, BOX * 0.3, local.length()).mul(smoothstep(0.2, 0.8, local.length()))
    const twinkle = sin(time.mul(mix(float(1.3), float(6), this.lava)).add(seed.y.mul(40))).mul(0.35).add(0.65)
    material.colorNode = mix(this.tint.mul(1.6), vec3(4, 1.4, 0.2), this.lava)
    material.opacityNode = disc.mul(edge).mul(twinkle).mul(this.amount).mul(mix(float(0.35), float(0.9), this.lava))
    this.mesh = new T.Mesh(g, material)
    this.mesh.name = 'liquid-motes'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    scene.add(this.mesh)
  }

  /** Per frame: the camera's medium and how far into it the view is. */
  update(kind: 'water' | 'lava' | null, amount: number, tint: T.Color): void {
    const count = kind && amount > 0.01 ? motesFor(qualityBudget().particles) : 0
    this.mesh.geometry.instanceCount = count
    this.amount.value = amount
    this.lava.value = kind === 'lava' ? 1 : 0
    // Lift the water's colour toward white: silt catches the light.
    this.tint.value.copy(tint).lerp(new T.Color(1, 1, 1), 0.5)
  }

  get count(): number { return this.mesh.geometry.instanceCount }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
