/**
 * One post-processing pipeline for the whole game: bloom, sun shafts, a filmic grade and a
 * vignette. Each has its own strength parameter (src/core/post/params.ts), all 0 by default.
 *
 * With every strength at 0 none of this exists: Game renders with plain
 * `renderer.render(scene, camera)` and never constructs a PostStack (see Game.draw). When some
 * are on, only those are built into the node graph; changing which effects are on rebuilds the
 * pipeline once, changing a strength only moves a uniform.
 *
 * Order, all in linear HDR before the renderer's own tone mapping and output colour space:
 *   scene pass -> + shafts -> + bloom -> grade -> vignette -> tone mapping (RenderPipeline)
 *
 * Exposure: the sky's auto exposure raises toneMappingExposure about seven times at night.
 * Bloom and shafts threshold and add in exposed units (colour times exposure) and divide back,
 * so a glow or a shaft looks the same for the same on-screen brightness by day and by night,
 * instead of the night exposure inflating every hot pixel to white (what hotExposureDim fixed).
 *
 * The sun's screen position is projected on the CPU each frame from the same camera object the
 * scene pass renders with. Inside the post quad, three's camera nodes describe the quad's own
 * camera, not the scene's, so they cannot be used for this.
 */
import * as THREE from 'three/webgpu'
import { Fn, Loop, float, int, interleavedGradientNoise, length, min, mix, pass, rtt, screenCoordinate, smoothstep, step, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import type { PostEffect } from '../renderOptions'
import { bloomRadius, bloomStrength, bloomThreshold, gradeStrength, shaftsStrength, vignetteStrength } from './params'
import { lowSunFactor } from '../renderOptions'

/** Brightest on-screen value a pixel may feed into the bloom blur, as a multiple of the threshold. */
export const BLOOM_CLAMP = 2
/** Samples along each shaft. 48 at half resolution keeps banding hidden by the noise offset. */
const SHAFT_SAMPLES = 48

type Disposable = { dispose(): void }
// three's TSL node types are loose; this file builds node graphs, not typed values.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

export class PostStack {
  private pipeline: THREE.RenderPipeline | null = null
  private key = ''
  private disposables: Disposable[] = []
  private readonly u = {
    exposure: uniform(1),
    bloomStrength: uniform(0), bloomThreshold: uniform(3), bloomRadius: uniform(0.4),
    shafts: uniform(0), sunUv: uniform(new THREE.Vector2(0.5, 0.5)),
    grade: uniform(0), vignette: uniform(0), aspect: uniform(1),
  }
  private readonly sunWorld = new THREE.Vector3()
  private readonly rotation = new THREE.Matrix4()
  /** Pipeline builds so far, for checks that it is released and rebuilt. */
  builds = 0
  /** The effects in the current pipeline, for diagnostics and checks. */
  effects: PostEffect[] = []

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {}

  get active(): boolean { return this.pipeline !== null }

  /** Render one frame with `effects` (non-empty), rebuilding only when the set changes. */
  render(effects: PostEffect[]): void {
    const key = effects.join(',')
    if (key !== this.key) { this.release(); this.build(effects); this.key = key }
    this.updateUniforms()
    this.pipeline!.render()
  }

  /** Free the pipeline and every target it made. Safe to repeat. */
  release(): void {
    this.pipeline?.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.pipeline = null; this.key = ''; this.effects = []
  }

  private updateUniforms(): void {
    const u = this.u, r = this.renderer
    u.exposure.value = Math.max(1e-4, r.toneMappingExposure)
    u.bloomStrength.value = bloomStrength.value
    u.bloomThreshold.value = bloomThreshold.value
    u.bloomRadius.value = bloomRadius.value
    u.grade.value = gradeStrength.value
    u.vignette.value = vignetteStrength.value
    u.aspect.value = this.camera.aspect
    // Shafts: only when the sun is low, above the horizon and in front of the camera.
    const sun = this.sunDirection()
    let shafts = 0
    if (sun) {
      this.sunWorld.copy(sun).applyMatrix4(this.rotation.extractRotation(this.camera.matrixWorldInverse))
      const inFront = this.sunWorld.z < 0
      this.sunWorld.copy(sun).multiplyScalar(this.camera.far * 0.5).add(this.camera.position).project(this.camera)
      // The same convention three's getScreenPosition uses for sampling render targets.
      u.sunUv.value.set(this.sunWorld.x * 0.5 + 0.5, 1 - (this.sunWorld.y * 0.5 + 0.5))
      if (inFront) shafts = shaftsStrength.value * lowSunFactor(sun.y)
    }
    u.shafts.value = shafts
  }

  /** The sky publishes its sun direction as a uniform on its mesh (AlienSkyMesh). */
  private sunDirection(): THREE.Vector3 | null {
    const sky = this.scene.children.find(o => 'sunDirection' in o) as unknown as { sunDirection?: { value: THREE.Vector3 } } | undefined
    return sky?.sunDirection?.value ?? null
  }

  private build(effects: PostEffect[]): void {
    const u = this.u
    const on = (e: PostEffect) => effects.includes(e)
    const scenePass = pass(this.scene, this.camera)
    this.disposables.push(scenePass as unknown as Disposable)
    const color: N = scenePass.getTextureNode('output')
    let hdr: N = color.rgb

    if (on('shafts')) {
      const depth: N = scenePass.getTextureNode('depth')
      // Source: bright sky near the sun. The sky does not write depth, so its pixels keep the
      // cleared depth of 1; terrain on the bent horizon occludes exactly as it was drawn.
      const source = Fn(() => {
        const sky = step(0.99999, depth.r)
        const near = smoothstep(0.45, 0, length(uv().sub(u.sunUv).mul(vec2(u.aspect, 1))))
        const exposed = min(color.rgb.mul(u.exposure), vec3(4))
        return vec4(exposed.mul(sky).mul(near), 1)
      })()
      const sourceTex: N = rtt(source, null, null, { resolutionScale: 0.5, type: THREE.HalfFloatType })
      this.disposables.push({ dispose: () => sourceTex.renderTarget?.dispose() })
      const shafts = Fn(() => {
        const p = uv().toVar()
        const offset = u.sunUv.sub(p).div(SHAFT_SAMPLES).toConst()
        p.addAssign(offset.mul(interleavedGradientNoise(screenCoordinate)))
        const sum = vec3(0).toVar(), w = float(1).toVar()
        Loop({ start: int(0), end: int(SHAFT_SAMPLES), type: 'int', condition: '<' }, () => {
          p.addAssign(offset)
          sum.addAssign(sourceTex.sample(p).rgb.mul(w))
          w.mulAssign(0.965)
        })
        return sum.div(SHAFT_SAMPLES).mul(u.shafts).mul(1.6)
      })()
      hdr = hdr.add(shafts.div(u.exposure))
    }

    if (on('bloom')) {
      // Clamp what feeds the blur: a few lamp or beam pixels hundreds of times too bright would
      // otherwise fill the screen with white. The tone mapper shows them as white either way.
      const exposed = min(color.rgb.mul(u.exposure), vec3(u.bloomThreshold.mul(BLOOM_CLAMP)))
      const glow: N = bloom(vec4(exposed, 1), u.bloomStrength, u.bloomRadius, u.bloomThreshold)
      this.disposables.push(glow)
      hdr = hdr.add(glow.rgb.div(u.exposure))
    }

    if (on('grade')) {
      // Filmic grade in linear light before tone mapping: a little more contrast about mid
      // grey, a little more saturation, cool shadows and warm highlights. Strength 1 is still
      // gentle; this is a look, not a filter.
      const g = u.grade
      const graded = Fn(() => {
        const c = hdr.max(vec3(1e-5)).toVar()
        const contrast = float(1).add(g.mul(0.18))
        c.assign(c.div(0.18).pow(vec3(contrast)).mul(0.18))
        const luma = c.dot(vec3(0.2126, 0.7152, 0.0722))
        c.assign(mix(vec3(luma), c, float(1).add(g.mul(0.15))))
        const tone = smoothstep(0, 1, luma.div(luma.add(0.5)))
        const tint = mix(vec3(0.96, 1.0, 1.05), vec3(1.05, 1.0, 0.95), tone)
        return mix(c, c.mul(tint), g).max(vec3(0))
      })()
      hdr = graded
    }

    if (on('vignette')) {
      const d = length(uv().sub(0.5).mul(vec2(u.aspect, 1))).div(length(vec2(u.aspect.mul(0.5), 0.5)))
      hdr = hdr.mul(float(1).sub(u.vignette.mul(0.55).mul(smoothstep(0.45, 1.05, d))))
    }

    this.pipeline = new THREE.RenderPipeline(this.renderer, vec4(hdr, color.a))
    this.effects = [...effects]
    this.builds++
  }
}
