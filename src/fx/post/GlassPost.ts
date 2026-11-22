import { currentTint, onPaintedTint, liquidSelected, respectReducedTransparency } from '../../ui/glassMaterial'
import * as THREE from 'three/webgpu'
import { float, max, renderOutput, rtt, uniform, uv, vec3, vec4 } from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { registerCoveredComposite } from '../../core/coveredPipelines'
import { composeGlass } from '../../liquid-glass/compose'
import { regularSettings as settings, regularOverrides } from './regularSettings'
import { regularTransfer } from '../../liquid-glass/regularTuning'
import { createGlassGaussian } from '../../liquid-glass/gaussian'
import { gameplayGlassSlots, GlassButton } from './GlassButton'
import { createLobbyGlass } from '../../liquid-glass/lobby'
import { installGalaxyGlass } from '../../ui/galaxy/glassAdapter'
import { GlassTiming } from './glassTiming'
import './shader-surface.css'

type N = any // The post graph carries colour, texture and velocity nodes.
const c = 'client'
const glassThickness = defineParam({ id: 'glass.thickness', label: 'Glass thickness / radius', group: 'Clear lens', scope: c, default: 1.12, min: 0.05, max: 2, step: 0.01 })
const glassBevel = defineParam({ id: 'glass.bevel', label: 'Bevel width / radius', group: 'Clear lens', scope: c, default: 0.53, min: 0.05, max: 1, step: 0.01 })
const glassIndex = defineParam({ id: 'glass.index', label: 'Refractive index', group: 'Clear lens', scope: c, default: 1.5, min: 1.1, max: 2, step: 0.01 })
const glassDispersion = defineParam({ id: 'glass.dispersion', label: 'Blue to red index difference', group: 'Clear lens', scope: c, default: 0.025, min: 0, max: 0.12, step: 0.001 })

