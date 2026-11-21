import * as THREE from 'three/webgpu'
import { float, max, renderOutput, rtt, uniform, uv, vec3, vec4 } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import { registerCoveredComposite } from '../../core/coveredPipelines'
import { composeGlass } from '../../liquid-glass/compose'
import { createGlassGaussian } from '../../liquid-glass/gaussian'
import { GlassButton } from './GlassButton'
import './shader-surface.css'

type N = any // The post graph carries colour, texture and velocity nodes.
const c = 'client'
const glassThickness = defineParam({ id: 'glass.thickness', label: 'Glass thickness / radius', group: 'Glass', scope: c, default: 1.12, min: 0.05, max: 2, step: 0.01 })
const glassBevel = defineParam({ id: 'glass.bevel', label: 'Bevel width / radius', group: 'Glass', scope: c, default: 0.53, min: 0.05, max: 1, step: 0.01 })
const glassIndex = defineParam({ id: 'glass.index', label: 'Refractive index', group: 'Glass', scope: c, default: 1.5, min: 1.1, max: 2, step: 0.01 })
const glassDispersion = defineParam({ id: 'glass.dispersion', label: 'Blue to red index difference', group: 'Glass', scope: c, default: 0.025, min: 0, max: 0.12, step: 0.001 })

/** Loaded only by the two glass trials. All programs are built under covered entry. */
export class GlassPost {
  covered = false
  built = false
  private controls?: GlassButton
  private readonly material = uniform(new THREE.Vector4())
  private readonly sourceWidth = uniform(1)
  private readonly buffer = new THREE.Vector2()
  private renderer?: THREE.WebGPURenderer
  private blur?: ReturnType<typeof createGlassGaussian>
  private resting?: THREE.RenderPipeline

  constructor(private readonly mode: string) {}

  build(out: N, color: N, renderer: THREE.WebGPURenderer, toneMap: THREE.ToneMapping, velocity: N,
    temporalNode: N, scenePass: N, disposables: { dispose?(): void }[]): N {
    this.renderer = renderer
    const glass = this.controls ??= new GlassButton(renderer.domElement, new URLSearchParams(location.search).get('glassSet') === 'one' ? 1 : 6)
    const finished: N = this.mode === 'target' ? rtt(out, null, null, { type: THREE.HalfFloatType }) : null
    if (finished) disposables.push(finished)
    const original = finished ? finished.sample(uv()) : out
    const sample = (at: N) => {
      if (finished) return finished.sample(at).rgb
      const display = (coord: N) => renderOutput(vec4(color.sample(coord).rgb, 1), toneMap, renderer.outputColorSpace).rgb
      return original.rgb.add(display(at).sub(display(uv())))
    }
    // Under trial: generate lower levels of the source already used by the
    // composite, and sample those for frost without another full-size target.
    let filtered: ((coord: N, footprint: N) => N) | undefined
    const blurMode = new URLSearchParams(location.search).get('glassBlur')
    let blurred: ((at: N) => N) | undefined
    if (blurMode !== 'direct') {
      const source = finished ?? color
      const targetTexture = finished ? finished.value : temporalNode ? temporalNode.getTextureNode().value : scenePass.getTexture('output')
      if (targetTexture) {
        targetTexture.generateMipmaps = true
        targetTexture.minFilter = THREE.LinearMipmapLinearFilter
        const displaySample = (coord: N, footprint: N) => {
          const level = max(footprint.mul(this.sourceWidth).div(glass.viewport.x.max(1)), 1).log2()
          const raw = source.sample(coord).level(level).rgb
          return finished ? raw : renderOutput(vec4(raw, 1), toneMap, renderer.outputColorSpace).rgb
        }
        const correction = finished ? vec3(0) : original.rgb.sub(renderOutput(vec4(color.sample(uv()).rgb, 1), toneMap, renderer.outputColorSpace).rgb)
        if (blurMode !== 'mip' && !glass.clearMaterial) {
          this.blur = createGlassGaussian(at => displaySample(at, float(2)), glass.viewport)
          for (const pass of this.blur.passes) registerCoveredComposite(pass)
          const blur = this.blur
          blurred = at => blur.sample(at).add(correction)
          disposables.push(blur)
        }
        filtered = (coord, footprint) => displaySample(coord, footprint).add(correction)
      }
    }
    if (glass.pressOnly && glass.pairSlots && blurred) {
      const rest = composeGlass(original, sample, glass, this.material, filtered, blurred, false)
      this.resting = new THREE.RenderPipeline(renderer, velocity ? rest.context({ velocity }) : rest)
      this.resting.outputColorTransform = false
      registerCoveredComposite(this.resting)
      disposables.push(this.resting)
    }
    out = composeGlass(original, sample, glass, this.material, filtered, blurred)
    this.built = true
    return out
  }

  register(pipeline: THREE.RenderPipeline) {
    if (this.built) registerCoveredComposite(pipeline)
  }

  render(pipeline: THREE.RenderPipeline) {
    const controls = this.controls!
    this.sourceWidth.value = this.renderer!.getDrawingBufferSize(this.buffer).x
    this.material.value.set(glassThickness.value, glassBevel.value, glassIndex.value, glassDispersion.value)
    controls.update()
    const view = controls.viewport.value
    this.blur?.update(view.x, view.y, this.covered || controls.hasSurface)
    if (this.covered) this.resting?.render()
    const selected = !this.covered && this.resting && !controls.pairSlots?.value.z ? this.resting : pipeline
    selected.render()
    controls.present()
  }

  release() {
    this.controls?.hide()
    this.built = false
    this.blur = undefined
    this.resting = undefined
  }

  dispose() { this.controls?.dispose() }
}
