/**
 * Desktop bloom, landed dark.
 *
 * Lava, vents, thruster glows, tag beams and the sun spill light on capable desktops. With
 * `gfx.bloom` at 0, the default, none of this runs: Game renders with
 * `renderer.render(scene, camera)` as before and never constructs a `Bloom`, so no pipeline
 * object and no render targets exist. The gate is `bloomActive` in renderOptions.ts.
 *
 * When on, the scene renders into a pass target (same MSAA sample count as the canvas), a
 * three.js BloomNode blurs what is bright, and a RenderPipeline adds the blur back and applies
 * the renderer's own tone mapping and output colour space, as `renderer.render` does.
 *
 * Exposure: the sky's auto exposure raises `toneMappingExposure` at night. The bright pass
 * and the strength work on the exposed colour (scene times exposure), and the blur is divided
 * by the exposure before it is added back, so after tone mapping the halo is the same size
 * for the same on-screen brightness by day and by night. A fixed threshold on the unexposed
 * colour would instead let the night exposure inflate every glow into a white blot, the
 * failure hotExposureDim exists to prevent.
 */
import * as THREE from 'three/webgpu'
import { min, pass, uniform, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { defineParam, params } from '../../shared/params'
import { bloomOverride } from './renderOptions'

export const bloomStrength = defineParam({ id: 'gfx.bloom', label: 'Bloom strength (0 off; desktop at graphics 2 only)', group: 'Graphics', scope: 'client', default: 0, min: 0, max: 1, step: 0.05 })
export const bloomThreshold = defineParam({ id: 'gfx.bloomThreshold', label: 'Bloom threshold (on-screen brightness)', group: 'Graphics', scope: 'client', default: 3, min: 0, max: 6, step: 0.05 })
export const bloomRadius = defineParam({ id: 'gfx.bloomRadius', label: 'Bloom radius', group: 'Graphics', scope: 'client', default: 0.4, min: 0, max: 1, step: 0.05 })

// `?bloom=0.6` turns it on for this page load, for checks and comparisons.
if (typeof location !== 'undefined') {
  const value = bloomOverride(location.search)
  if (value !== undefined) params.set(bloomStrength.def.id, value)
}

/** Brightest on-screen value a pixel may feed into the blur, as a multiple of the threshold. */
export const BLOOM_CLAMP = 2

/** Owns the bloom pipeline while bloom is active; `release` frees every target it made. */
export class Bloom {
  private pipeline: THREE.RenderPipeline | null = null
  private scenePass: { dispose(): void } | null = null
  private bloomNode: { dispose(): void } | null = null
  private readonly strength = uniform(0)
  private readonly threshold = uniform(3)
  private readonly radius = uniform(0.4)
  private readonly exposure = uniform(1)
  /** Times the pipeline has been built, for checks that it is released and rebuilt. */
  builds = 0

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {}

  get active(): boolean { return this.pipeline !== null }

  /** Render one frame through the bloom pipeline, building it on first use. */
  render(): void {
    if (!this.pipeline) this.build()
    this.strength.value = bloomStrength.value
    this.threshold.value = bloomThreshold.value
    this.radius.value = bloomRadius.value
    this.exposure.value = Math.max(1e-4, this.renderer.toneMappingExposure)
    this.pipeline!.render()
  }

  /** Free the pipeline, its pass target and the bloom chain's eleven targets. Safe to repeat. */
  release(): void {
    this.pipeline?.dispose()
    this.bloomNode?.dispose()
    this.scenePass?.dispose()
    this.pipeline = null; this.bloomNode = null; this.scenePass = null
  }

  private build(): void {
    const scenePass = pass(this.scene, this.camera)
    const color = scenePass.getTextureNode('output')
    // Clamp what feeds the blur. A few pixels of tag beam or headlight can be hundreds of
    // times brighter than the scene, or past the half float range; blurred, one of them fills
    // the screen with white. The tone mapper already shows such pixels as white.
    const exposed = min(color.rgb.mul(this.exposure), vec3(this.threshold.mul(BLOOM_CLAMP)))
    const glow = bloom(vec4(exposed, 1), this.strength, this.radius, this.threshold)
    const output = vec4(color.rgb.add(glow.rgb.div(this.exposure)), color.a)
    this.pipeline = new THREE.RenderPipeline(this.renderer, output)
    this.scenePass = scenePass
    this.bloomNode = glow
    this.builds++
  }
}
