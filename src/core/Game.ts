/**
 * Game: owns the renderer, scene, physics world and the fixed step loop.
 *
 * Frame order (after Bruno Simon's documented tick order):
 *   1. input.poll()
 *   2. for each fixed step: systems.fixedUpdate(dt) -> world.step() -> systems.postPhysics(dt)
 *   3. systems.update(frameDt, alpha)   alpha is the 0..1 blend between the last two steps
 *   4. render
 *
 * Systems register with `game.add(system)`. Order of registration is order of execution.
 */
import * as THREE from 'three/webgpu'
import { installRenderDiagnostics, recordStartupPhase, showRendererLost, startupTiming, timeStartup } from './diagnostics'
import { gpuDeadlineMs, startRenderer } from './renderOptions'
import { worldGravity, params } from '../../shared/params'
import { Input } from './Input'
import { QualityController, reportLoading, type FrameMetrics } from './quality'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from './physics'

export interface System {
  /** Apply forces. Runs before every physics step. */
  fixedUpdate?(dt: number): void
  /** Read results. Runs after every physics step. */
  postPhysics?(dt: number): void
  /** Once per rendered frame. `alpha` blends between the previous and current physics state. */
  update?(dt: number, alpha: number): void
  dispose?(): void
}

const MAX_STEPS_PER_FRAME = 5

// ES modules are all fetched before any of them runs, and this one runs once three, Rapier
// and their dependencies have run. On the unbundled dev server the gap from navigation
// start to here is mostly module requests.
recordStartupPhase('fetch and run modules up to Game.ts', 0)

