/**
 * The view from inside a liquid: a place, not an abyss.
 *
 * Water. A scattering medium in the planet's own water colour, bright near the top and falling
 * off with depth only to a floor (UNDERWATER_LIGHT_FLOOR), so the bed and the shore stay in
 * view. Objects lose their own colour toward the water's along the sight line (water.underVisibility
 * is the distance at which a tenth survives), lights are dimmed only to that same floor, moving
 * caustics play over everything under the surface (seen from above the surface too, on the
 * bed of the sea), and shafts of sunlight hang in the water when the camera is in it.
 *
 * Lava. Only when the camera itself is in lava (the cockpit view, the free camera); the chase
 * camera stays above it. An incandescent medium: orange and yellow all round, brighter
 * convection cells drifting past, darker crust fragments, brightest toward the surface so up
 * is always readable, visibility a few metres.
 *
 * All of it lives in the scene's fog node, which every material evaluates for its own pixels,
 * so there is no extra pass and nothing new to compile on a crossing: the medium blends in by
 * uniforms only.
 */
import * as T from 'three/webgpu'
import {
  Fn, If, cameraPosition, exp, float, mix, mx_noise_float, normalize, output, positionView, positionWorld,
  renderGroup, sin, smoothstep, time, uniform, vec2, vec3, vec4,
} from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { seaLevel } from '../seaLevel'
import type { Game } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { paletteFor } from '../terrain/palettes'
import { cameraInWater, liquidDaylight } from './daylight'
import { waterClarity } from './params'
import { UNDERWATER_DEFAULTS, type UnderwaterSettings, underwaterLook, underwaterRamp } from './waterEffectsMath'

export const waterUnderwater = defineParam<boolean>({ id: 'water.underwater', label: 'Underwater camera', group: 'Water', scope: 'client', default: true })
/** How much light there is under water. 1 ships; the floor with depth holds at any setting. */
export const waterUnderBrightness = defineParam({ id: 'water.underBrightness', label: 'Underwater brightness', group: 'Water', scope: 'client', default: 1, min: 0.3, max: 2, step: 0.05 })
/** Metres at which a tenth of an object's colour survives under water. */
export const waterUnderVisibility = defineParam({ id: 'water.underVisibility', label: 'Underwater visibility (m)', group: 'Water', scope: 'client', default: 38, min: 8, max: 120, step: 1 })
/** Caustics and light shafts under water. 0 turns both off. */
export const waterCaustics = defineParam({ id: 'water.caustics', label: 'Caustics and light shafts', group: 'Water', scope: 'client', default: 1, min: 0, max: 2, step: 0.05 })

// Post effects run after scene fog. Share its eased amount by camera so they can fade
// atmospheric overlays without changing their graph or affecting reflection captures.
const cameraAmounts = new WeakMap<T.Camera, number>()
export function underwaterAmountForCamera(camera: T.Camera): number { return cameraAmounts.get(camera) ?? 0 }

/**
 * Which liquid the camera's lens is in, and how deep: the hook for the audio system's
 * submerged state (muffling) and anything else that should change with the view rather than
 * with the vehicle. `amount` is the eased 0..1 blend the picture uses.
 */
export interface CameraMedium { kind: 'water' | 'lava' | null; depth: number; amount: number }
const medium: CameraMedium = { kind: null, depth: 0, amount: 0 }
export function cameraMedium(): Readonly<CameraMedium> { return medium }

/** Narrow seam on AlienSkyMesh: see src/world/sky/AlienSkyMesh.ts. */
interface SkySeam { underwaterCamera: T.Camera | null; underwaterAmount: number; underwaterTint: { value: T.Vector3 }; sunDirection?: { value: T.Vector3 } }
interface LightState { light: T.Light; before: number; applied: number }

const srgbToLinear = (hex: number): [number, number, number] => {
  const c = new T.Color(hex)
  return [c.r, c.g, c.b]
}

/** Lava seen from inside: incandescent, at roughly the lava surface's own brightness. */
const LAVA_GLOW = new T.Vector3(2.2, 0.62, 0.08)
/** Metres of lava at which a tenth of an object's colour survives. */
const LAVA_VISIBILITY = 7

/** The air fog each underwater fog node wraps (see the constructor). */
const airUnder = new WeakMap<object, unknown>()
/**
 * The air fog behind the scene fog node: the one an underwater fog node wraps, or the node
 * itself. For a surface that treats the air fog's layers apart (surface.ts hazeCurve).
 */
export function airFogOf(fogNode: unknown): unknown {
  return fogNode && typeof fogNode === 'object' ? airUnder.get(fogNode) ?? fogNode : fogNode
}

