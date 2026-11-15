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
 *   sun shafts      quarter resolution, two passes. The mask keeps open sky (depth at the far
 *                   plane) near the sun, in the sky's own colour, so terrain, vehicles and
 *                   smoke dark against the sky all cut the light. A radial march toward the
 *                   sun then smears it into rays. 1/16 of the pixels, so 32 taps are cheap.
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
  builtinAOContext, builtinGIContext, builtinShadowContext, context, mrt, normalView, output, screenUV, renderOutput, rtt, screenCoordinate, smoothstep, step,  uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { sss } from 'three/addons/tsl/display/SSSNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { cloudVolume, compositeClouds } from './clouds'
import type { CloudInputs } from '../../world/Environment'
import { motionBlurred } from './motion'
import { graphicsLevel } from '../../core/quality'
import { params } from '../../../shared/params'
import { type PostTier, lowSunAmount, postTier, shaftTaps, sunHeightFactor, sunScreenFade } from './gate'
import { type Grade, gradeFor, lookForKind } from './looks'
import * as P from './params'

type N = any // TSL node

/** Brightest exposed value a pixel may feed into glow or shafts, as a multiple of the glow threshold. */
export const HOT_CLAMP = 2
/** Brightest exposed value the sun shaft mask keeps. */
export const SHAFT_CLAMP = 1.5

