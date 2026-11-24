import { glassStyle } from '../../ui/inspector/params'
import { liquidSelected } from '../../ui/glassMaterial'
import type { GlassPost } from './GlassPost'
import { longFrames } from '../../core/longFrames'
/**
 * The in-game post chain: what turns the rendered world into the picture.
 *
 * Registered with `game.setPostChain(chain)`; Game then hands each frame to `render` instead
 * of calling `renderer.render` itself. When the gate says off (post effects switched off,
 * graphics level 0, or a phone or tablet not opted in) `render` is exactly
 * `renderer.render(scene, camera)`. A neighboring post graph may remain parked.
 *
 * One active pipeline, selected by shape (tier, or an effect taken to or from 0):
 *
 *   scene pass      colour (half float, the canvas's MSAA) and depth.
 *   glow            three's BloomNode on the exposed colour, clamped, as tuned on feat/fx-bloom.
 *   sun rays        soft streaks round the sun at any height: the lobby galaxy's streak
 *                   pattern (sunburst.ts), fixed in the world round the sun, carrying the sky's
 *                   forward glow plus a share of its own light (AlienSkyMesh.rayLight), most at
 *                   a low sun (post.rayHighSun sets how much is left with it high). The streaks
 *                   add light and barely darken anything (sunburst.RAY_DARK). A mask at half
 *                   (full tier) or quarter resolution holds that light and how open each pixel
 *                   is (open sky less cloud; terrain, vehicles and smoke closed); a march toward
 *                   the sun, weighted to its end and blurred, says how open the way to the sun
 *                   is, so a ridge, a cloud bank or a vehicle throws beams and gaps into the
 *                   burst. Open sky keeps RAY_SKY_FLOOR of it even behind a ridge. The sky
 *                   shader draws the same burst over open sky as the cheap form wherever this
 *                   pass does not: Minimal and Low, a shed post budget, a sun off screen. The
 *                   two crossfade so open sky always gets the set strength.
 *   lens flare      an anamorphic streak and three ghosts, from the sun's screen position,
 *                   dimmed by the same mask read at the sun: the volcano eclipses it.
 *   tone map        the renderer's own ACES and exposure, as renderer.render would.
 *   look            per planet colour grade in display values, then vignette and grain.
 *
 * Exposure: the sky's auto exposure raises toneMappingExposure about sevenfold at night.
 * Glow and shafts are computed on exposed colour (what the eye sees on screen) and divided by
 * exposure before they are added back ahead of tone mapping, so a light blooms the same by
 * day and by night. See tools/bloom-review.md for the measurements behind that.
 */