/** Installed after Environment, before the first frame. Crossings change uniforms only. */
export class Underwater {
  private tint = uniform(new T.Color())
  private extinction = uniform(0.06)
  private blend = uniform(0)
  /** 0 water, 1 lava: which medium the blend shows. */
  private lava = uniform(0)
  /** Height of the water surface for caustics: the camera's own when under, the sea's otherwise. */
  private causticLevel = uniform(-1e9)
  private causticGain = uniform(1)
  private sunDirection = uniform(new T.Vector3(0, 1, 0))
  /** The planet's shallow water colour, normalised to its brightest channel: what water passes. */
  private seaHue = uniform(new T.Vector3(0.05, 1, 0.93))
  /** Per-metre loss along a sight line through water seen from above: 2.3 / water.clarity. */
  private columnLoss = uniform(0.23)
  private readonly fogNode: T.Node
  private readonly savedFog: T.Scene['fogNode']
  private savedEnvironment = 1
  private appliedEnvironment = 1
  private lights: LightState[] = []
  private active = false
  private readonly settings: UnderwaterSettings = { ...UNDERWATER_DEFAULTS, shallow: [...UNDERWATER_DEFAULTS.shallow], deep: [...UNDERWATER_DEFAULTS.deep] }
  private look = -1

  constructor(private game: Game, private terrain: Terrain) {
    const surfaceLook = underwaterLook(0)
    this.tint.value.setRGB(surfaceLook.red, surfaceLook.green, surfaceLook.blue)
    for (const u of [this.tint, this.extinction, this.blend, this.lava, this.causticLevel, this.causticGain, this.sunDirection, this.seaHue, this.columnLoss]) {
      (u as unknown as { setGroup(g: unknown): { onRenderUpdate(f: () => unknown): void } }).setGroup(renderGroup).onRenderUpdate(() => u.value)
    }
    this.savedFog = game.scene.fogNode
    const air = (this.savedFog ?? output) as T.Node<'vec4'>
    const { tint, extinction, blend, lava, causticLevel, causticGain, sunDirection, seaHue, columnLoss } = this
    this.fogNode = Fn(() => {
      const p = positionWorld
      const distance = positionView.length()
      const sunUp = smoothstep(0.0, 0.3, sunDirection.y)
      // Caustics: where light focused by the waves above lands. The zero crossings of a sum
      // of three warped travelling sines form a network of thin bright curves, like the real
      // pattern, for six sines a pixel. They fade with depth and are strongest just under the
      // surface, and are lit by the sun only.
      const below = causticLevel.sub(p.y)
      const near = smoothstep(0.05, 0.6, below).mul(exp(below.mul(-0.07))).mul(smoothstep(160, 40, distance))
      const caustic = float(0).toVar()
      If(near.mul(causticGain).mul(sunUp).greaterThan(0.002), () => {
        const q = p.xz.mul(0.55)
        const t = time.mul(0.9)
        const warp = vec2(sin(q.y.mul(0.7).add(t.mul(0.6))), sin(q.x.mul(0.8).sub(t.mul(0.5)))).mul(1.4)
        const r = q.add(warp)
        const s = sin(r.x.mul(1.9).add(t)).add(sin(r.x.mul(-0.95).add(r.y.mul(1.65)).add(t.mul(1.13)))).add(sin(r.x.mul(-0.95).sub(r.y.mul(1.65)).sub(t.mul(0.87))))
        const lines = smoothstep(0.4, 0.0, s.abs())
        // A slow second pattern dims and brightens the network so it never reads as a grid.
        const patch = sin(q.x.mul(0.31).add(q.y.mul(0.47)).add(t.mul(0.21))).mul(sin(q.y.mul(0.27).sub(q.x.mul(0.19)).sub(t.mul(0.17)))).mul(0.5).add(0.6)
        caustic.assign(lines.mul(lines).mul(patch).mul(near).mul(causticGain).mul(sunUp).mul(1.8))
      })
      const lit = output.rgb.mul(caustic.add(1))
      // Seen from above the surface, anything under it is seen through the water column: each
      // channel loses light at its own rate (red fastest in a turquoise sea), so the bed of a
      // shallow lagoon reads clear and tinted, deeper water saturates to the planet's colour,
      // and a sunk vehicle darkens into it instead of floating pale on top. Under water the
      // medium below does this along the sight line instead.
      const sight = normalize(p.sub(cameraPosition))
      const column = below.max(0).mul(float(1.3).add(float(1).sub(sight.y.abs()).mul(0.6)))
      const absorb = exp(column.mul(columnLoss).mul(float(1.25).sub(seaHue)).negate())
      const seen = mix(lit.mul(absorb), lit, blend)
      output.assign(vec4(seen, output.a))
      const result = vec4(air).toVar()
      If(blend.greaterThan(0.001), () => {
        const view = normalize(p.sub(cameraPosition))
        const kept = exp(distance.mul(extinction).negate())
        // Water: the object's colour, absorbed toward the water's hue, then in-scattered light.
        const hue = tint.div(tint.r.max(tint.g).max(tint.b).max(1e-4))
        const absorbed = lit.mul(mix(hue, vec3(1), kept))
        // Shafts: sample the light pattern a few times along the sight line, each where the
        // sun's ray through it crossed the surface. Strongest looking toward the sun.
        const shafts = float(0).toVar()
        If(causticGain.mul(sunUp).greaterThan(0.01).and(lava.lessThan(0.5)), () => {
          const slant = sunDirection.xz.div(sunDirection.y.max(0.25)).mul(0.75)
          const reach = distance.min(28)
          for (const f of [0.15, 0.35, 0.6, 0.9]) {
            const at = cameraPosition.add(view.mul(reach.mul(f)))
            const uvS = at.xz.add(slant.mul(causticLevel.sub(at.y).max(0))).mul(0.12)
            const band = sin(uvS.x.mul(2.3).add(time.mul(0.25))).mul(sin(uvS.y.mul(1.7).sub(time.mul(0.2)))).add(sin(uvS.x.add(uvS.y).mul(3.1).add(time.mul(0.33))).mul(0.5))
            shafts.addAssign(smoothstep(0.35, 1.2, band).mul(0.25))
          }
          const toward = view.dot(normalize(vec3(sunDirection.x.negate().mul(0.75), sunDirection.y.max(0.25), sunDirection.z.negate().mul(0.75))).negate()).mul(0.5).add(0.5)
          shafts.assign(shafts.mul(causticGain).mul(sunUp).mul(toward.mul(0.7).add(0.3)).mul(float(1).sub(kept)))
        })
        const water = mix(tint.mul(shafts.mul(1.8).add(1)), absorbed, kept)
        // Lava: incandescent all round, cells of brighter melt drifting through it and darker
        // crust tumbling past, brightest looking up toward the surface.
        const cell = mx_noise_float(cameraPosition.add(view.mul(3)).mul(0.35).add(vec3(0, time.mul(0.4), time.mul(0.15)))).mul(0.5).add(0.5)
        const crust = smoothstep(0.62, 0.75, mx_noise_float(cameraPosition.add(view.mul(2)).mul(0.8).add(vec3(time.mul(0.3), time.mul(-0.5), 0))).mul(0.5).add(0.5))
        const upward = view.y.mul(0.5).add(0.5)
        const glow = tint.mul(mix(float(0.55), float(1.5), upward)).mul(cell.mul(0.9).add(0.4)).mul(float(1).sub(crust.mul(0.75)))
        const molten = mix(glow, lit.add(tint.mul(0.25)), kept)
        result.assign(mix(air, vec4(mix(water, molten, lava), output.a), blend))
      })
      return result
    })()
    // Retain Environment's live air graph. Swapping its identity at the surface rebuilds
    // every affected material and GPU pipeline, even on the tenth crossing.
    game.scene.fogNode = this.fogNode
    airUnder.set(this.fogNode, this.savedFog)
  }

