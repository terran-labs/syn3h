/**
 * The in-game post chain: what turns the rendered world into the picture.
 *
 * Registered with `game.setPostChain(chain)`; Game then hands each frame to `render` instead
 * of calling `renderer.render` itself. When the gate says off (post effects switched off,
 * graphics level 0, or a phone or tablet not opted in) `render` is exactly
 * `renderer.render(scene, camera)` and no pipeline or render target exists.
 *
 * One pipeline, rebuilt only when its shape changes (tier, or an effect taken to or from 0):
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
import { composeGlass } from '../../liquid-glass/compose'
import { GlassButton } from './GlassButton'
import { CurvedVelocity } from './CurvedVelocity'
import { cloudVolume, compositeClouds } from './clouds'
import { AlienSkyMesh, rayLight, skyCloudField, skyScatter } from '../../world/sky/AlienSkyMesh'
import { BURST_CORE, RAY_DARK, burstReach, burstSwing, createBurstUniforms, writeBurstFrame } from './sunburst'
import { rayGlowShare } from '../../world/sky/skyMath'
import { underwaterAmountForCamera } from '../../world/water/underwater'
import type { CloudInputs } from '../../world/Environment'
import { motionBlurred } from './motion'
import { params } from '../../../shared/params'
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

export interface PostChainHost {
  /**
   * The frame governor (src/core/quality.ts), the one in-game quality authority.
   * postTier: the tier the current quality level allows; absent reads as full, for
   * fixtures that drive the chain alone. postBudget: the governor's post budget, 0 to 1
   * eased, which only fades strengths; absent reads as a full budget. setPostActive tells
   * the governor whether there is anything to shed, so its post rung exists only while the
   * chain draws a costly effect.
   */
  readonly quality: { readonly postTier?: PostTier; readonly postBudget?: number; setPostActive?(on: boolean): void }
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

interface Built {
  key: string
  /** Quarter resolution shaft targets: skipped entirely while the sun is out of view. */
  maskTex: N | null
  raysTex: N | null
  /** Ambient occlusion and contact shadow nodes, for their live settings. */
  aoNode: N | null
  sssNode: N | null
  giNode: N | null
  temporalNode: N | null
  clouds: boolean
  pipeline: THREE.RenderPipeline
  disposables: Array<{ dispose?(): void; renderTarget?: { dispose(): void } }>
}

export class PostChain {
  private built: Built | null = null
  /** Times a pipeline has been built, for checks. */
  builds = 0
  /** Camera discontinuities that discarded temporal history, for diagnostics. */
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
    glassMaterial: uniform(new THREE.Vector4()),
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

  private covered = false
  private glass: GlassButton | null = null
  private glassBuilt = false
  private readonly glassMode = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('glass')
  setCovered(covered: boolean): void { this.covered = covered }