import * as THREE from 'three/webgpu'
import {
  Fn, If, Loop, abs, screenSize, sin, clamp, dot, exp, float, interleavedGradientNoise, length, max, min, mix, pass,
  builtinAOContext, builtinGIContext, getViewPosition, builtinShadowContext, context, mrt, nodeObject, normalView, output, screenUV, renderOutput, renderGroup, rtt, screenCoordinate, smoothstep, step,  uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { sss } from 'three/addons/tsl/display/SSSNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { CurvedVelocity } from './CurvedVelocity'
import { cloudVolume, compositeClouds } from './clouds'
import { AlienSkyMesh, rayLight, skyCloudField, skyScatter } from '../../world/sky/AlienSkyMesh'
import { BURST_CORE, RAY_DARK, burstReach, burstSwing, createBurstUniforms, writeBurstFrame } from './sunburst'
import { rayGlowShare } from '../../world/sky/skyMath'
import { underwaterAmountForCamera } from '../../world/water/underwater'
import type { CloudInputs } from '../../world/Environment'
import { motionBlurred } from './motion'
import { params, type Param, type ParamValue } from '../../../shared/params'
import type { CoveredWarm } from '../../core/Game'
import type { QualityLevel } from '../../core/quality'
import type { GuardedRenderer } from '../../core/deviceLoss'
import { type PostTier, drawsEffects, lowSunAmount, rayDryness, postTier, shaftTaps, sunHeightFactor, sunScreenFade } from './gate'
import { type Grade, gradeFor, lookForKind } from './looks'
import * as P from './params'

type N = any // TSL node

/** Brightest exposed value a pixel may feed into glow or shafts, as a multiple of the glow threshold. */
export const HOT_CLAMP = 2
/** Brightest exposed value the lens flare takes from the sun. */
export const SHAFT_CLAMP = 1.5
export { BURST_CORE }
/** Share of the scene fog's under-surface blend over which the sun rays fade out. */
export const RAY_WET_FADE = 0.5
/** Share of the burst open sky keeps when the march toward the sun is blocked. */
export const RAY_SKY_FLOOR = 0.35
/** Cloud opacity at which a cloud starts to block the sun for the shafts, and blocks it fully. */
export const CLOUD_THIN = 0.12, CLOUD_SOLID = 0.55
/** Distance (m) over which the haze in front of terrain reaches the full post.shaftHaze. */
export const SHAFT_HAZE_DEPTH = 700

// Two neighboring full graphs plus the governor’s shared colour-only graph.
const MAX_STANDBY_GRAPHS = 6

export interface PostChainHost {
  /**
   * The frame governor (src/core/quality.ts), the one in-game quality authority.
   * postTier: the tier the current quality level allows; absent reads as full, for
   * fixtures that drive the chain alone. postBudget: the governor's post budget, 0 to 1
   * eased, which only fades strengths; absent reads as a full budget. setPostActive tells
   * the governor whether there is anything to shed, so its post rung exists only while the
   * chain draws a costly effect.
   */
  readonly quality: {
    readonly postTier?: PostTier
    readonly postBudget?: number
    getQualityState?(): { readonly level: QualityLevel }
    setPostActive?(on: boolean): void
  }
}
export interface SunSource {
  readonly sunDirection: THREE.Vector3
  readonly lightDirection?: THREE.Vector3
  readonly clouds?: CloudInputs
  setVolumetricCloudsActive?(active: boolean): void
  /** Linear colour times intensity of the direct light, and the horizon sky colour. */
  readonly sunColor?: THREE.Color
  readonly horizonColor?: THREE.Color
}

/** three's tone mapping constants for post.toneMap 0, 1, 2. */
const TONE_MAPS = [THREE.ACESFilmicToneMapping, THREE.AgXToneMapping, THREE.NeutralToneMapping]

/** Fully resolved preset values, including player overrides. Undefined falls back to the live value. */
export interface PostGraphPreset {
  shed?: boolean
  tier: PostTier
  level: QualityLevel
  value(id: string): ParamValue | undefined
}

interface GraphSpec {
  glassOnly: boolean
  key: string
  tier: PostTier
  glowOn: boolean
  shaftsOn: boolean
  flareOn: boolean
  aoOn: boolean
  light: THREE.DirectionalLight | null
  toneMap: THREE.ToneMapping
  debug: number
  giOn: boolean
  cloudsOn: boolean
  temporalOn: boolean
  motionOn: boolean
  composeOn: boolean
}

function postValue<T extends ParamValue>(param: Param<T>, preset?: PostGraphPreset): T {
  return (preset?.value(param.def.id) ?? param.value) as T
}

interface GraphScope {
  renderer: THREE.WebGPURenderer
  backend: THREE.WebGPURenderer['backend']
  context: unknown
  device: unknown
  scene: THREE.Scene
  camera: THREE.Camera
}

interface Built {
  glass?: ReturnType<GlassPost['build']>
  key: string
  tier: PostTier
  targets: THREE.RenderTarget[]
  /** Quarter resolution shaft targets: skipped entirely while the sun is out of view. */
  maskTex: N | null
  raysTex: N | null
  /** Ambient occlusion and contact shadow nodes, for their live settings. */
  aoNode: N | null
  sssNode: N | null
  giNode: N | null
  temporalNode: N | null
  clouds: boolean
  /** The scene pass, for its render target's sample count (blank frame report). */
  scenePass: { renderTarget?: { samples?: number } } | null
  pipeline: THREE.RenderPipeline
  disposables: Array<{ dispose?(): void }>
}

export class PostChain {
  private built: Built | null = null
  private readonly standby = new Map<string, Built>()
  private shedKey: string | undefined
  private readonly presetKeys = new Map<QualityLevel, string>()
  private scope: GraphScope | null = null
  private generation = 0
  private disposed = false
  private warming = false
  private warmPreset: PostGraphPreset | undefined
  private volumetricCloudsActive = false
  private coveredDraws = 0
  private activations = 0
  private restoredTargets = 0

  /**
   * Attachment texels describe logical dormant sizes. Restored targets counts the targets
   * enlarged by the first live draw after activation, excluding passes gated off that frame.
   */
  get reuseStats() {
    const targets = [...this.standby.values()].flatMap(graph => graph.targets)
    const dormantAttachmentTexels = targets.reduce((total, target) =>
      total + target.width * target.height * (target.textures.length + Number(target.depthBuffer || !!target.depthTexture)), 0)
    return {
      coveredDraws: this.coveredDraws,
      activations: this.activations,
      restoredTargets: this.restoredTargets,
      dormantGraphs: this.standby.size,
      dormantTargets: targets.length,
      dormantAttachmentTexels,
    }
  }
  /** Times a pipeline has been built, for checks. */
  builds = 0
  /** Camera discontinuities and covered draws that discarded active temporal history. */
  historyResets = 0
  /** The tier the last frame used, for checks and the lab. */
  tier: PostTier = 'off'

  private readonly u = {
    exposure: uniform(1),
    aspect: uniform(16 / 9),
    sunUv: uniform(new THREE.Vector2(0.5, 0.3)),
    sunVis: uniform(0),
    bloom: uniform(0.5),
    bloomThreshold: uniform(3),
    bloomRadius: uniform(0.4),
    shafts: uniform(0.7),
    shaftLength: uniform(0.75),
    shaftHaze: uniform(0.35),
    shaftReach: uniform(0.05),
    /** Swing at a fully edged path (post.gapShafts times post.gapContrast). */
    gapGain: uniform(1),
    /** Share of the forward glow the rays carry at this sun height (skyMath.rayGlowShare). */
    rayShare: uniform(0),
    /** Share of the sky's own light the rays also move (post.rayFill). */
    rayFill: uniform(0),
    flare: uniform(0.5),
    gain: uniform(new THREE.Vector3(1, 1, 1)),
    lift: uniform(new THREE.Vector3(0, 0, 0)),
    contrast: uniform(0),
    saturation: uniform(1),
    vignette: uniform(0.3),
    grain: uniform(0.35),
    seed: uniform(0),
    heat: uniform(0.6),
    time: uniform(0),
    // Camera, for rebuilding positions from depth (three's camera nodes describe the post
    // quad's camera inside the pipeline, so the scene camera is passed in by hand).
    projInv: uniform(new THREE.Matrix4()),
    camWorld: uniform(new THREE.Matrix4()),
    camPos: uniform(new THREE.Vector3()),
    prevView: uniform(new THREE.Matrix4()),
    prevProj: uniform(new THREE.Matrix4()),
    motionAmount: uniform(0),
    motionNear: uniform(14),
    motionMax: uniform(0.04),
  }
  private readonly prevView = new THREE.Matrix4()
  private readonly prevProj = new THREE.Matrix4()
  private readonly prevPos = new THREE.Vector3()
  private readonly prevOrientation = new THREE.Quaternion()
  private hasPrev = false
  /** 0 to 1, jumps to 1 when the watched vehicle goes under and decays over about 0.7 s. */
  private lastAt = 0
  private readonly grade: Grade = { gain: [1, 1, 1], lift: [0, 0, 0], contrast: 0, saturation: 1 }
  private readonly tmp = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  /** The sky, whose near-sun forward glow the sunburst modulates. */
  private sky: AlienSkyMesh | null = null
  private screenFade = 0
  private readonly reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  /** The burst's frame round the sun, shared in shape with the sky's cheap rays. */
  private readonly burst = createBurstUniforms()
  private burstClock = 0

  setCovered(covered: boolean): void { if (this.glass) this.glass.covered = covered }
  /** The drawn graph's scene pass sample count (0 under temporal AA), or null before one is built. */
  sceneSamples(): number | null { return this.built?.scenePass?.renderTarget?.samples ?? null }
  /** The scene pass colour this frame's graph drew, or null when the frame did not go through a graph (?frameProbe=1, core/frameProbe.ts). */
  drawnSceneTexture(): THREE.Texture | null { return this.drewGraph ? (this.built?.scenePass as { renderTarget?: { texture?: THREE.Texture } } | null)?.renderTarget?.texture ?? null : null }
  private drewGraph = false
  private cleanFrame = false
  private cleanDraw = <T>(draw: () => T): T => {
    this.cleanFrame = true
    try { return draw() } finally { this.cleanFrame = false }
  }
  get withoutGlass() { return this.glass ? this.cleanDraw : undefined }

  constructor(private readonly host: PostChainHost, private readonly sun: SunSource, private glass?: GlassPost) {}

  attachGlass(glass: GlassPost) { this.glass = glass }
  get glassPrepared() { return !!this.built?.glass }

  /** A post setting may select a parked graph, or a new one needing the Applying veil. */
  get selectedGlassPrepared(): boolean {
    if (!this.scope || !this.glass || !liquidSelected()) return false
    const tier = P.postOn.value ? postTier({ on: true, tier: this.host.quality.postTier ?? 'full',
      shed: 1 - Math.min(1, Math.max(0, this.host.quality.postBudget ?? 1)) }) : 'base'
    if (tier === 'off') return false
    const key = this.describeGraph(this.scope.renderer, this.scope.scene, tier).key
    return !!(this.built?.key === key ? this.built : this.standby.get(key))?.glass
  }

  /** Exact post context for covered draw deduplication. Also records equivalent preset levels. */
  coveredVariantKey(preset: PostGraphPreset): string | undefined {
    const scope = this.scope
    if (!scope) return undefined
    const tier = this.coveredTier(preset)
    const key = tier === 'off' ? 'off' : this.describeGraph(scope.renderer, scope.scene, tier, preset).key
    this.rememberPreset(preset.level, key, preset.shed)
    return key
  }

  hasRenderPreset(preset: PostGraphPreset): boolean {
    const scope = this.scope
    if (!scope) return false
    const tier = this.coveredTier(preset)
    const key = tier === 'off' ? 'off' : this.describeGraph(scope.renderer, scope.scene, tier, preset).key
    if (this.presetKeys.get(preset.level) !== key) return false
    if (key === 'off') return true
    const graph = this.built?.key === key ? this.built : this.standby.get(key)
    return !!graph && (!this.glass || glassStyle.value !== 0 || preset.level < 2 || !!graph.glass)
  }

  /** Submit one production draw under the target post graph, including on a graph cache hit. */
  async warmCovered(warm: Pick<CoveredWarm, 'draw' | 'yieldFrame'>, preset: PostGraphPreset): Promise<void> {
    if (this.disposed) return
    if (this.warming) throw new Error('Post graph warm is already in progress')
    this.warming = true
    const generation = this.generation
    try {
      await warm.yieldFrame('Preparing post effects')
      if (this.disposed || this.generation !== generation) return
      this.warmPreset = preset
      warm.draw()
    } finally {
      this.warmPreset = undefined
      this.warming = false
    }
  }

  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, _frameMs?: number): void {
    this.drewGraph = false
    if (this.disposed) {
      renderer.render(scene, camera)
      return
    }
    if ((renderer as unknown as GuardedRenderer)._isDeviceLost) {
      if (this.scope) {
        this.release()
        this.scope = null
        this.glass?.release('graphics context lost; using Glass')
      }
      return
    }
    this.bindScope(renderer, scene, camera)
    if (this.warmPreset) {
      this.renderCovered(renderer, scene, camera, this.warmPreset)
      return
    }
    const budget = this.host.quality.postBudget
    const shed = 1 - Math.min(1, Math.max(0, budget ?? 1))
    const level = this.host.quality.getQualityState?.().level
    const qualityTier = this.host.quality.postTier ?? 'full'
    const glassOnly = !P.postOn.value && !!this.glass && liquidSelected()
    const tier = glassOnly ? 'base' : postTier({ on: P.postOn.value, tier: qualityTier, shed })
    // The quality level owns which effects exist, through their strengths. Tier only
    // separates the look alone (base) from a chain that draws effects (lite, full).
    const effects = drawsEffects(tier)
    this.tier = tier
    // Anything the governor could shed: everything but the colour look itself. Sun rays count
    // only where the level draws them here; at Minimal and Low the sky draws its cheap form,
    // which nothing sheds.
    const levelEffects = drawsEffects(qualityTier)
    this.reportActive(tier !== 'off' && (P.postTemporal.value || [P.postBloom, levelEffects ? P.postShafts : null, P.postFlare, P.postAO, P.postContact, P.postMotionBlur, P.postGI, P.postClouds].some(p => p && p.value > 0)))
    const fade = tier === 'base' || tier === 'off' ? 0 : 1 - shed
    // Sun rays, lens flare and their passes are light through air. With the camera in water or
    // lava they would draw the sky's glow through the medium as hard white spokes (the owner,
    // v26.11.1713, on an iPhone at the bed of a desert lake). They fade out over the first part
    // of the scene fog's own eased crossing, so they are gone before the medium is thick and
    // come back as the lens clears the surface: no pop, and nothing is drawn below.
    const dry = rayDryness(underwaterAmountForCamera(camera), RAY_WET_FADE)
    const sunVis = this.updateSun(camera, renderer) * dry
    // The rays: drawn here as far as the sun is on screen and post effects are not faded, and
    // by the sky's cheap form for the rest, so the two always add to the set strength in open
    // sky. Minimal and Low, a shed post budget and a sun off screen all get the sky's rays.
    // The shaft passes are only redrawn while the sun is lit for them (sunVis, see render's end);
    // drawing the burst from a mask that is not being redrawn shows the last daylight frame's
    // rays after sunset. Fade the pass with the same visibility, before it stops redrawing.
    const shaftShare = effects && P.postShafts.value > 0 ? fade * this.screenFade * smooth01(0.001, 0.05, sunVis) : 0
    this.updateBurst(camera, P.postShafts.value * (1 - shaftShare) * dry)
    if (tier === 'off') {
      this.glass?.release(level === 0 ? 'Minimal quality' : !P.postOn.value ? 'post effects off' : 'post budget shed')
      if (qualityTier === 'off' && level !== undefined) {
        this.rememberPreset(level, 'off')
        this.pruneStandby(level)
        const previous = this.built
        this.built = null
        if (previous) this.retire(previous)
        this.setVolumetricCloudsActive(false)
      } else if (this.built || this.standby.size) {
        this.clearGraphs()
      }
      renderer.render(scene, camera)
      return
    }
    const spec = this.describeGraph(renderer, scene, tier)
    const { shaftsOn } = spec
    // A shed frame uses base temporarily. Keep the current level's full-budget graph eligible.
    this.rememberPreset(level, spec.key, tier !== qualityTier)
    this.pruneStandby(level)
    const reusing = this.activateGraph(renderer, scene, camera, spec)

    const u = this.u
    u.exposure.value = Math.max(1e-4, renderer.toneMappingExposure)
    u.sunVis.value = sunVis
    u.bloom.value = P.postBloom.value * fade
    u.bloomThreshold.value = P.postBloomThreshold.value
    u.bloomRadius.value = P.postBloomRadius.value
    // The burst needs the sun on screen (its openness march aims at it); past 1 it deepens.
    const shaftAmount = shaftsOn ? P.postShafts.value * shaftShare * dry : 0
    u.shafts.value = shaftAmount
    u.shaftLength.value = P.postShaftLength.value
    u.shaftHaze.value = P.postShaftHaze.value
    u.shaftReach.value = P.postShaftReach.value
    u.gapGain.value = P.postGapShafts.value * P.postGapContrast.value
    // Ghosts and streak belong to a low sun; overhead they read as smudges on the ground.
    u.flare.value = P.postFlare.value * fade * dry * (0.25 + 0.75 * lowSunAmount(this.sun.sunDirection.y))
    const g = gradeFor(lookForKind(params.get('terrain.kind')?.value), P.postLook.value, { contrast: P.postContrast.value, saturation: P.postSaturation.value, warmth: P.postWarmth.value }, this.grade)
    ;(u.gain.value as THREE.Vector3).set(g.gain[0], g.gain[1], g.gain[2])
    ;(u.lift.value as THREE.Vector3).set(g.lift[0], g.lift[1], g.lift[2])
    u.contrast.value = g.contrast
    u.saturation.value = g.saturation
    u.vignette.value = P.postVignette.value
    u.grain.value = P.postGrain.value * (tier === 'base' ? 1 : 1)
    u.seed.value = (u.seed.value + 61.7) % 4096
    this.updateCamera(camera as THREE.PerspectiveCamera, effects ? P.postMotionBlur.value * fade : 0)
    const b = this.built!
    if (b.aoNode) { b.aoNode.radius.value = P.postAORadius.value; b.aoNode.scale.value = P.postAO.value * fade }
    if (b.giNode) { b.giNode.radius.value = P.postGIRadius.value; b.giNode.giIntensity.value = P.postGI.value * fade }
    // Contact shadows march toward the sun with no surface bias, so a low sun grazing the
    // ground makes the ground shadow itself (noise, then scanlines). Fade them in with the
    // sun's height; at a low sun the long cascaded shadows carry the scene anyway.
    const sunUp = smooth01(0.25, 0.45, this.sun.sunDirection.y)
    if (b.sssNode) b.sssNode.shadowIntensity.value = P.postContact.value * fade * sunUp
    u.heat.value = P.postHeat.value * fade
    u.time.value = (performance.now() / 1000) % 1000
    // The shaft passes cost nothing while the sun is out of view: their stale contents are
    // multiplied by a sun visibility of 0, so they are simply not redrawn.
    const built = this.built!
    const sunLit = sunVis > 0.001
    if (built.maskTex) built.maskTex.autoUpdate = sunLit
    if (built.raysTex) built.raysTex.autoUpdate = sunLit && shaftAmount > 0
    this.setVolumetricCloudsActive(built.clouds)
    this.drewGraph = true
    try {
      if (this.cleanFrame || (built.glass && (!liquidSelected() || (level ?? 0) < 2))) built.pipeline.render()
      else {
        if (this.glass?.covered || !built.glass) built.pipeline.render()
        if (built.glass) this.glass!.render(built.glass, built.pipeline)
        else this.glass?.release('glass graph not prepared')
      }
      if (reusing) this.restoredTargets += built.targets.filter(target => target.width > 1 || target.height > 1).length
    } catch (error) {
      this.setVolumetricCloudsActive(false)
      throw error
    }
  }

  private bindScope(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const backend = renderer.backend
    const context = renderer.getContext?.()
    const device = (backend as { device?: unknown } | undefined)?.device
    const scope = this.scope
    const changed = !scope || scope.renderer !== renderer || scope.backend !== backend ||
      scope.context !== context || scope.device !== device || scope.scene !== scene || scope.camera !== camera
    const sky = !changed && this.sky?.parent === scene ? this.sky : findSky(scene)
    if (changed || sky !== this.sky) {
      if (scope) this.clearGraphs()
      if (this.sky && this.sky !== sky) this.sky.rays.strength.value = 0
      this.sky = sky
      this.scope = { renderer, backend, context, device, scene, camera }
      this.hasPrev = false
    }
  }

  private describeGraph(renderer: THREE.WebGPURenderer, scene: THREE.Scene, tier: PostTier, preset?: PostGraphPreset): GraphSpec {
    const effects = drawsEffects(tier)
    const value = <T extends ParamValue>(param: Param<T>) => postValue(param, preset)
    const glowOn = effects && value(P.postBloom) > 0
    const shaftsOn = effects && (value(P.postShafts) > 0 || value(P.postFlare) > 0)
    const flareOn = effects && value(P.postFlare) > 0
    const aoOn = effects && value(P.postAO) > 0
    const giOn = effects && value(P.postGI) > 0
    const clouds = this.sun.clouds
    const cloudsOn = effects && value(P.postClouds) > 0 && !!clouds && clouds.coverage > 0 && clouds.density > 0 && clouds.atmosphere > 0
    const light = effects && value(P.postContact) > 0 ? findSun(scene) : null
    const glassOnly = !value(P.postOn) && !!this.glass && glassStyle.value === 0 && (preset?.level ?? this.host.quality.getQualityState?.().level ?? 0) >= 2
    const toneMap = glassOnly ? renderer.toneMapping : TONE_MAPS[Math.round(value(P.postToneMap))] ?? renderer.toneMapping
    const debug = Math.round(value(P.postDebug))
    const temporalOn = effects && value(P.postTemporal) && debug === 0
    // Motion blur and heat shimmer share one composite, built only if one is wanted.
    const motionOn = effects && value(P.postMotionBlur) > 0
    const composeOn = effects && (motionOn || value(P.postHeat) > 0)
    const historyKey = temporalOn ? ['world.curve', 'world.seed', 'terrain.kind', 'terrain.planetSize', 'camera.mode'].map(id => preset?.value(id) ?? params.get(id)?.value).join('|') : ''
    const key = `${glassOnly ? 'glass-only|' : ''}${debug}|${tier}|${motionOn}|${composeOn}|${glowOn}|${shaftsOn}|${flareOn}|${aoOn}|${giOn}|${cloudsOn}|${temporalOn}|${historyKey}|${light?.uuid ?? ''}|${toneMap}|${renderer.outputColorSpace}`
    return { glassOnly, key, tier, glowOn, shaftsOn, flareOn, aoOn, light, toneMap, debug, giOn, cloudsOn, temporalOn, motionOn, composeOn }
  }

  /** The lobby may have drawn this preset before the covered glass warm-up. */
  private preparesGlass(): boolean {
    const level = this.warmPreset?.level ?? this.host.quality.getQualityState?.().level
    return !!this.glass && glassStyle.value === 0 && (level ?? 2) >= 2 && (!!this.warmPreset || this.glass.covered)
  }

  private needsCoveredGlass(graph: Built, spec: GraphSpec): boolean {
    return this.preparesGlass() && !spec.debug && !graph.glass
  }

  /** Return whether this frame is reactivating previously parked targets. */
  private activateGraph(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, spec: GraphSpec): boolean {
    if (this.built?.key === spec.key && !this.needsCoveredGlass(this.built, spec)) return false
    const previous = this.built
    const hit = this.standby.get(spec.key)
    if (hit && this.needsCoveredGlass(hit, spec)) this.evict(hit)
    else if (hit) {
      this.standby.delete(spec.key)
      this.built = hit
      this.activations++
      if (previous) this.retire(previous, spec.tier)
      return true
    }
    this.built = null
    if (previous?.key === spec.key) this.disposeGraph(previous)
    else if (previous) this.retire(previous, spec.tier)
    this.built = this.build(renderer, scene, camera, spec)
    return false
  }

  private renderCovered(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, preset: PostGraphPreset): void {
    const clouds = this.volumetricCloudsActive
    const tier = this.coveredTier(preset)
    if (tier === 'off') {
      this.rememberPreset(preset.level, 'off')
      try {
        this.setVolumetricCloudsActive(false)
        renderer.render(scene, camera)
        this.coveredDraws++
      } finally {
        this.setVolumetricCloudsActive(clouds)
      }
      return
    }

    const spec = this.describeGraph(renderer, scene, tier, preset)
    this.rememberPreset(preset.level, spec.key, preset.shed)
    this.pruneStandby()
    const active = this.built?.key === spec.key
    let graph = active ? this.built! : this.standby.get(spec.key)
    if (graph && this.needsCoveredGlass(graph, spec)) {
      const previous = graph
      graph = this.build(renderer, scene, camera, spec)
      if (active) this.built = graph
      else this.standby.delete(previous.key)
      this.disposeGraph(previous)
    } else if (!graph) {
      this.makeStandbyRoom()
      graph = this.build(renderer, scene, camera, spec)
    }
    const perspective = camera as THREE.PerspectiveCamera
    const cameraView = graph.temporalNode ? {
      aspect: perspective.aspect,
      view: perspective.view && { ...perspective.view },
      projection: perspective.projectionMatrix.clone(),
      inverse: perspective.projectionMatrixInverse.clone(),
    } : null
    const { toneMapping, outputColorSpace } = renderer
    const xrEnabled = renderer.xr?.enabled
    const maskUpdate = graph.maskTex?.autoUpdate
    const raysUpdate = graph.raysTex?.autoUpdate
    if (graph.maskTex) graph.maskTex.autoUpdate = true
    if (graph.raysTex) graph.raysTex.autoUpdate = true
    let drew = false
    try {
      this.setVolumetricCloudsActive(graph.clouds)
      graph.pipeline.render()
      if (graph.glass) this.glass!.render(graph.glass, graph.pipeline, true)
      this.coveredDraws++
      drew = true
    } finally {
      // A thrown render can bypass Three's pipeline cleanup. Even a successful TRAA
      // draw changes the camera's view offset while jittering the covered frame.
      renderer.toneMapping = toneMapping
      renderer.outputColorSpace = outputColorSpace
      if (xrEnabled !== undefined) renderer.xr.enabled = xrEnabled
      if (cameraView) {
        perspective.view = cameraView.view
        perspective.aspect = cameraView.aspect
        perspective.projectionMatrix.copy(cameraView.projection)
        perspective.projectionMatrixInverse.copy(cameraView.inverse)
      }
      this.setVolumetricCloudsActive(clouds)
      if (graph.maskTex) graph.maskTex.autoUpdate = maskUpdate
      if (graph.raysTex) graph.raysTex.autoUpdate = raysUpdate
      if (active) {
        // A same-graph draw can contain parked actors. Discard its history before gameplay.
        if (graph.temporalNode) { graph.temporalNode.setSize(1, 1); this.historyResets++ }
      } else if (drew && this.isNeighborKey(graph.key)) {
        this.park(graph)
      } else {
        this.standby.delete(graph.key)
        this.disposeGraph(graph)
      }
    }
  }

  private coveredTier(preset: PostGraphPreset): PostTier {
    if (this.glass && glassStyle.value === 0 && preset.level >= 2 && !postValue(P.postOn, preset)) return 'base'
    return postTier({ on: postValue(P.postOn, preset), tier: preset.tier, shed: preset.shed ? 1 : 0 })
  }

  private rememberPreset(level: QualityLevel | undefined, key: string, shed = false): void {
    if (shed) this.shedKey = key
    else if (level !== undefined) this.presetKeys.set(level, key)
  }

  private pruneStandby(level = this.host.quality.getQualityState?.().level): void {
    if (level === undefined) return
    for (const [candidate, key] of this.presetKeys) {
      if (level > 3 && candidate < level - 1) {
        this.presetKeys.delete(candidate)
        continue
      }
      // Minimal bypasses post. Keep Low’s next graph parked across that bypass
      // so the return through Low to Medium reuses its shafts and composite.
      if (candidate <= Math.max(level, 1) + 1) continue
      // A covered glass graph can restore its surfaces when quality climbs.
      // Park it under the same target budget and context lifetime.
      const graph = this.built?.key === key ? this.built : this.standby.get(key)
      if (!graph?.glass) this.presetKeys.delete(candidate)
    }
    for (const graph of this.standby.values()) {
      if (!this.isNeighborKey(graph.key)) this.evict(graph)
    }
  }

  private isNeighborKey(key: string): boolean {
    if (key === this.shedKey) return true
    for (const known of this.presetKeys.values()) if (known === key) return true
    return false
  }

  private retire(graph: Built, nextTier?: PostTier): void {
    const known = this.host.quality.getQualityState?.()
    if (known ? this.isNeighborKey(graph.key) : graph.tier === 'lite' && nextTier === 'lite') this.park(graph)
    else this.disposeGraph(graph)
  }

  private makeStandbyRoom(): void {
    if (this.standby.size < MAX_STANDBY_GRAPHS) return
    const oldest = this.standby.values().next().value
    if (oldest) this.evict(oldest)
  }

  private evict(graph: Built): void {
    this.standby.delete(graph.key)
    this.disposeGraph(graph)
  }

  private park(graph: Built): void {
    // Three's render context keys include attachment formats and MRT identity, not dimensions.
    // Shrinking releases full-size backing storage and makes TRAA seed fresh on the next draw.
    graph.glass?.blur?.update(1, 1, false)
    for (const target of graph.targets) target.setSize(1, 1)
    this.standby.delete(graph.key)
    this.makeStandbyRoom()
    this.standby.set(graph.key, graph)
  }

  private disposeGraph(graph: Built): void {
    graph.pipeline.dispose()
    for (const node of graph.disposables) node.dispose?.()
  }

  private setVolumetricCloudsActive(active: boolean): void {
    this.sun.setVolumetricCloudsActive?.(active)
    this.volumetricCloudsActive = active
  }

  /** Free both graphs and their targets. Safe to repeat. */
  release(): void {
    this.generation++
    this.clearGraphs()
  }

  private clearGraphs(): void {
    this.glass?.release()
    this.setVolumetricCloudsActive(false)
    if (this.built) this.disposeGraph(this.built)
    for (const graph of this.standby.values()) this.disposeGraph(graph)
    this.built = null
    this.standby.clear()
    this.presetKeys.clear()
    this.shedKey = undefined
  }

  dispose(): void {
    this.glass?.dispose()
    this.disposed = true
    this.release()
    this.scope = null
    this.reportActive(false)
    // The sky's cheap rays follow this chain's settings; without it they stop.
    if (this.sky) this.sky.rays.strength.value = 0
    this.sky = null
  }

  private active = false
  private reportActive(on: boolean): void {
    if (on === this.active) return
    this.active = on
    this.host.quality.setPostActive?.(on)
  }

  /**
   * Camera matrices for rebuilding positions from depth, and last frame's for motion blur.
   * A jump (teleport, seam crossing, respawn) or a pause skips one frame of blur.
   */
  private updateCamera(camera: THREE.PerspectiveCamera, blur: number): void {
    const u = this.u
    camera.updateMatrixWorld()
    ;(u.projInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(u.camWorld.value as THREE.Matrix4).copy(camera.matrixWorld)
    ;(u.camPos.value as THREE.Vector3).copy(camera.position)
    const now = performance.now()
    const dt = (now - this.lastAt) / 1000
    this.lastAt = now
    const jumped = !this.hasPrev || dt > 0.25 || this.prevPos.distanceTo(camera.position) > 40 || Math.abs(this.prevOrientation.dot(camera.quaternion)) < 0.9
    if (jumped && this.built?.temporalNode) { this.built.temporalNode.setSize(1, 1); this.historyResets++ }
    this.prevOrientation.copy(camera.quaternion)
    if (jumped) { this.prevView.copy(camera.matrixWorldInverse); this.prevProj.copy(camera.projectionMatrix) }
    ;(u.prevView.value as THREE.Matrix4).copy(this.prevView)
    ;(u.prevProj.value as THREE.Matrix4).copy(this.prevProj)
    // Shutter as a share of one 60 Hz frame, so the look does not change with frame rate.
    u.motionAmount.value = jumped ? 0 : blur * Math.min(2, (1 / 60) / Math.max(1e-3, dt))
    u.motionNear.value = P.postMotionNear.value
    this.prevView.copy(camera.matrixWorldInverse)
    this.prevProj.copy(camera.projectionMatrix)
    this.prevPos.copy(camera.position)
    this.hasPrev = true
  }


  /**
   * The burst's frame in the world: two axes square to the sun, so the streaks stay put as the
   * camera turns or rolls. Its drift runs on the wall clock and its phase on the world seed,
   * so every player in a room sees the same burst; reduced motion stops the drift. The sky's
   * cheap rays get the same frame and `skyStrength`.
   */
  private updateBurst(camera: THREE.Camera, skyStrength: number): void {
    const sun = this.sun.sunDirection
    if (!this.reducedMotion?.matches || this.burstClock === 0) this.burstClock = Date.now() / 1000
    const seed = Number(params.get('world.seed')?.value ?? 0)
    // Longer streaks as the sun drops toward the horizon.
    const reach = burstReach(sun.y, P.postRayLength.value * Math.PI / 180)
    const share = rayGlowShare(sun.y, P.postRayHighSun.value)
    writeBurstFrame(this.burst, sun, seed, this.burstClock, P.postShaftContrast.value, reach)
    this.u.rayShare.value = share
    this.u.rayFill.value = P.postRayFill.value
    const sky = this.sky
    if (sky) {
      writeBurstFrame(sky.rays.burst, sun, seed, this.burstClock, P.postShaftContrast.value, reach)
      sky.rays.share.value = share
      sky.rays.fill.value = P.postRayFill.value
      sky.rays.strength.value = skyStrength
      sky.raysCamera = camera
    }
  }

  /** Sun position on screen (top-left origin, as the post quad's uv) and its visibility. */
  private updateSun(camera: THREE.Camera, renderer: THREE.WebGPURenderer): number {
    const sun = this.sun.sunDirection
    const cam = camera as THREE.PerspectiveCamera
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.u.aspect.value = size.y > 0 ? size.x / size.y : 16 / 9
    camera.getWorldDirection(this.forward)
    const inFront = this.forward.dot(sun) > 0.02
    this.tmp.copy(sun).multiplyScalar(Math.min(1000, (cam.far ?? 2000) * 0.5)).add(camera.position).project(camera)
    const su = this.tmp.x * 0.5 + 0.5
    const sv = 0.5 - this.tmp.y * 0.5
    ;(this.u.sunUv.value as THREE.Vector2).set(su, sv)
    this.screenFade = sunScreenFade(su, sv, inFront)
    return this.screenFade * sunHeightFactor(sun.y, P.postLowSun.value)
  }

  private build(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, spec: GraphSpec): Built {
    const start = longFrames.start()
    try { return this.buildGraph(renderer, scene, camera, spec) }
    finally { longFrames.end('Post chain rebuild', start) }
  }

  private buildGraph(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, spec: GraphSpec): Built {
    const { key, tier, glowOn, shaftsOn, flareOn, aoOn, light, toneMap, debug, giOn, cloudsOn, temporalOn, motionOn, composeOn } = spec
    const u = this.u as Record<keyof PostChain['u'], N>
    const disposables: Built['disposables'] = []
    let maskRef: N = null
    let raysRef: N = null
    // The volumetric cloud layer when it runs (its alpha is cover), for the shaft mask.
    let cloudCover: N = null
    const scenePass = pass(scene, camera, temporalOn ? { samples: 0 } : {})
    const velocity = temporalOn ? new CurvedVelocity() : null
    if (velocity) scenePass.setMRT(mrt({ output, velocity: nodeObject(velocity) }))
    disposables.push(scenePass as never)
    let color: N = scenePass.getTextureNode('output')
    const depth: N = scenePass.getTextureNode('depth')
    let temporalNode: N = null
    if (temporalOn) {
      temporalNode = traa(color, depth, scenePass.getTextureNode('velocity'), camera)
      color = temporalNode.getTextureNode()
      disposables.push(temporalNode)
    }
    const hot: N = u.bloomThreshold.mul(HOT_CLAMP)

    // AO belongs in indirect lighting, before direct light, emissive and fog are added.
    // Keep prepass lighting separate and disabled: otherwise the normals pass updates the
    // sun's shadow maps before the beauty pass and can poison the nearest cascade.
    let aoNode: N = null
    let sssNode: N = null
    let giNode: N = null
    let contactTex: N = null
    let prePass: ReturnType<typeof pass> | null = null
    if (aoOn || light || giOn) {
      prePass = pass(scene, camera, temporalOn ? { samples: 0 } : {})
      prePass.name = giOn ? 'Indirect light source' : 'Occlusion normals and depth'
      prePass.transparent = false
      prePass.setMRT(giOn ? mrt({ output, normal: normalView }) : mrt({ output: normalView }))
      // The source pass must never inherit the final pass's screen-space lighting:
      // that would feed its own GI/contact textures back into their input.
      prePass.contextNode = context({ getAO: () => null, getGI: () => null, getShadow: ({ shadowColorNode }: N) => shadowColorNode })
      if (!giOn) {
        const unlit = new THREE.Lighting()
        unlit.enabled = false
        prePass.lighting = unlit
        disposables.push(unlit)
      }
      disposables.push(prePass as never)
    }
    const normals: N = prePass?.getTextureNode(giOn ? 'normal' : 'output')
    if (aoOn) {
      aoNode = ao(prePass!.getTextureNode('depth'), normals, camera)
      aoNode.resolutionScale = 0.5
      aoNode.samples.value = 12
      disposables.push(aoNode)
      scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r)
    }
    if (giOn) {
      const sourceDepth: N = prePass!.getTextureNode('depth')
      giNode = ssgi(prePass!.getTextureNode('output'), sourceDepth, normals, camera as THREE.PerspectiveCamera)
      // Fixed sampling and a depth/normal-aware spatial filter work without temporal
      // history. Only visible surfaces contribute; the existing sky/ground fill remains.
      giNode.useTemporalFiltering = false
      giNode.resolutionScale = 0.5
      giNode.sliceCount.value = 2
      giNode.stepCount.value = 6
      const filter = denoise(giNode.getGINode(), sourceDepth, normals, camera)
      filter.radius.value = 3
      const filtered: N = rtt(filter)
      disposables.push(giNode, filter, filtered)
      const occlusion: N = aoNode ? aoNode.getTextureNode().sample(screenUV).r : float(1)
      scenePass.contextNode = builtinGIContext(occlusion, filtered.sample(screenUV).rgb)
    }
    if (light) {
      sssNode = sss(prePass!.getTextureNode('depth'), camera, light)
      sssNode.resolutionScale = 0.5
      sssNode.maxDistance.value = 0.5
      sssNode.thickness.value = 0.12
      sssNode.quality.value = 0.5
      disposables.push(sssNode)
      // The raw march speckles open ground (depth precision where each ray starts). A 3x3
      // blur three pixels apart, then a remap: scattered specks average near white and
      // go back to 1; a real contact shadow, solid under a tyre, stays dark.
      const raw: N = sssNode.getTextureNode()
      const blurAt = Fn(() => {
        const p = screenUV
        const px = vec2(3, 3).div(screenSize)
        const sum = float(0).toVar()
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) sum.addAssign(raw.sample(p.add(px.mul(vec2(x, y)))).r)
        return smoothstep(0.45, 0.85, sum.div(9))
      })
      const contact = blurAt()
      contactTex = contact
      // Apply contact occlusion only to this light. Ambient fill, headlights, emissive
      // lava and atmospheric fog must not be darkened by the sun's contact shadows.
      scenePass.contextNode = context({
        ...(scenePass.contextNode?.value as object | undefined),
        ...(builtinShadowContext(mix(float(1), contact, 0.6), light).value as object),
      })
    }

    if (cloudsOn) {
      const volume: N = cloudVolume(depth, u, this.sun as SunSource & { clouds: CloudInputs })
      cloudCover = volume
      // Capture the scene camera, not the fullscreen pass camera used by the composite.
      // Surface crossings update only this uniform and preserve the pipeline graph.
      const visibility = uniform(1).setGroup(renderGroup).onRenderUpdate(() => 1 - underwaterAmountForCamera(camera))
      const composite: N = compositeClouds(color, volume, depth, u.projInv, visibility)
      disposables.push(volume, composite)
      color = composite
    }

    // The scene colour as the eye sees it this frame: heat shimmer bends where it reads from,
    // camera motion blur smears it. A vehicle touching or going into a liquid never blurs or
    // tints the frame: only the camera itself crossing a surface changes the picture, and that
    // is the scene fog's job (src/world/water/underwater.ts), not a screen effect.
    const base = Fn(() => {
      const p = uv().toVar()
      // Heat shimmer: air above glowing lava bends. Look a little below this pixel on screen
      // (uv grows downward); if that is lava-hot (bright and orange, so white headlights do
      // not count), wobble where this pixel reads from. One extra tap; strength follows heat.
      If(u.heat.greaterThan(0.001), () => {
        const below = color.sample(p.add(vec2(0, 0.025))).rgb.mul(u.exposure)
        const orange = smoothstep(0.25, 0.6, below.r.sub(below.b).div(below.r.add(0.001)))
        const hot = smoothstep(0.6, 2.2, below.r).mul(orange)
        const t = u.time
        const wob = vec2(sin(p.y.mul(170).add(t.mul(7.3))).add(sin(p.y.mul(97).sub(t.mul(4.1))).mul(0.6)), sin(p.x.mul(130).add(t.mul(5.7))))
        p.addAssign(wob.mul(hot).mul(u.heat).mul(0.0011))
      })
      const c = (motionOn ? motionBlurred(color, depth, p, { projInv: u.projInv, camWorld: u.camWorld, prevView: u.prevView, prevProj: u.prevProj, amount: u.motionAmount, nearFade: u.motionNear, maxBlur: u.motionMax }) : color.sample(p).rgb).toVar()
      return c
    })
    let hdr: N = composeOn ? base() : color.rgb

    if (glowOn) {
      // Geometry only: open sky (depth at the far plane) never feeds the glow. Facing a low
      // sun, the sky round it is past any useful threshold and bloomed into a white-out over
      // the whole frame; the sun's own light is the shafts' and the flare's job.
      const solid = float(1).sub(step(0.99995, depth.r))
      const exposed = min(color.rgb.mul(u.exposure), vec3(hot)).mul(solid)
      const glow: N = bloom(vec4(exposed, 1), u.bloom, u.bloomRadius, u.bloomThreshold)
      disposables.push(glow)
      hdr = hdr.add(glow.rgb.div(u.exposure))
    }

    if (shaftsOn) {
      // Clouds block the sun as terrain does: the volumetric layer's cover when it runs,
      // otherwise the sky shader's own cloud field.
      const skyClouds = (this.sun as SunSource).clouds
      const cloudNode = <T,>(initial: T, read: () => T) => (uniform(initial as never) as N).setGroup(renderGroup).onRenderUpdate(read)
      const skyCloud = skyClouds ? {
        coverage: cloudNode(0, () => cloudCover ? 0 : skyClouds.coverage), density: cloudNode(0, () => skyClouds.density),
        scale: cloudNode(0, () => skyClouds.scale), elevation: cloudNode(0, () => skyClouds.elevation), speed: cloudNode(0, () => skyClouds.speed),
        offset: uniform(new THREE.Vector2()).setGroup(renderGroup).onRenderUpdate((_f, self) => { self.value.set(skyClouds.offset.x, skyClouds.offset.y) }),
      } : null
      const volumeCover = cloudCover
      const sky = this.sky
      // Mask: rgb is the low sun's forward glow toward this pixel (AlienSkyMesh.skyScatter),
      // alpha how open the path is here: open sky, less any cloud. Terrain, vehicles and
      // smoke are 0.
      const mask = Fn(() => {
        const p = uv()
        const open = smoothstep(0.99995, 1.0, depth.sample(p).r).toVar()
        const view = getViewPosition(p, float(1), u.projInv)
        const direction = u.camWorld.mul(vec4(view.normalize(), 0)).xyz.normalize()
        // Cloud that looks solid blocks the sun outright; only thin edges let some through.
        const cloud = volumeCover ? volumeCover.sample(p).a : skyCloud ? skyCloudField(direction, skyCloud).opacity : float(0)
        open.mulAssign(float(1).sub(smoothstep(CLOUD_THIN, CLOUD_SOLID, cloud)))
        const glow = sky ? rayLight(skyScatter(direction, sky, false), u.rayShare, u.rayFill) : vec3(0)
        return vec4(glow, open)
      })
      // Half resolution on the full tier keeps narrow beams; a quarter elsewhere.
      const maskTex: N = rtt(mask(), null, null, { resolutionScale: tier === 'full' ? 0.5 : 0.25, type: THREE.HalfFloatType })
      disposables.push(maskTex)
      maskRef = maskTex
      const taps = shaftTaps(tier)
      // How open the way to the sun is, judged near the sun: the march averages the mask's
      // alpha weighted toward the sun's end, where the light comes from, so every pixel on a
      // line out from the sun shares the gap or cloud it passed through. That is a beam.
      const rays = Fn(() => {
        const p = uv().toVar()
        const step = u.sunUv.sub(p).mul(u.shaftLength).div(taps)
        p.addAssign(step.mul(interleavedGradientNoise(screenCoordinate)))
        const sum = float(0).toVar()
        const squares = float(0).toVar()
        const total = float(1e-4).toVar()
        Loop(taps, () => {
          const fromSun = length(p.sub(u.sunUv).mul(vec2(u.aspect, 1)))
          const w = exp(fromSun.div(u.shaftReach).negate())
          const a = maskTex.sample(p).a
          sum.addAssign(a.mul(w))
          squares.addAssign(a.mul(a).mul(w))
          total.addAssign(w)
          p.addAssign(step)
        })
        // Squared: a path half blocked passes a quarter, so beams keep their edges; a clear
        // path is still 1, so open sky still balances.
        const open = sum.div(total)
        // How mixed the way is, from the same taps: their weighted variance, 0 when all open or
        // all shut, a quarter when half and half. Scaled to 0..1 in g. An edge on the way to the
        // sun (a ridge, a gap in cloud) is where a beam belongs.
        const edged = clamp(squares.div(total).sub(open.mul(open)).mul(4), 0, 1)
        return vec4(open.mul(open), edged, 0, 1)
      })
      const raysTex: N = rtt(rays(), null, null, { resolutionScale: tier === 'full' ? 0.5 : 0.25 })
      disposables.push(raysTex)
      raysRef = raysTex
      // The burst: the streak pattern round the sun, fixed in the world (burstAcross and
      // burstUp span the plane square to the sun), mean 1. It moves the glow up in bright
      // streaks and down in dark ones, as far as the way to the sun is open, so where it is
      // shut the sky is as drawn. In front of cloud or distant terrain a share of it shows (the
      // haze lit between them and the eye); near things such as the vehicle get none.
      const at = uv()
      const here = maskTex.sample(at)
      const d = depth.r
      const solid = float(1).sub(step(0.99995, d))
      const view = getViewPosition(at, d, u.projInv)
      const distance = view.length()
      const ray = u.camWorld.mul(vec4(view.normalize(), 0)).xyz.normalize()
      // Two octaves at every tier: the third's fine streaks read as hard spokes.
      const pattern = burstSwing(ray, this.burst, 2)
      const haze = u.shaftHaze.mul(mix(float(1), float(1).sub(exp(distance.div(-SHAFT_HAZE_DEPTH))), solid))
      // The mask is coarser than the screen: at a ridge its openness bleeds onto the terrain
      // pixels next to the sky. Solid pixels take only the haze share, never the mask's own.
      // Open sky keeps RAY_SKY_FLOOR of the burst even where the march finds the way shut, so a
      // sun just behind a ridge still throws rays past it; the march shapes the rest into beams.
      // A small cross blur at the rays target's own texel size hides the march's dither, which
      // otherwise shows as a fixed screen-door pattern over the sky as the camera moves.
      const texel = vec2(1, 1).div(screenSize.mul(tier === 'full' ? 0.5 : 0.25))
      const blurred = raysTex.sample(at).mul(0.4)
        .add(raysTex.sample(at.add(texel.mul(vec2(1.5, 0)))).mul(0.15)).add(raysTex.sample(at.sub(texel.mul(vec2(1.5, 0)))).mul(0.15))
        .add(raysTex.sample(at.add(texel.mul(vec2(0, 1.5)))).mul(0.15)).add(raysTex.sample(at.sub(texel.mul(vec2(0, 1.5)))).mul(0.15))
      const marched = blurred.r
      // Beams through gaps and past edges are stronger and crisper; open sky keeps the shipped
      // burst (post.gapShafts, post.gapContrast).
      const gap = mix(float(1), u.gapGain, smoothstep(0.05, 0.5, blurred.g))
      const skyOpen = here.a.mul(float(1).sub(solid))
      const open = mix(marched.mul(haze), max(marched, float(RAY_SKY_FLOOR)), skyOpen)
      // Over terrain a streak may at most double the pixel's own light; anywhere it removes at
      // most RAY_DARK of the light it carries.
      const swing = clamp(pattern.mul(open).mul(u.shafts).mul(gap), -RAY_DARK, mix(float(1e4), float(1), solid))
      // Bright streaks in open sky add the glow, the approved look. Anywhere else (every dark
      // streak, and bright ones over terrain) the streak scales the pixel by up to the glow's
      // share of its light. That keeps the pixel's own hue: subtracting the sky's glow from
      // terrain, which holds far less light, drove channels negative and the tone mapper
      // turned them into cyan and red teeth along sunlit ridges (v26.11.1701).
      const lumWeights = vec3(0.2126, 0.7152, 0.0722)
      const share = min(dot(here.rgb, lumWeights).div(max(dot(hdr, lumWeights), 1e-6)), 1)
      const additive = step(0, swing).mul(float(1).sub(solid))
      const moved = mix(hdr.mul(swing.mul(share)), here.rgb.mul(swing), additive)
      // No channel reaches the tone mapper below zero.
      hdr = max(hdr.add(moved), vec3(0))

      if (flareOn) {
        const flare = Fn(() => {
          const p = uv()
          const o = vec2(0.004, 0.006)
          // The sun's own light through the mask: the volcano or a vehicle in front eclipses it.
          const seen = maskTex.sample(u.sunUv).a
            .add(maskTex.sample(u.sunUv.add(o)).a).add(maskTex.sample(u.sunUv.sub(o)).a)
            .add(maskTex.sample(u.sunUv.add(vec2(o.y, o.x.negate()))).a).add(maskTex.sample(u.sunUv.sub(vec2(o.y, o.x.negate()))).a)
            .mul(0.2)
          const sunLight = min(color.sample(u.sunUv).rgb.mul(u.exposure), vec3(SHAFT_CLAMP)).mul(seen)
          const toSun = p.sub(u.sunUv).mul(vec2(u.aspect, 1))
          // Anamorphic streak: thin and long, a little blue, as a coated lens gives.
          const streak = exp(abs(toSun.y).mul(-140)).mul(exp(abs(toSun.x).mul(-2.4)))
          const view = p.sub(0.5).mul(vec2(u.aspect, 1))
          const sunView = u.sunUv.sub(0.5).mul(vec2(u.aspect, 1))
          const gA = float(1).sub(smoothstep(0.035, 0.05, length(view.sub(sunView.mul(0.45)))))
          const gB = float(1).sub(smoothstep(0.012, 0.022, length(view.add(sunView.mul(0.25)))))
          const ringD = length(view.add(sunView.mul(0.8)))
          const gC = float(1).sub(smoothstep(0.07, 0.09, ringD)).mul(smoothstep(0.045, 0.07, ringD))
          const ghosts = vec3(0.4, 0.7, 1.0).mul(gA).mul(0.07).add(vec3(1.0, 0.6, 0.3).mul(gB).mul(0.12)).add(vec3(0.6, 1.0, 0.8).mul(gC).mul(0.02))
          const tint = vec3(0.75, 0.88, 1.0)
          return sunLight.mul(tint.mul(streak).mul(0.35).add(ghosts.mul(2.2)))
        })
        hdr = hdr.add(flare().mul(u.flare).mul(u.sunVis).div(u.exposure))
      }
    }

    // Tone map and convert as renderer.render would, then grade the display values.
    const mapped: N = renderOutput(vec4(hdr, 1), toneMap, renderer.outputColorSpace)
    const graded = Fn(() => {
      const p = uv()
      const c = clamp(mapped.rgb, 0, 1).mul(u.gain).toVar()
      const inv = float(1).sub(c)
      c.addAssign(u.lift.mul(inv).mul(inv))
      const s = c.mul(c).mul(float(3).sub(c.mul(2)))
      c.assign(mix(c, s, u.contrast))
      const lum = dot(c, vec3(0.2126, 0.7152, 0.0722))
      c.assign(mix(vec3(lum), c, u.saturation))
      const q = p.sub(0.5).mul(vec2(max(u.aspect, 1).mul(0.62), 1))
      c.mulAssign(float(1).sub(u.vignette.mul(smoothstep(0.32, 0.9, length(q)))))
      // Grain: a dither everywhere (no banding in the sky) and a little more in the midtones.
      const n = interleavedGradientNoise(screenCoordinate.add(vec2(u.seed, u.seed.mul(0.37)))).sub(0.5)
      const mid = clamp(lum.mul(float(1).sub(lum)).mul(4), 0, 1)
      c.addAssign(n.mul(u.grain).mul(float(1.5 / 255).add(mid.mul(0.035))))
      return vec4(c, 1)
    })

    let out: N = spec.glassOnly ? mapped : graded()
    const glass = this.glass && this.preparesGlass() && !debug
      ? this.glass.build(out, color, renderer, toneMap, velocity, temporalNode, scenePass, disposables) : undefined
    // Debug views: the raw occlusion or contact shadow buffers, white is unoccluded.
    if (debug === 1 && aoNode) out = vec4(vec3(aoNode.getTextureNode().sample(uv()).r), 1)
    if (debug === 2 && contactTex) out = vec4(vec3(contactTex), 1)
    if (debug === 3 && raysRef) out = vec4(raysRef.sample(uv()).r, maskRef.sample(uv()).a, 0, 1)
    const pipeline = new THREE.RenderPipeline(renderer, velocity ? out.context({ velocity }) : out)
    pipeline.outputColorTransform = false
    this.builds++
    return { key, tier, pipeline, glass, disposables, targets: ownedTargets([...disposables, ...(glass?.blur?.passes ?? [])]), maskTex: maskRef, raysTex: raysRef, aoNode, sssNode, giNode, temporalNode, clouds: cloudsOn, scenePass: scenePass as never }
  }
}

/** Three's pass nodes own their targets directly, including Bloom's arrays of mip targets. */
function ownedTargets(nodes: Built['disposables']): THREE.RenderTarget[] {
  const targets = new Set<THREE.RenderTarget>()
  for (const node of nodes) {
    for (const field of Object.values(node)) {
      if (field instanceof THREE.RenderTarget) targets.add(field)
      else if (Array.isArray(field)) {
        for (const entry of field) if (entry instanceof THREE.RenderTarget) targets.add(entry)
      }
    }
  }
  return [...targets]
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function findSky(scene: THREE.Scene): AlienSkyMesh | null {
  for (const child of scene.children) if (child instanceof AlienSkyMesh) return child
  return null
}

/** The shadow-casting directional light (sun by day, moon by night), if any. */
function findSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  for (const child of scene.children) {
    const light = child as THREE.DirectionalLight
    if (light.isDirectionalLight && light.castShadow) return light
  }
  return null
}

/** Build the chain for this game. Register it with `game.setPostChain`. */
export function createPostChain(host: PostChainHost, sun: SunSource): PostChain {
  return new PostChain(host, sun)
}