export interface PostChainHost {
  /**
   * The frame governor (src/core/quality.ts), the one in-game quality authority.
   * deviceLevel: the device class, 2 is desktop. postBudget: its post effects rung, 0 to 1
   * eased; absent until that lane adds it, which reads as a full budget. setPostActive tells
   * the governor whether there is anything to shed, so its post rung exists only while the
   * chain draws a costly effect.
   */
  readonly quality: { readonly deviceLevel: number; readonly postBudget?: number; setPostActive?(on: boolean): void }
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
/** The watched vehicle, for the plunge when it goes under a liquid surface. */
export interface PlungeSource { readonly liquidState: { readonly wasImmersed: boolean; readonly lavaDepth: number } }

/** Plunge tints: lava's hot amber and water's deep teal, in linear colour. */
const LAVA_TINT = new THREE.Vector3(1.0, 0.42, 0.12)
const WATER_TINT = new THREE.Vector3(0.12, 0.42, 0.5)

interface Built {
  key: string
  /** Quarter resolution shaft targets: skipped entirely while the sun is out of view. */
  maskTex: N | null
  raysTex: N | null
  /** Ambient occlusion and contact shadow nodes, for their live settings. */
  aoNode: N | null
  sssNode: N | null
  giNode: N | null
  clouds: boolean
  pipeline: THREE.RenderPipeline
  disposables: Array<{ dispose?(): void; renderTarget?: { dispose(): void } }>
}

export class PostChain {
  private built: Built | null = null
  /** Times a pipeline has been built, for checks. */
  builds = 0
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
    shaftReach: uniform(0.12),
    flare: uniform(0.5),
    gain: uniform(new THREE.Vector3(1, 1, 1)),
    lift: uniform(new THREE.Vector3(0, 0, 0)),
    contrast: uniform(0),
    saturation: uniform(1),
    vignette: uniform(0.3),
    grain: uniform(0.35),
    seed: uniform(0),
    plunge: uniform(0),
    heat: uniform(0.6),
    time: uniform(0),
    plungeTint: uniform(new THREE.Vector3(1, 1, 1)),
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
  private hasPrev = false
  /** 0 to 1, jumps to 1 when the watched vehicle goes under and decays over about 0.7 s. */
  private plunge = 0
  private wasUnder = false
  private lastAt = 0
  private readonly grade: Grade = { gain: [1, 1, 1], lift: [0, 0, 0], contrast: 0, saturation: 1 }
  private readonly tmp = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(private readonly host: PostChainHost, private readonly sun: SunSource, private readonly focus?: () => PlungeSource | null | undefined) {}

  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, _frameMs?: number): void {
    const budget = this.host.quality.postBudget
    const shed = 1 - Math.min(1, Math.max(0, budget ?? 1))
    let tier = postTier({ on: P.postOn.value, level: graphicsLevel.value, deviceLevel: this.host.quality.deviceLevel, tablets: P.postTablets.value, shed })
    this.tier = tier
    // Anything the governor could shed: everything but the colour look itself.
    this.reportActive(tier !== 'off' && [P.postBloom, P.postShafts, P.postFlare, P.postAO, P.postContact, P.postMotionBlur, P.postGI, P.postClouds].some(p => p.value > 0))
    if (tier === 'off') {
      this.release()
      renderer.render(scene, camera)
      return
    }
    const fade = tier === 'base' ? 0 : 1 - shed
    const sunVis = this.updateSun(camera, renderer)
    const glowOn = tier === 'full' && P.postBloom.value > 0
    const shaftsOn = tier !== 'base' && (P.postShafts.value > 0 || P.postFlare.value > 0)
    const flareOn = tier === 'full' && P.postFlare.value > 0
    const aoOn = tier === 'full' && P.postAO.value > 0
    const giOn = tier === 'full' && P.postGI.value > 0
    const clouds = this.sun.clouds
    const cloudsOn = tier === 'full' && P.postClouds.value > 0 && !!clouds && clouds.coverage > 0 && clouds.density > 0 && clouds.atmosphere > 0
    const light = tier === 'full' && P.postContact.value > 0 ? findSun(scene) : null
    const toneMap = TONE_MAPS[Math.round(P.postToneMap.value)] ?? renderer.toneMapping
    const debug = Math.round(P.postDebug.value)
    const key = `${debug}|${tier}|${glowOn}|${shaftsOn}|${flareOn}|${aoOn}|${giOn}|${cloudsOn}|${light?.uuid ?? ''}|${toneMap}|${renderer.outputColorSpace}`
    if (this.built?.key !== key) this.build(renderer, scene, camera, key, tier, glowOn, shaftsOn, flareOn, aoOn, light, toneMap, debug, giOn, cloudsOn)

    const u = this.u
    u.exposure.value = Math.max(1e-4, renderer.toneMappingExposure)
    u.sunVis.value = sunVis
    u.bloom.value = P.postBloom.value * fade
    u.bloomThreshold.value = P.postBloomThreshold.value
    u.bloomRadius.value = P.postBloomRadius.value
    u.shafts.value = P.postShafts.value * fade
    u.shaftLength.value = P.postShaftLength.value
    u.shaftReach.value = P.postShaftReach.value
    // Ghosts and streak belong to a low sun; overhead they read as smudges on the ground.
    u.flare.value = P.postFlare.value * fade * (0.25 + 0.75 * lowSunAmount(this.sun.sunDirection.y))
    const g = gradeFor(lookForKind(params.get('terrain.kind')?.value), P.postLook.value, { contrast: P.postContrast.value, saturation: P.postSaturation.value, warmth: P.postWarmth.value }, this.grade)
    ;(u.gain.value as THREE.Vector3).set(g.gain[0], g.gain[1], g.gain[2])
    ;(u.lift.value as THREE.Vector3).set(g.lift[0], g.lift[1], g.lift[2])
    u.contrast.value = g.contrast
    u.saturation.value = g.saturation
    u.vignette.value = P.postVignette.value
    u.grain.value = P.postGrain.value * (tier === 'base' ? 1 : 1)
    u.seed.value = (u.seed.value + 61.7) % 4096
    this.updateCamera(camera as THREE.PerspectiveCamera, tier === 'full' ? P.postMotionBlur.value * fade : 0)
    const b = this.built!
    if (b.aoNode) { b.aoNode.radius.value = P.postAORadius.value; b.aoNode.scale.value = P.postAO.value * fade }
    if (b.giNode) { b.giNode.radius.value = P.postGIRadius.value; b.giNode.giIntensity.value = P.postGI.value * fade }
    // Contact shadows march toward the sun with no surface bias, so a low sun grazing the
    // ground makes the ground shadow itself (noise, then scanlines). Fade them in with the
    // sun's height; at a low sun the long cascaded shadows carry the scene anyway.
    const sunUp = smooth01(0.25, 0.45, this.sun.sunDirection.y)
    if (b.sssNode) b.sssNode.shadowIntensity.value = P.postContact.value * fade * sunUp
    u.plunge.value = tier === 'full' ? this.updatePlunge() : 0
    u.heat.value = P.postHeat.value * fade
    u.time.value = (performance.now() / 1000) % 1000
    // The shaft passes cost nothing while the sun is out of view: their stale contents are
    // multiplied by a sun visibility of 0, so they are simply not redrawn.
    const built = this.built!
    const sunLit = sunVis > 0.001
    if (built.maskTex) built.maskTex.autoUpdate = sunLit
    if (built.raysTex) built.raysTex.autoUpdate = sunLit && P.postShafts.value > 0
    this.sun.setVolumetricCloudsActive?.(built.clouds)
    try {
      built.pipeline.render()
    } catch (error) {
      this.sun.setVolumetricCloudsActive?.(false)
      throw error
    }
  }

