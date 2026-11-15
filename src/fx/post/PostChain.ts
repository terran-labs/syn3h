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
  Fn, If, Loop, abs, sin, clamp, dot, exp, float, interleavedGradientNoise, length, max, min, mix, pass,
  renderOutput, rtt, screenCoordinate, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { graphicsLevel } from '../../core/quality'
import { params } from '../../../shared/params'
import { type PostTier, postTier, shaftTaps, sunHeightFactor, sunScreenFade } from './gate'
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
export interface SunSource { readonly sunDirection: THREE.Vector3 }
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
    motion: uniform(0),
    plunge: uniform(0),
    heat: uniform(0.6),
    time: uniform(0),
    plungeTint: uniform(new THREE.Vector3(1, 1, 1)),
  }
  /** 0 to 1, jumps to 1 when the watched vehicle goes under and decays over about 0.7 s. */
  private plunge = 0
  private wasUnder = false
  /** Smoothed camera speed in metres a second, for the speed streaks. */
  private speed = 0
  private readonly lastCam = new THREE.Vector3()
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
    this.reportActive(tier !== 'off' && (P.postBloom.value > 0 || P.postShafts.value > 0 || P.postFlare.value > 0))
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
    const key = `${tier}|${glowOn}|${shaftsOn}|${flareOn}|${renderer.toneMapping}|${renderer.outputColorSpace}`
    if (this.built?.key !== key) this.build(renderer, scene, camera, key, tier, glowOn, shaftsOn, flareOn)

    const u = this.u
    u.exposure.value = Math.max(1e-4, renderer.toneMappingExposure)
    u.sunVis.value = sunVis
    u.bloom.value = P.postBloom.value * fade
    u.bloomThreshold.value = P.postBloomThreshold.value
    u.bloomRadius.value = P.postBloomRadius.value
    u.shafts.value = P.postShafts.value * fade
    u.shaftLength.value = P.postShaftLength.value
    u.shaftReach.value = P.postShaftReach.value
    u.flare.value = P.postFlare.value * fade
    const g = gradeFor(lookForKind(params.get('terrain.kind')?.value), P.postLook.value, { contrast: P.postContrast.value, saturation: P.postSaturation.value, warmth: P.postWarmth.value }, this.grade)
    ;(u.gain.value as THREE.Vector3).set(g.gain[0], g.gain[1], g.gain[2])
    ;(u.lift.value as THREE.Vector3).set(g.lift[0], g.lift[1], g.lift[2])
    u.contrast.value = g.contrast
    u.saturation.value = g.saturation
    u.vignette.value = P.postVignette.value
    u.grain.value = P.postGrain.value * (tier === 'base' ? 1 : 1)
    u.seed.value = (u.seed.value + 61.7) % 4096
    u.motion.value = tier === 'full' ? this.updateMotion(camera) * fade : 0
    u.plunge.value = tier === 'full' ? this.updatePlunge() : 0
    u.heat.value = P.postHeat.value * fade
    u.time.value = (performance.now() / 1000) % 1000
    // The shaft passes cost nothing while the sun is out of view: their stale contents are
    // multiplied by a sun visibility of 0, so they are simply not redrawn.
    const built = this.built!
    const sunLit = sunVis > 0.001
    if (built.maskTex) built.maskTex.autoUpdate = sunLit
    if (built.raysTex) built.raysTex.autoUpdate = sunLit && P.postShafts.value > 0
    built.pipeline.render()
  }

  /** Free the pipeline and every target it made. Safe to repeat. */
  release(): void {
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
   * Streak amount 0 to 1 from how fast the camera moves: nothing below post.streakSpeed,
   * full at twice it. Taken from the camera, so it follows whatever is being watched.
   */
  private updateMotion(camera: THREE.Camera): number {
    const now = performance.now()
    const dt = (now - this.lastAt) / 1000
    const moved = this.lastCam.distanceTo(camera.position)
    this.lastCam.copy(camera.position)
    this.lastAt = now
    // A teleport, a seam crossing or a pause is not speed.
    if (dt > 0 && dt < 0.25 && moved / dt < 600) this.speed += (moved / dt - this.speed) * Math.min(1, dt * 4)
    const from = P.postStreakSpeed.value
    const amount = Math.min(1, Math.max(0, (this.speed - from) / Math.max(1, from)))
    return amount * P.postStreaks.value
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

  private build(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, key: string, tier: PostTier, glowOn: boolean, shaftsOn: boolean, flareOn: boolean): void {
    this.release()
    const u = this.u as Record<keyof PostChain['u'], N>
    const disposables: Built['disposables'] = []
    let maskRef: N = null
    let raysRef: N = null
    const scenePass = pass(scene, camera)
    disposables.push(scenePass as never)
    const color: N = scenePass.getTextureNode('output')
    const depth: N = scenePass.getTextureNode('depth')
    const hot: N = u.bloomThreshold.mul(HOT_CLAMP)

    // Speed streaks: a short radial smear out from the centre, wider towards the edges, only
    // while the camera is fast. A uniform branch, so it costs nothing when still.
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
      const c = color.sample(p).rgb.toVar()
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
      If(u.motion.greaterThan(0.001), () => {
        const out = p.sub(0.5).mul(u.motion.mul(0.05))
        const acc = c.toVar()
        // Jittered per pixel so six taps read as a smear, not six copies.
        const j = interleavedGradientNoise(screenCoordinate)
        for (let i = 1; i <= 6; i++) acc.addAssign(color.sample(p.sub(out.mul(j.add(i - 1).div(6)))).rgb)
        c.assign(acc.div(7))
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
          const ghosts = vec3(0.4, 0.7, 1.0).mul(gA).mul(0.07).add(vec3(1.0, 0.6, 0.3).mul(gB).mul(0.12)).add(vec3(0.6, 1.0, 0.8).mul(gC).mul(0.035))
          const tint = vec3(0.75, 0.88, 1.0)
          return sunLight.mul(tint.mul(streak).mul(0.35).add(ghosts.mul(2.2)))
        })
        hdr = hdr.add(flare().mul(u.flare).mul(u.sunVis).div(u.exposure))
      }
    }

    // Tone map and convert as renderer.render would, then grade the display values.
    const mapped: N = renderOutput(vec4(hdr, 1), renderer.toneMapping, renderer.outputColorSpace)
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

    const pipeline = new THREE.RenderPipeline(renderer, graded())
    pipeline.outputColorTransform = false
    this.built = { key, pipeline, disposables, maskTex: maskRef, raysTex: raysRef }
    this.builds++
  }
}

/** Build the chain for this game. Register it with `game.setPostChain`. */
export function createPostChain(host: PostChainHost, sun: SunSource, focus?: () => PlungeSource | null | undefined): PostChain {
  return new PostChain(host, sun, focus)
}