  /** Restore light overrides without disturbing newer Environment writes. */
  private restore() {
    if (!this.active) return
    const scene = this.game.scene
    if (scene.environmentIntensity === this.appliedEnvironment) scene.environmentIntensity = this.savedEnvironment
    for (const s of this.lights) if (s.light.intensity === s.applied) s.light.intensity = s.before
    this.lights = []
    this.active = false
  }

  /** The sky dome is drawn unfogged; it carries its own camera-only underwater seam. */
  private sky: SkySeam | null = null
  private skySearch = 0
  private findSky() {
    if (this.sky || this.skySearch-- > 0) return this.sky
    this.skySearch = 30
    const sky = this.game.scene.children.find(o => 'sunDirection' in o && 'betaR' in o && 'underwaterTint' in o) as unknown as SkySeam | undefined
    if (sky) { this.sky = sky; sky.underwaterCamera = this.game.camera }
    return this.sky
  }

  /** The medium's colour as the camera sees it from inside, linear. */
  get tintColour(): T.Color { return this.tint.value }

  /** Current fog blend, for tests and evidence. */
  get amount() { return this.blend.value }

  /** The planet's water colours, read from the terrain look when it changes. */
  private planetColours() {
    const look = Number(params.get('terrain.look')?.value ?? 0)
    if (look === this.look) return
    this.look = look
    const palette = paletteFor(look)
    this.settings.shallow = srgbToLinear(palette.seaShallow)
    this.settings.deep = srgbToLinear(palette.seaDeep)
  }