  /** Free the pipeline and every target it made. Safe to repeat. */
  release(): void {
    this.sun.setVolumetricCloudsActive?.(false)
    if (!this.built) return
    this.built.pipeline.dispose()
    for (const d of this.built.disposables) { d.dispose?.(); d.renderTarget?.dispose() }
    this.built = null
  }

  dispose(): void { this.release(); this.reportActive(false) }

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
    const jumped = !this.hasPrev || dt > 0.25 || this.prevPos.distanceTo(camera.position) > 40
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
   * The plunge: a brief soft blur and a wash of the liquid's colour when the vehicle breaks a
   * liquid surface, so the moment registers. It does not linger: driving through lava or
   * wading is not a reason to blur the screen.
   */
  private updatePlunge(): number {
    const state = this.focus?.()?.liquidState
    const under = !!state?.wasImmersed
    const now = performance.now()
    if (under && !this.wasUnder) {
      this.plunge = 1
      ;(this.u.plungeTint.value as THREE.Vector3).copy(state!.lavaDepth > 0 ? LAVA_TINT : WATER_TINT)
    }
    this.wasUnder = under
    const dt = Math.min(0.1, Math.max(0, (now - this.plungeAt) / 1000))
    this.plungeAt = now
    this.plunge = Math.max(0, this.plunge - dt / 0.7)
    const t = this.plunge
    return t * t * P.postPlunge.value
  }
  private plungeAt = 0

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
    return sunScreenFade(su, sv, inFront) * sunHeightFactor(sun.y, P.postLowSun.value)
  }

  private build(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, key: string, tier: PostTier, glowOn: boolean, shaftsOn: boolean, flareOn: boolean, aoOn: boolean, light: THREE.DirectionalLight | null, toneMap: THREE.ToneMapping, debug = 0, giOn = false, cloudsOn = false): void {
    this.release()
    const u = this.u as Record<keyof PostChain['u'], N>
    const disposables: Built['disposables'] = []
    let maskRef: N = null
    let raysRef: N = null
    const scenePass = pass(scene, camera)
    disposables.push(scenePass as never)
    let color: N = scenePass.getTextureNode('output')
    const depth: N = scenePass.getTextureNode('depth')
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
      prePass = pass(scene, camera)
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
      const composite: N = compositeClouds(color, volume, depth, u.projInv)
      disposables.push(volume, composite)
      color = composite
    }

    // The scene colour as the eye sees it this frame: heat shimmer bends where it reads from,
    // camera motion blur smears it, and the plunge softens and tints it.
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
      const c = (tier === 'full' ? motionBlurred(color, depth, p, { projInv: u.projInv, camWorld: u.camWorld, prevView: u.prevView, prevProj: u.prevProj, amount: u.motionAmount, nearFade: u.motionNear, maxBlur: u.motionMax }) : color.sample(p).rgb).toVar()
      If(u.plunge.greaterThan(0.001), () => {
        // A soft 8-tap ring and the liquid's colour, both fading with the pulse.
        const r = u.plunge.mul(0.012)
        const acc = c.toVar()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          acc.addAssign(color.sample(p.add(vec2(Math.cos(a), Math.sin(a)).mul(r).mul(vec2(1, u.aspect)))).rgb)
        }
        const soft = acc.div(9)
        const lum = dot(soft, vec3(0.2126, 0.7152, 0.0722))
        c.assign(mix(soft, u.plungeTint.mul(lum).mul(1.6), u.plunge.mul(0.45)))
      })
      return c
    })
    let hdr: N = tier === 'full' ? base() : color.rgb

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
      // Mask: open sky near the sun, in its exposed colour; alpha is "open sky" alone.
      const mask = Fn(() => {
        const p = uv()
        const sky = smoothstep(0.99995, 1.0, depth.sample(p).r)
        // On-screen brightness, capped a little past white: the shafts carry the sun's
        // colour and shape, not its full intensity.
        const c = min(color.sample(p).rgb.mul(u.exposure), vec3(SHAFT_CLAMP))
        const d = length(p.sub(u.sunUv).mul(vec2(u.aspect, 1)))
        const near = exp(d.mul(d).div(u.shaftReach.mul(u.shaftReach)).negate().mul(3))
        return vec4(c.mul(sky).mul(near), sky)
      })
      const maskTex: N = rtt(mask(), null, null, { resolutionScale: 0.25 })
      disposables.push(maskTex)
      maskRef = maskTex
      const taps = shaftTaps(tier)
      const rays = Fn(() => {
        const p = uv().toVar()
        const step = u.sunUv.sub(p).mul(u.shaftLength).div(taps)
        p.addAssign(step.mul(interleavedGradientNoise(screenCoordinate)))
        const sum = vec3(0).toVar()
        const w = float(1).toVar()
        const total = float(0).toVar()
        Loop(taps, () => {
          sum.addAssign(maskTex.sample(p).rgb.mul(w))
          total.addAssign(w)
          w.mulAssign(0.96)
          p.addAssign(step)
        })
        // The average light along the path to the sun, weighted to the near end.
        return vec4(sum.div(total), 1)
      })
      const raysTex: N = rtt(rays(), null, null, { resolutionScale: 0.25 })
      disposables.push(raysTex)
      raysRef = raysTex
      // Strongest near the sun, fading across the screen, as light scattered forward does.
      const fromSun = length(uv().sub(u.sunUv).mul(vec2(u.aspect, 1)))
      const fall = exp(fromSun.mul(-1.8))
      hdr = hdr.add(raysTex.sample(uv()).rgb.mul(u.shafts).mul(u.sunVis).mul(fall).mul(0.3).div(u.exposure))

      if (flareOn) {
        const flare = Fn(() => {
          const p = uv()
          const o = vec2(0.004, 0.006)
          // The sun's own light through the mask: the volcano or a vehicle in front eclipses it.
          const sunLight = maskTex.sample(u.sunUv).rgb
            .add(maskTex.sample(u.sunUv.add(o)).rgb).add(maskTex.sample(u.sunUv.sub(o)).rgb)
            .add(maskTex.sample(u.sunUv.add(vec2(o.y, o.x.negate()))).rgb).add(maskTex.sample(u.sunUv.sub(vec2(o.y, o.x.negate()))).rgb)
            .mul(0.2)
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
    // Debug views: the raw occlusion or contact shadow buffers, white is unoccluded.
    if (debug === 1 && aoNode) out = vec4(vec3(aoNode.getTextureNode().sample(uv()).r), 1)
    if (debug === 2 && contactTex) out = vec4(vec3(contactTex), 1)
    const pipeline = new THREE.RenderPipeline(renderer, out)
    pipeline.outputColorTransform = false
    this.built = { key, pipeline, disposables, maskTex: maskRef, raysTex: raysRef, aoNode, sssNode, giNode, clouds: cloudsOn }
    this.builds++
  }
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
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
export function createPostChain(host: PostChainHost, sun: SunSource, focus?: () => PlungeSource | null | undefined): PostChain {
  return new PostChain(host, sun, focus)
}