  constructor(private readonly host: PostChainHost, private readonly sun: SunSource) {}

  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, _frameMs?: number): void {
    const budget = this.host.quality.postBudget
    const shed = 1 - Math.min(1, Math.max(0, budget ?? 1))
    const tier = postTier({ on: P.postOn.value, tier: this.host.quality.postTier ?? 'full', shed })
    // The quality level owns which effects exist, through their strengths. Tier only
    // separates the look alone (base) from a chain that draws effects (lite, full).
    const effects = drawsEffects(tier)
    this.tier = tier
    // Anything the governor could shed: everything but the colour look itself. Sun rays count
    // only where the level draws them here; at Minimal and Low the sky draws its cheap form,
    // which nothing sheds.
    const levelEffects = drawsEffects(this.host.quality.postTier ?? 'full')
    this.reportActive(tier !== 'off' && (P.postTemporal.value || [P.postBloom, levelEffects ? P.postShafts : null, P.postFlare, P.postAO, P.postContact, P.postMotionBlur, P.postGI, P.postClouds].some(p => p && p.value > 0)))
    this.sky ??= findSky(scene)
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
      this.release()
      renderer.render(scene, camera)
      return
    }
    const glowOn = effects && P.postBloom.value > 0
    const shaftsOn = effects && (P.postShafts.value > 0 || P.postFlare.value > 0)
    const flareOn = effects && P.postFlare.value > 0
    const aoOn = effects && P.postAO.value > 0
    const giOn = effects && P.postGI.value > 0
    const clouds = this.sun.clouds
    const cloudsOn = effects && P.postClouds.value > 0 && !!clouds && clouds.coverage > 0 && clouds.density > 0 && clouds.atmosphere > 0
    const light = effects && P.postContact.value > 0 ? findSun(scene) : null
    const toneMap = TONE_MAPS[Math.round(P.postToneMap.value)] ?? renderer.toneMapping
    const debug = Math.round(P.postDebug.value)
    const temporalOn = effects && P.postTemporal.value && debug === 0
    // Motion blur and heat shimmer share one composite, built only if one is wanted.
    const motionOn = effects && P.postMotionBlur.value > 0
    const composeOn = effects && (motionOn || P.postHeat.value > 0)
    const historyKey = temporalOn ? ['world.curve', 'world.seed', 'terrain.kind', 'terrain.planetSize', 'camera.mode'].map(id => params.get(id)?.value).join('|') : ''
    const key = `${debug}|${tier}|${motionOn}|${composeOn}|${glowOn}|${shaftsOn}|${flareOn}|${aoOn}|${giOn}|${cloudsOn}|${temporalOn}|${historyKey}|${light?.uuid ?? ''}|${toneMap}|${renderer.outputColorSpace}`
    const warmGlass = this.covered && !debug && (this.glassMode === 'inline' || this.glassMode === 'target')
    if (this.built?.key !== key || (warmGlass && !this.glassBuilt)) this.build(renderer, scene, camera, key, tier, glowOn, shaftsOn, flareOn, aoOn, light, toneMap, debug, giOn, cloudsOn, temporalOn, motionOn, composeOn)

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
    this.sun.setVolumetricCloudsActive?.(built.clouds)
    try {
      if (this.glassBuilt) {
        u.glassMaterial.value.set(P.glassThickness.value, P.glassBevel.value, P.glassIndex.value, P.glassDispersion.value)
        this.glass?.update()
      }
      built.pipeline.render()
      if (this.glassBuilt) this.glass?.present()
    } catch (error) {
      this.sun.setVolumetricCloudsActive?.(false)
      throw error
    }
  }

  /** Free the pipeline and every target it made. Safe to repeat. */
  release(): void {
    this.glass?.hide()
    this.glassBuilt = false
    this.sun.setVolumetricCloudsActive?.(false)
    if (!this.built) return
    this.built.pipeline.dispose()
    for (const d of this.built.disposables) { d.dispose?.(); d.renderTarget?.dispose() }
    this.built = null
  }

  dispose(): void {
    this.glass?.dispose(); this.glass = null
    this.release(); this.reportActive(false)
    // The sky's cheap rays follow this chain's settings; without it they stop.
    if (this.sky) this.sky.rays.strength.value = 0
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

  private build(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, key: string, tier: PostTier, glowOn: boolean, shaftsOn: boolean, flareOn: boolean, aoOn: boolean, light: THREE.DirectionalLight | null, toneMap: THREE.ToneMapping, debug = 0, giOn = false, cloudsOn = false, temporalOn = false, motionOn = false, composeOn = false): void {
    this.release()
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
        const total = float(1e-4).toVar()
        Loop(taps, () => {
          const fromSun = length(p.sub(u.sunUv).mul(vec2(u.aspect, 1)))
          const w = exp(fromSun.div(u.shaftReach).negate())
          sum.addAssign(maskTex.sample(p).a.mul(w))
          total.addAssign(w)
          p.addAssign(step)
        })
        // Squared: a path half blocked passes a quarter, so beams keep their edges; a clear
        // path is still 1, so open sky still balances.
        const open = sum.div(total)
        return vec4(vec3(open.mul(open)), 1)
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
      const marched = raysTex.sample(at).r.mul(0.4)
        .add(raysTex.sample(at.add(texel.mul(vec2(1.5, 0)))).r.mul(0.15)).add(raysTex.sample(at.sub(texel.mul(vec2(1.5, 0)))).r.mul(0.15))
        .add(raysTex.sample(at.add(texel.mul(vec2(0, 1.5)))).r.mul(0.15)).add(raysTex.sample(at.sub(texel.mul(vec2(0, 1.5)))).r.mul(0.15))
      const skyOpen = here.a.mul(float(1).sub(solid))
      const open = mix(marched.mul(haze), max(marched, float(RAY_SKY_FLOOR)), skyOpen)
      // Over terrain a streak may at most double the pixel's own light; anywhere it removes at
      // most RAY_DARK of the light it carries.
      const swing = clamp(pattern.mul(open).mul(u.shafts), -RAY_DARK, mix(float(1e4), float(1), solid))
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

    let out: N = graded()
    if (this.covered && !debug && (this.glassMode === 'target' || this.glassMode === 'inline')) {
      const glass = this.glass ??= new GlassButton(renderer.domElement, new URLSearchParams(location.search).get('glassSet') === 'one' ? 1 : 6)
      const finished: N = this.glassMode === 'target' ? rtt(out, null, null, { type: THREE.HalfFloatType }) : null
      if (finished) disposables.push(finished)
      const original = finished ? finished.sample(uv()) : out
      const sample = (at: N) => {
        if (finished) return finished.sample(at).rgb
        const display = (coord: N) => renderOutput(vec4(color.sample(coord).rgb, 1), toneMap, renderer.outputColorSpace).rgb
        return original.rgb.add(display(at).sub(display(uv())))
      }
      out = composeGlass(original, sample, glass, u.glassMaterial)
      this.glassBuilt = true
    }
    // Debug views: the raw occlusion or contact shadow buffers, white is unoccluded.
    if (debug === 1 && aoNode) out = vec4(vec3(aoNode.getTextureNode().sample(uv()).r), 1)
    if (debug === 2 && contactTex) out = vec4(vec3(contactTex), 1)
    if (debug === 3 && raysRef) out = vec4(raysRef.sample(uv()).r, maskRef.sample(uv()).a, 0, 1)
    const pipeline = new THREE.RenderPipeline(renderer, velocity ? out.context({ velocity }) : out)
    pipeline.outputColorTransform = false
    this.built = { key, pipeline, disposables, maskTex: maskRef, raysTex: raysRef, aoNode, sssNode, giNode, temporalNode, clouds: cloudsOn }
    this.builds++
  }
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