/** Loaded only by the two glass trials. All programs are built under covered entry. */
export class GlassPost {
  covered = false
  private pausedDraw?: () => void
  private frame = 0
  private wake = () => {
    if (!this.pausedDraw || this.frame || document.hidden) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!document.hidden) this.pausedDraw?.()
    })
  }

  setPausedDraw(draw?: () => void) {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.pausedDraw = draw
    this.wake()
  }

  readonly timing = new GlassTiming()
  private showing = false
  private drawPlain = false
  private graphReady = false
  private driving = false
  private enteredAt = 0
  private driveBlock = ''
  private lastReason = 'waiting for playable glass'
  private changedAt = 0

  readonly driveFrame = (playing: boolean, eligible: boolean) => {
    const root = document.documentElement
    if (!playing) {
      this.timing.monitoring = false
      if (this.driving) {
        delete root.dataset.driveGlass
        this.driveBlock = ''
        this.controls?.invalidate()
      }
      this.driving = false
      return
    }
    const now = performance.now()
    if (!this.driving) {
      this.driving = true
      this.enteredAt = now
      this.lastReason = 'drive started'
      this.changedAt = 0
    }
    if (!liquidSelected()) {
      this.timing.monitoring = false
      delete root.dataset.driveGlass
      return
    }
    this.driveBlock = this.controls?.reducedTransparency ? 'transparency preference' : ''
    this.timing.monitoring = eligible && this.graphReady && !this.driveBlock && !this.covered
    this.setDriveSurface(!this.driveBlock && this.graphReady)
  }

  private setDriveSurface(enabled: boolean) {
    const root = document.documentElement
    const state = enabled ? 'on' : 'shed'
    if (root.dataset.driveGlass !== state) {
      root.dataset.driveGlass = state
      this.controls?.invalidate()
    }
  }

  private record(showing: boolean, reason: string) {
    if (this.showing === showing && this.lastReason === reason) return
    this.showing = showing
    this.lastReason = reason
    this.changedAt = this.driving ? (performance.now() - this.enteredAt) / 1000 : 0
  }

  diagnosticLine(): string {
    const count = this.showing ? this.controls?.visibleCount ?? 0 : 0
    const cost = count && this.timing.ms !== null ? this.timing.ms.toFixed(2) + ' ms' : 'unavailable'
    const changes = [regularOverrides()]
    for (const p of [glassThickness, glassBevel, glassIndex, glassDispersion]) {
      if (p.value !== p.def.default) changes.push(p.def.id + '=' + p.value)
    }
    if (this.controls?.pressOnly) changes.push('glassMerge=zorb-brake-pressed')
    if (this.controls?.clearMaterial) changes.push('glassMaterial=clear')
    const overrides = changes.filter(Boolean).join(', ')
    return `Glass: ${this.showing ? 'on' : 'shed'} at ${this.changedAt.toFixed(1)} s (${this.lastReason}), ${count} visible surfaces, glass-only GPU time (two blur passes) ${cost}` + (overrides ? `\nGlass overrides: ${overrides}` : '')
  }

  private controls?: GlassButton
  private readonly material = uniform(new THREE.Vector4())
  private readonly sourceWidth = uniform(1)
  private readonly buffer = new THREE.Vector2()
  private renderer?: THREE.WebGPURenderer

  private readonly tuning = {
    inkResponse: uniform(1), face: uniform(new THREE.Vector4()), panel: uniform(new THREE.Vector2()), edges: uniform(new THREE.Vector3()),
  }
  private readonly frost = uniform(1)
  private readonly unsubscribe: () => void
  private revision = 0
  private updateTuning = () => {
    const coverage = currentTint() / 100
    this.tuning.inkResponse.value = Math.min(1, coverage * 4)
    const opacity = Math.max(0, (coverage - .25) / .75) * .97
    const transfer = regularTransfer(true, settings.tint.value * Math.min(1, coverage * 4), settings.brightness.value)
    transfer.quadratic *= 1 - opacity
    transfer.slope *= 1 - opacity
    transfer.panelSlope *= 1 - opacity
    transfer.lift = transfer.lift * (1 - opacity) + opacity * 22 / 255
    transfer.panelLift = transfer.panelLift * (1 - opacity) + opacity * 22 / 255
    this.tuning.face.value.set(transfer.quadratic, transfer.slope, transfer.lift, settings.saturation.value * (1 - opacity))
    this.tuning.panel.value.set(transfer.panelSlope, transfer.panelLift)
    this.tuning.edges.value.set(settings.rim.value, settings.hair.value, .405 * settings.lift.value)
    this.frost.value = settings.frost.value / settings.frost.def.default
    const root = document.documentElement
    if (settings.growth.value) root.style.setProperty('--glass-extra-scale', String(1 + settings.growth.value))
    else root.style.removeProperty('--glass-extra-scale')
    this.controls?.tune(settings.growth.value)
    this.revision++
    this.wake()
  }
  constructor(private readonly mode: string) {
    this.updateTuning()
    const stopSettings = params.onChange(id => { if (id.startsWith('glass.')) this.updateTuning() })
    const stopTint = onPaintedTint(this.updateTuning)
    this.unsubscribe = () => { stopSettings(); stopTint() }
    if (mode === 'inline') installGalaxyGlass((gl, canvas) => createLobbyGlass(gl, canvas, {
      face: this.tuning.face.value, panel: this.tuning.panel.value, edges: this.tuning.edges.value,
      inkResponse: () => this.tuning.inkResponse.value, width: () => this.frost.value, growth: () => settings.growth.value,
      revision: () => this.revision, respectReducedTransparency,
    }))
  }

  build(out: N, color: N, renderer: THREE.WebGPURenderer, toneMap: THREE.ToneMapping, velocity: N,
    temporalNode: N, scenePass: N, disposables: { dispose?(): void }[]) {
    let blur: ReturnType<typeof createGlassGaussian> | undefined
    let resting: THREE.RenderPipeline | undefined
    this.renderer = renderer
    const first = !this.controls
    const glass = this.controls ??= new GlassButton(renderer.domElement, new URLSearchParams(location.search).get('glassSet') === 'one' ? 1 : gameplayGlassSlots, this.wake)
    if (first) glass.tune(settings.growth.value)
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
          blur = createGlassGaussian(at => displaySample(at, float(2)), glass.viewport, this.frost)
          for (const pass of blur.passes) registerCoveredComposite(pass)
          const gaussian = blur
          blurred = at => gaussian.sample(at).add(correction)
          disposables.push(blur)
        }
        filtered = (coord, footprint) => displaySample(coord, footprint).add(correction)
      }
    }
    const regular = glass.clearMaterial ? undefined : { ...this.tuning, exposure: blur?.exposure }
    if (glass.pressOnly && glass.pairSlots && blurred) {
      const rest = composeGlass(original, sample, glass, this.material, filtered, blurred, false, regular)
      resting = new THREE.RenderPipeline(renderer, velocity ? rest.context({ velocity }) : rest)
      resting.outputColorTransform = false
      registerCoveredComposite(resting)
      disposables.push(resting)
    }
    out = composeGlass(original, sample, glass, this.material, filtered, blurred, true, regular)
    const pipeline = new THREE.RenderPipeline(renderer, velocity ? out.context({ velocity }) : out)
    pipeline.outputColorTransform = false
    registerCoveredComposite(pipeline)
    disposables.push(pipeline)
    return { pipeline, resting, blur }
  }

  render(graph: ReturnType<GlassPost['build']>, plain: THREE.RenderPipeline, covered = this.covered) {
    const controls = this.controls!
    if (!this.graphReady && this.driving && !covered) this.setDriveSurface(!this.driveBlock)
    this.graphReady = true
    if (!covered && this.driving && this.driveBlock) {
      if (!this.drawPlain) controls.hide()
      this.drawPlain = true
      this.record(false, this.driveBlock)
      plain.render()
      return
    }
    this.drawPlain = false
    this.sourceWidth.value = this.renderer!.getDrawingBufferSize(this.buffer).x
    this.material.value.set(glassThickness.value, glassBevel.value, glassIndex.value, glassDispersion.value)
    controls.update()
    const view = controls.viewport.value
    graph.blur?.update(view.x, view.y, covered || controls.hasSurface)
    if (covered) graph.resting?.render()
    if (!covered && !controls.hasSurface) plain.render()
    else {
      const pass = !covered && graph.resting && !controls.pairSlots?.value.z ? graph.resting : graph.pipeline
      if (covered) pass.render()
      else this.timing.draw(this.renderer!, pass, graph.blur?.passes ?? [])
    }
    if (!covered) {
      const on = controls.available
      if (on && !this.showing) {
        this.record(true, 'Liquid selected')
      } else if (!on) {
        this.record(false, controls.reducedTransparency ? 'transparency preference' : 'interface frost disabled')
      }
      controls.present()
      if (controls.animating) this.wake()
    }
  }

  release(reason = 'post graph unavailable') {
    if (this.graphReady) this.controls?.hide()
    this.graphReady = false
    if (this.driving && liquidSelected()) this.setDriveSurface(false)
    else delete document.documentElement.dataset.driveGlass
    this.record(false, reason)
  }

  dispose() {
    delete document.documentElement.dataset.driveGlass
    this.unsubscribe()
    document.documentElement.style.removeProperty('--glass-extra-scale')
    this.setPausedDraw()
    this.controls?.dispose()
  }
}
