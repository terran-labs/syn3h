/**
 * Life over open lava: flames licking up in patches that drift, embers and sparks rising and
 * curling in the heat, sparks hopping where the lava laps the shore, and wisps of smoke along
 * the edge, lit orange from below.
 *
 * Generated entirely on the GPU, with no per-frame uploads. Every particle has a fixed home in a
 * square of world space that tiles round the camera (wrapped into the square centred on the
 * lens), so the field never runs out and stays put as you drive. Each frame the vertex shader
 * reads the bed height texture under a particle's home: over open lava it may be a flame or an
 * ember, within a metre of the shore a spark or a wisp, and anywhere else nothing (scaled to
 * zero). Flames only burn where a slow noise field is high, so they gather in patches that
 * wander across the lake.
 *
 * Drawn only on worlds with a lava sea; inland lava has its vents (Emitters). The count is the
 * ambient share of the lava particle budget (params.ts PARTICLE_SHARES), scaled by lava.fire
 * and lava.embers.
 */
import * as T from 'three/webgpu'
import {
  attribute, cameraPosition, float, floor, fract, mix, renderGroup, select, sin, smoothstep, texture, time, uniform, uv, vec2, vec3,
} from 'three/tsl'
import type { System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import { NO_BED, type WaterBed } from '../world/water/bed'
import { applyCurve } from '../world/curve'
import { PARTICLE_SHARES, lavaEmbers, lavaFire, particleBudget, windX, windZ } from './params'

/** Edge of the square of particles round the camera, metres. */
const BOX = 110
/** Largest batch: the ambient share of the largest budget. */
export const AMBIENT_CAPACITY = Math.floor(4800 * PARTICLE_SHARES.ambient)

/** Particles to draw for a total lava budget and the two amount sliders, never above the ambient share. */
export function ambientCount(budget: number, fire = 1, embers = 1): number {
  const share = Math.floor(Math.max(0, budget) * PARTICLE_SHARES.ambient)
  const amount = Math.max(0, Math.min(1, (Math.max(0, fire) + Math.max(0, embers)) / 2))
  return Math.min(AMBIENT_CAPACITY, share, Math.floor(share * amount))
}

const hash = (v: T.Node<'vec2'>) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453))
const noise = (v: T.Node<'vec2'>) => {
  const i = floor(v), f = fract(v), u = f.mul(f).mul(float(3).sub(f.mul(2)))
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y)
}

export class LavaAmbient implements System {
  readonly glow: T.Mesh<T.InstancedBufferGeometry, T.SpriteNodeMaterial>
  readonly smoke: T.Mesh<T.InstancedBufferGeometry, T.SpriteNodeMaterial>
  private readonly level = uniform(0)
  private readonly fire = uniform(1)
  private readonly embers = uniform(1)
  private readonly wind = uniform(new T.Vector2())
  private readonly dim = uniform(1)
  private readonly bedMap = texture(NO_BED)
  private readonly bedFrame = uniform(new T.Vector3(1 / 2048, 0, 0))
  on = false