  /**
   * `wash` (0..1) is the lens rule's waterline moment: it briefly thickens the water fog
   * round the crossing so the surface reads as a soft pass, not a cut.
   */
  update(dt = 1 / 60, wash = 0) {
    this.restore()
    const p = this.game.camera.position
    const kind = this.terrain.liquidKindAt?.(p.x, p.z) ?? null
    const surface = waterUnderwater.value && kind ? this.terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity : -Infinity
    const depth = surface - p.y
    const wet = Number.isFinite(depth) && depth > 0
    // The look deepens over the first 0.45 m below the lens, eased, and follows at a bounded
    // rate, so it arrives with the camera during the one-second crossing.
    const target = Math.max(wet ? underwaterRamp(depth) : 0, Number.isFinite(depth) && kind === 'water' ? wash * 0.6 : 0)
    const step = Math.max(0, Math.min(0.25, dt)) / 0.25
    this.blend.value += Math.max(-step, Math.min(step, target - this.blend.value))
    cameraAmounts.set(this.game.camera, this.blend.value)
    medium.kind = wet ? kind : null
    medium.depth = wet ? depth : 0
    medium.amount = this.blend.value
    cameraInWater.value = wet && kind === 'water' ? 1 : 0

    const sky = this.findSky()
    // The same night ramp as the vehicles' (nightReadability.ts), from the sun's height.
    const sunY = sky?.sunDirection?.value?.y ?? 1
    const night = Math.min(1, Math.max(0, (0.08 - sunY) / 0.18))
    if (sky?.sunDirection?.value) this.sunDirection.value.copy(sky.sunDirection.value)
    this.planetColours()
    this.settings.brightness = waterUnderBrightness.value
    this.settings.visibility = waterUnderVisibility.value
    this.settings.daylight = 1 - 0.7 * night
    liquidDaylight.value = this.settings.daylight
    const look = underwaterLook(Math.max(0, Number.isFinite(depth) ? depth : 0), this.settings)
    if (wet && kind === 'lava') {
      this.lava.value = 1
      this.tint.value.setRGB(LAVA_GLOW.x, LAVA_GLOW.y, LAVA_GLOW.z)
      this.extinction.value = 2.3 / LAVA_VISIBILITY
    } else if (wet || wash > 0) {
      this.lava.value = 0
      this.tint.value.setRGB(look.red, look.green, look.blue)
      this.extinction.value = look.extinction + wash * 0.3
    }
    // Caustics under the camera's water, or on the bed of a water sea seen from above it.
    // A frozen sea is ice, not water: no caustics on what lies under it.
    const seaIsWater = Number(params.get('world.seaKind')?.value ?? 0) === 1 && params.get('world.seaFrozen')?.value !== true
    this.causticLevel.value = wet && kind === 'water' ? surface : seaIsWater ? seaLevel() : -1e9
    this.causticGain.value = waterCaustics.value * (1 - night)
    const [r, g, b] = this.settings.shallow, peak = Math.max(r, g, b, 1e-4)
    this.seaHue.value.set(r / peak, g / peak, b / peak)
    this.columnLoss.value = 2.3 / Math.max(1, waterClarity.value)
    if (sky) { sky.underwaterAmount = this.blend.value; const c = this.tint.value; sky.underwaterTint.value.set(c.r, c.g, c.b) }
    if (this.blend.value === 0 || this.lava.value === 1) return
    const scene = this.game.scene
    const transmission = 1 + (look.transmission - 1) * this.blend.value
    this.savedEnvironment = scene.environmentIntensity
    this.appliedEnvironment = this.savedEnvironment * transmission
    scene.environmentIntensity = this.appliedEnvironment
    for (const object of scene.children) {
      if (!(object instanceof T.DirectionalLight || object instanceof T.HemisphereLight)) continue
      const before = object.intensity, applied = before * transmission
      this.lights.push({ light: object, before, applied })
      object.intensity = applied
    }
    this.active = true
  }

  dispose() {
    this.restore()
    cameraAmounts.delete(this.game.camera)
    medium.kind = null; medium.depth = 0; medium.amount = 0
    if (this.sky) { this.sky.underwaterAmount = 0; this.sky.underwaterCamera = null }
    if (this.game.scene.fogNode === this.fogNode) this.game.scene.fogNode = this.savedFog
  }
}