export class Game {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000)
  readonly input = new Input()
  renderer!: THREE.WebGPURenderer
  world!: RAPIER.World
  /** 'webgpu' or 'webgl', known after init. */
  backend: 'webgpu' | 'webgl' = 'webgl'
  /** Seconds of simulated time. */
  time = 0
  /** Fixed steps taken since start. */
  tick = 0
  /** Smoothed frames per second, for the HUD. */
  fps = 0

  readonly quality = new QualityController()
  readonly performance: FrameMetrics = { fps: 0, frameMs: 0, physicsMs: 0, drawCalls: 0, triangles: 0, firstFrameMs: null }

  private readonly systems: System[] = []
  private accumulator = 0
  private last = 0
  private averageFrameMs = 1000 / 60

  private readonly observeRenderer: (() => void) | undefined
  /** Start of the phase being timed between `game.add` calls while main builds the world. */
  private buildMark = 0
  private startupFrames = 0
  private loopStart = 0
  constructor(public canvas: HTMLCanvasElement) {
    // From Game.ts running to here: the rest of the modules main.ts imports run.
    recordStartupPhase('run remaining modules to main()', startupTiming.phases.at(-1)?.endMs ?? 0)
    this.observeRenderer = installRenderDiagnostics(this)
    this.quality.onTerrain = () => this.markTerrainBuilt()
  }

  async init(): Promise<void> {
    await timeStartup('quality initialise (WebGPU adapter probe)', () => this.quality.initialize())
    reportLoading('physics', 0.15)
    await timeStartup('physics init (Rapier WASM)', () => initPhysics())
    this.world = createWorld(worldGravity.value)
    params.onChange((id, value) => {
      if (id === worldGravity.def.id) this.world.gravity = { x: 0, y: -(value as number), z: 0 }
    })

    reportLoading('renderer', 0.4)
    // `?webgl=1` forces the WebGL 2 backend: a way round a WebGPU implementation that
    // initialises but draws nothing (first seen as a black screen on iPadOS Safari).
    const forceWebGL = new URLSearchParams(location.search).has('webgl')
    // WebGPU startup is bounded: a stall, a rejection or a missing adapter ends in WebGL 2
    // with the reason recorded in diagnostics, never a hang. Healthy devices are unchanged.
    const probe = this.quality.adapterProbe
    const started = await timeStartup('renderer.init (adapter, device, context)', () => startRenderer((webgl, freshCanvas) => {
      if (freshCanvas) this.replaceCanvas()
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: webgl })
      this.observeRenderer?.()
      return this.renderer
    }, { forceWebGL, deadlineMs: gpuDeadlineMs(location.search), probe, skipWebGPU: probe === 'timeout' ? 'the WebGPU adapter probe stalled; started WebGL 2' : undefined }))
    this.renderer = started.renderer
    if (started.fallbackReason) { startupTiming.fallbackReason = started.fallbackReason; console.warn(`Syn3h: ${started.fallbackReason}`) }
    this.backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl'
    startupTiming.backend = this.backend
    // Device or context loss leaves a frozen canvas; tell the player and offer a reload.
    const lost = this.renderer.onDeviceLost
    this.renderer.onDeviceLost = info => { lost.call(this.renderer, info); showRendererLost(info) }
    this.quality.attachRenderer(this.renderer)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', resize)
    resize()
    reportLoading('world', 0.7)
    this.buildMark = performance.now()
  }

  /** Swap in a clean canvas, for a WebGL 2 start after a WebGPU attempt may have claimed this one. */
  private replaceCanvas(): void {
    const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement
    this.canvas.replaceWith(fresh)
    this.canvas = fresh
  }

  /**
   * Called by quality.attachTerrain, right after main builds the terrain. main.ts is not
   * this lane's file, so the world build is timed from the calls it already makes here.
   */
  markTerrainBuilt(): void {
    if (this.buildMark) this.buildMark = recordStartupPhase('build until terrain attached to quality', this.buildMark)
  }

  add<T extends System>(system: T): T {
    this.systems.push(system)
    // Before the loop starts, each add closes the phase that built the system. In order,
    // main adds environment and sky, the player vehicle, bots, the chase camera, then the
    // HUD after the shell and lobby are built.
    if (this.buildMark) this.buildMark = recordStartupPhase(`build until add ${this.systems.length}: ${systemName(system)}`, this.buildMark)
    return system
  }

  remove(system: System): void {
    const i = this.systems.indexOf(system)
    if (i >= 0) this.systems.splice(i, 1)
    system.dispose?.()
  }

  start(): void {
    if (this.buildMark) recordStartupPhase('param panel and wiring to game.start', this.buildMark)
    this.buildMark = 0
    this.loopStart = performance.now()
    this.last = performance.now()
    this.renderer.setAnimationLoop(() => this.frame())
  }

  private frame(): void {
    const now = performance.now()
    if (this.loopStart) { recordStartupPhase('game.start to first animation frame', this.loopStart); this.loopStart = 0 }
    const frameMs = now - this.last
    const frameDt = Math.min(0.25, frameMs / 1000)
    this.last = now
    if (frameMs > 0) {
      this.averageFrameMs += (frameMs - this.averageFrameMs) * 0.1
      this.fps = 1000 / this.averageFrameMs
    }

    this.input.poll()

    const physicsStart = performance.now()
    this.accumulator += frameDt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      for (const s of this.systems) s.fixedUpdate?.(FIXED_DT)
      this.world.step()
      for (const s of this.systems) s.postPhysics?.(FIXED_DT)
      this.accumulator -= FIXED_DT
      this.time += FIXED_DT
      this.tick++
      steps++
    }
    // Drop time we could not simulate, so a slow frame does not cause a spiral.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0

    this.performance.physicsMs = performance.now() - physicsStart
    const alpha = this.accumulator / FIXED_DT
    const updateStart = performance.now()
    for (const s of this.systems) s.update?.(frameDt, alpha)
    const renderStart = performance.now()
    this.renderer.render(this.scene, this.camera)
    if (this.startupFrames < 3) this.recordStartupFrame(updateStart, renderStart)
    const metrics = this.performance
    metrics.fps = this.fps
    metrics.frameMs = frameMs
    metrics.drawCalls = this.renderer.info.render.drawCalls
    metrics.triangles = this.renderer.info.render.triangles
    if (metrics.firstFrameMs === null && metrics.drawCalls > 0) metrics.firstFrameMs = performance.now()
    this.quality.frame(metrics)
  }

  /**
   * The first frames compile every shader and pipeline in the scene. Time the update and the
   * render call apart, count pipelines, and record when the GPU and the next animation
   * frame confirm the first frame was presented.
   */
  private recordStartupFrame(updateStart: number, renderStart: number): void {
    const n = ++this.startupFrames
    recordStartupPhase(`frame ${n} systems update`, updateStart, undefined, renderStart)
    const drawn = recordStartupPhase(`frame ${n} render call (shader and pipeline compile)`, renderStart, `${this.renderer.info.render.drawCalls} draws`)
    const pipelines = (this.renderer as unknown as { _pipelines?: { caches?: Map<unknown, { isComputePipeline?: boolean }>; programs?: { vertex: Map<unknown, unknown>; fragment: Map<unknown, unknown> } } })._pipelines
    if (pipelines?.caches && pipelines.programs) {
      let compute = 0
      for (const p of pipelines.caches.values()) if (p.isComputePipeline) compute++
      startupTiming.pipelines = { render: pipelines.caches.size - compute, compute, vertexShaders: pipelines.programs.vertex.size, fragmentShaders: pipelines.programs.fragment.size }
    }
    if (n !== 1) return
    requestAnimationFrame(() => recordStartupPhase('frame 1 render end to next animation frame', drawn))
    const device = (this.renderer.backend as unknown as { device?: GPUDevice }).device
    device?.queue.onSubmittedWorkDone().then(() => recordStartupPhase('frame 1 render end to GPU work done', drawn), () => {})
  }
}

/** A readable name for a system in the startup table. Minified builds may shorten it. */
function systemName(system: System): string {
  const name = (system as { constructor?: { name?: string } }).constructor?.name
  return name && name !== 'Object' ? name : Object.keys(system).slice(0, 3).join(',') || 'object'
}