  constructor(private readonly scene: T.Scene) {
    const plane = new T.PlaneGeometry(1, 1)
    const g = new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry)
    plane.dispose()
    const seeds = new Float32Array(AMBIENT_CAPACITY * 4)
    let s = 4093
    const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < seeds.length; i++) seeds[i] = next()
    g.setAttribute('lavaSeed', new T.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = 0
    const smokeGeometry = g.clone()
    for (const u of [this.level, this.fire, this.embers, this.wind, this.dim]) (u as unknown as { setGroup(g: unknown): { onRenderUpdate(f: () => unknown): void } }).setGroup(renderGroup).onRenderUpdate(() => u.value)

    const seed = attribute('lavaSeed', 'vec4')
    // Home in the square round the camera. Flames are packed into a smaller square so the
    // patches near you are full; embers and sparks spread wider.
    const box = select(seed.w.lessThan(0.45), float(BOX * 0.6), float(BOX))
    const home = fract(seed.xy.sub(cameraPosition.xz.div(box))).sub(0.5).mul(box).add(cameraPosition.xz)
    const bed = this.bedMap.sample(home.mul(this.bedFrame.x).add(this.bedFrame.y.add(0.5))).level(float(0)).r.add(this.bedFrame.z)
    const depth = this.level.sub(bed)
    const open = smoothstep(0.35, 0.8, depth)
    const shore = smoothstep(-0.1, 0.1, depth).mul(smoothstep(0.9, 0.5, depth))
    // Type by seed: 0..0.45 flame, ..0.8 ember, ..0.92 spark, rest smoke wisp.
    const kind = seed.w
    const isFlame = kind.lessThan(0.45)
    const isEmber = kind.greaterThanEqual(0.45).and(kind.lessThan(0.8))
    const isSpark = kind.greaterThanEqual(0.8).and(kind.lessThan(0.92))
    const life = select(isFlame, float(1.6).add(seed.z), select(isEmber, float(3).add(seed.z.mul(2)), select(isSpark, float(0.9).add(seed.z.mul(0.6)), float(5).add(seed.z.mul(3)))))
    const age = fract(time.div(life).add(seed.z.mul(7.3)))
    // Patches: flames burn where a slow field drifting with the wind is high.
    const patch = smoothstep(0.47, 0.64, noise(home.mul(0.022).sub(this.wind.mul(time.mul(0.02)))).mul(0.7).add(noise(home.mul(0.09).add(time.mul(0.05))).mul(0.3)))
    const drift = this.wind.mul(age).mul(life).mul(0.6)
    const curl = vec2(sin(time.mul(1.7).add(seed.x.mul(40))), sin(time.mul(1.3).add(seed.y.mul(40)))).mul(age.mul(0.9))
    const flameH = float(1.2).add(seed.z.mul(2.2)).mul(this.fire)
    const emberH = float(3).add(seed.z.mul(7))
    // Sparks hop out over the land: a short ballistic arc.
    const hop = seed.z.mul(2.2).add(1.4)
    const sparkY = age.mul(life).mul(hop).sub(age.mul(life).pow(2).mul(4.9)).max(0)
    const rise = select(isFlame, age.mul(flameH), select(isEmber, age.mul(emberH), select(isSpark, sparkY, age.mul(3.5))))
    const sideways = select(isEmber, curl.add(drift), select(isSpark, vec2(seed.x.sub(0.5), seed.y.sub(0.5)).mul(age.mul(2.2)), drift))
    const position = vec3(home.x.add(sideways.x), this.level.add(0.15).add(rise), home.y.add(sideways.y))
    // Fade out toward the edge of the square, where a particle wraps to the other side.
    const offCentre = home.sub(cameraPosition.xz).abs()
    const inBox = smoothstep(box.mul(0.5), box.mul(0.36), offCentre.x.max(offCentre.y))
    const where = inBox.mul(1).mul(select(isFlame, open.mul(patch).mul(this.fire.min(1)), select(isEmber, open.mul(patch.mul(0.7).add(0.3)).mul(this.embers.min(1)), shore.mul(this.embers.min(1)))))
    const fade = smoothstep(0, 0.12, age).mul(float(1).sub(smoothstep(0.55, 1, age)))
    const flameSize = float(0.8).add(seed.y.mul(seed.y).mul(3.2)).mul(float(1).sub(age.mul(0.65))).mul(this.fire.max(0.5).min(1.5))
    const size = select(isFlame, flameSize, select(isEmber, float(0.14).add(seed.y.mul(0.16)), float(0.09).add(seed.y.mul(0.08)))).mul(where.greaterThan(0.02).select(1, 0))
    const r = uv().sub(0.5).length()
    const disc = float(1).sub(smoothstep(0.08, 0.5, r))
    // A lick of flame: wide and bright at the root, tapering and wavering to a tip.
    const fy = uv().y
    const sway = sin(fy.mul(6).add(time.mul(9)).add(seed.x.mul(30))).mul(0.06).mul(fy)
    const half = float(0.5).mul(float(1).sub(fy.mul(0.8)))
    const lick = float(1).sub(smoothstep(half.mul(0.05), half, uv().x.sub(0.5).add(sway).abs())).mul(smoothstep(0, 0.15, fy)).mul(float(1).sub(smoothstep(0.35, 1, fy)))

    const glow = new T.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending })
    glow.fog = false
    glow.positionNode = position
    // Flames are tall licks; embers and sparks small points.
    glow.scaleNode = vec2(size, size.mul(select(isFlame, float(2.1), float(1)))).mul(kind.lessThan(0.92).select(1, 0))
    // Yellow at the root, red at the tip and as it dies; flickering.
    const flicker = sin(time.mul(17).add(seed.y.mul(60))).mul(0.15).add(sin(time.mul(7.3).add(seed.x.mul(20))).mul(0.15)).add(0.85)
    const flameColour = mix(mix(vec3(2.4, 0.95, 0.16), vec3(1.4, 0.22, 0.03), fy), vec3(0.9, 0.08, 0.01), age).mul(flicker)
    const emberColour = mix(vec3(5, 2.6, 0.6), vec3(1.4, 0.15, 0.01), age)
    glow.colorNode = select(isFlame, flameColour, emberColour).mul(this.dim)
    // Smoke wisps are drawn by the other batch.
    glow.opacityNode = select(isFlame, lick.mul(lick), disc.mul(disc)).mul(fade).mul(where).mul(select(isFlame, float(0.8), float(1))).mul(kind.lessThan(0.92).select(1, 0))
    this.glow = new T.Mesh(g, glow)

    const smoke = new T.SpriteNodeMaterial({ transparent: true, depthWrite: false })
    smoke.positionNode = position
    const wisp = float(0.8).add(seed.y).mul(age.add(0.4)).mul(kind.greaterThanEqual(0.92).select(1, 0)).mul(shore.greaterThan(0.02).select(1, 0))
    smoke.scaleNode = vec2(wisp, wisp)
    smoke.colorNode = mix(vec3(0.9, 0.33, 0.08).mul(this.dim), vec3(0.27, 0.25, 0.28), smoothstep(0, 0.5, age))
    smoke.opacityNode = disc.mul(fade).mul(shore).mul(inBox).mul(this.embers.min(1)).mul(0.22).mul(kind.greaterThanEqual(0.92).select(1, 0))
    this.smoke = new T.Mesh(smokeGeometry, smoke)

    for (const [mesh, name, order] of [[this.glow, 'lava-ambient', 1], [this.smoke, 'lava-ambient-smoke', 2]] as const) {
      mesh.name = name
      mesh.frustumCulled = false
      mesh.renderOrder = order
      mesh.visible = false
      applyCurve(mesh.material)
      scene.add(mesh)
    }
  }

  setBed(bed: WaterBed | null): void {
    this.bedMap.value = bed?.texture ?? NO_BED
    this.bedFrame.value.set(1 / (bed?.size ?? 2048), bed ? 0.5 / bed.texture.image.width : 0, bed?.reference ?? 0)
  }

  /** Per frame. `on` when the sea is lava; `dim` holds lava brightness as night exposure rises. */
  update(_dt: number, level = 0, dim = 1, wind?: { x: number; z: number }): void {
    const budget = Math.min(particleBudget.value, qualityBudget().particles)
    const count = this.on ? ambientCount(budget, lavaFire.value, lavaEmbers.value) : 0
    this.glow.geometry.instanceCount = count
    this.smoke.geometry.instanceCount = count
    this.glow.visible = this.smoke.visible = count > 0
    this.level.value = level
    this.fire.value = lavaFire.value
    this.embers.value = lavaEmbers.value
    this.dim.value = dim
    this.wind.value.set((wind?.x ?? 0) + windX.value, (wind?.z ?? 0) + windZ.value)
  }

  get count(): number { return this.glow.geometry.instanceCount }

  dispose(): void {
    for (const mesh of [this.glow, this.smoke]) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose() }
  }
}
