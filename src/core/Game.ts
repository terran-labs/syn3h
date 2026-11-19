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
import { canCreateWebGL2, NoGraphicsError, webgpuUsable } from './graphicsSupport'
import { installRenderDiagnostics, recordStartupPhase, showRendererLost, startupTiming, timeStartup } from './diagnostics'
import { guardDevice, type GuardedRenderer } from './deviceLoss'
import { drawFrame, gpuDeadlineMs, startRenderer, viewState, type PostChain } from './renderOptions'
import { worldGravity, params } from '../../shared/params'
import { Input } from './Input'
import { QualityController, reportLoading, type FrameMetrics } from './quality'
import { PipelineCounter } from './performanceHistory'
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
  private readonly pipelineCounter = new PipelineCounter()
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
    // Physics starts first and is awaited only where the physics world is created, below: its
    // WebAssembly downloads and compiles while the adapter probe and the renderer start.
    const physics = timeStartup('physics init (Rapier WASM), beside the probe and renderer', () => initPhysics())
    physics.catch(() => { /* Reported where it is awaited. */ })
    await timeStartup('quality initialise (WebGPU adapter probe)', () => this.quality.initialize())
    reportLoading('physics', 0.15)

    reportLoading('renderer', 0.4)
    // `?webgl=1` forces the WebGL 2 backend: a way round a WebGPU implementation that
    // initialises but draws nothing (first seen as a black screen on iPadOS Safari).
    const renderQuery = new URLSearchParams(location.search)
    const forceWebGL = renderQuery.has('webgl')
    // WebGPU startup is bounded: a stall, a rejection or a missing adapter ends in WebGL 2
    // with the reason recorded in diagnostics, never a hang. Healthy devices are unchanged.
    const probe = this.quality.adapterProbe
    // Nothing to draw with: no WebGPU adapter to start (or WebGL forced) and no WebGL 2 context
    // either. Stop here with a plain reason rather than inside three.js (graphicsSupport.ts).
    if ((forceWebGL || !webgpuUsable(probe)) && !canCreateWebGL2()) throw new NoGraphicsError(`no WebGL 2 context; WebGPU ${forceWebGL ? 'not tried (?webgl=1)' : `adapter probe: ${probe}`}`)
    const started = await timeStartup('renderer.init (adapter, device, context)', () => startRenderer((webgl, freshCanvas) => {
      if (freshCanvas) this.replaceCanvas()
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: webgl })
      this.observeRenderer?.()
      return this.renderer
    }, { forceWebGL, deadlineMs: gpuDeadlineMs(location.search), probe, skipWebGPU: probe === 'timeout' ? 'the WebGPU adapter probe stalled; started WebGL 2' : undefined }))
    this.renderer = started.renderer
    if (renderQuery.get('phoneReport') === '1') {
      const { createPhoneRenderRecorder } = await import('../dev/phoneRenderReport')
      const recorder = createPhoneRenderRecorder()
      this.interruptPhoneReport = () => recorder.interrupt('The game paused.')
      const renderer = this.renderer
      // r187 exposes the frame IDs in its backend JS but omits them from the type declarations.
      const timing = renderer.backend as unknown as { trackTimestamp: boolean; getTimestampFrames(type: string): number[] }
      timing.trackTimestamp = renderer.hasFeature('timestamp-query')
      let pending = false
      this.recordPhoneFrame = (startMs, intervalMs, playing) => {
        const frame = this.frames
        const rendererFrame = renderer.info.frame
        recorder.recordFrame({ frame, startMs, intervalMs, cpuMs: performance.now() - startMs,
          renderCalls: renderer.info.render.frameCalls, quality: this.quality.governor.level, backend: this.backend, playing })
        if (!playing || pending || !timing.trackTimestamp || !renderer.info.render.frameCalls) return
        pending = true
        void renderer.resolveTimestampsAsync().then(gpuMs => {
          if (gpuMs !== undefined && gpuMs > 0 && timing.getTimestampFrames('render').at(-1) === rendererFrame) {
            recorder.recordGpu({ frame, gpuMs })
          }
        }).catch(() => { timing.trackTimestamp = false }).finally(() => { pending = false })
      }
    }
    if (started.fallbackReason) { startupTiming.fallbackReason = started.fallbackReason; console.warn(`Syn3h: ${started.fallbackReason}`) }
    this.backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl'
    startupTiming.backend = this.backend
    // Device or context loss leaves a frozen canvas; tell the player and offer a reload. Once:
    // three's device.lost and the guard below can both report the same loss.
    const lost = this.renderer.onDeviceLost
    let reported = false
    this.renderer.onDeviceLost = info => { if (reported) return; reported = true; lost.call(this.renderer, info); showRendererLost(info) }
    // A dropped WebGPU instance or a device destroyed underneath us counts as that loss too, and
    // three's error scopes stop rejecting into the page (deviceLoss.ts).
    guardDevice(this.renderer as unknown as GuardedRenderer)
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
    // Without physics there is no game: stop the one loop already running (the display probe)
    // and let the failure reach the page, which asks for a reload. Nothing else has started.
    try { await timeStartup('wait for physics after the renderer', () => physics) } catch (error) { this.quality.dispose(); throw error }
    this.world = createWorld(worldGravity.value)
    params.onChange((id, value) => {
      if (id === worldGravity.def.id) this.world.gravity = { x: 0, y: -(value as number), z: 0 }
    })
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

  /** Insert before an existing system, or append if the anchor is absent. */
  add<T extends System>(system: T, before?: System): T {
    const at = before ? this.systems.indexOf(before) : -1
    if (at < 0) this.systems.push(system)
    else this.systems.splice(at, 0, system)
    // Before the loop starts, each add closes the phase that built the system. In order,
    // main adds environment and sky, the player vehicle, bots, the chase camera, then the
    // HUD after the shell and lobby are built.
    if (this.buildMark) this.buildMark = recordStartupPhase(`build until add ${this.systems.length}: ${systemName(system)}`, this.buildMark)
    return system
  }

  remove(system: System, dispose = true): void {
    const i = this.systems.indexOf(system)
    if (i >= 0) this.systems.splice(i, 1)
    if (dispose) system.dispose?.()
  }

  start(): void {
    if (this.buildMark) recordStartupPhase('param panel and wiring to game.start', this.buildMark)
    this.buildMark = 0
    this.loopStart = performance.now()
    this.last = performance.now()
    this.started = true
    if (!this.paused) this.renderer.setAnimationLoop(() => this.frame())
  }

  private started = false
  private recordPhoneFrame?: (startMs: number, intervalMs: number, playing: boolean) => void
  private interruptPhoneReport?: () => void
  private paused = false
  /** True while the loop is stopped because nobody can see the page. */
  get isPaused(): boolean { return this.paused }

  /**
   * Stops everything the loop drives: physics steps, every system's updates and rendering.
   * Called when the page is hidden (src/core/lifecycle.ts). Nothing is torn down, so no
   * shader or pipeline is rebuilt on the way back. Safe before `start` and when already paused.
   */
  pause(): void {
    if (this.paused) return
    this.paused = true
    this.interruptPhoneReport?.()
    if (!this.started) return
    this.renderer.setAnimationLoop(null)
    // Clearing the callback is not enough: three keeps requesting animation frames for its own
    // bookkeeping (about 15 a second measured in a hidden page). Its animation object has the
    // stop that the public method does not call; setAnimationLoop starts it again on resume.
    ;(this.renderer as unknown as { _animation?: { stop?: () => void } })._animation?.stop?.()
  }

  /**
   * Starts the loop again from now. The time spent paused is discarded, not simulated: the
   * frame clock restarts and the leftover fraction of a step is dropped, so the first frame
   * back takes at most one ordinary step and there is no catch-up burst.
   */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (!this.started) return
    this.last = performance.now()
    this.accumulator = 0
    this.renderer.setAnimationLoop(() => this.frame())
  }

  /** Frames the loop has run since start, drawn or not. Stands still while paused. */
  frames = 0

  private frame(): void {
    const now = performance.now()
    this.frames++
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
    // Behind the opaque galaxy lobby nobody can see the world: draw it twice a second, enough
    // to keep it warm for the descent, instead of every frame under a full-screen shader.
    // The first frames always draw: loading ends, and shaders compile, on a real frame.
    const view = this.view()
    const draw = !this.holdDraws && (view !== 'covered' || this.startupFrames < 3 || this.quality.isLoading || now - this.lastDraw >= 500)
    if (draw) { drawFrame(this.renderer, this.scene, this.camera, this.postChain, frameMs); this.lastDraw = now }
    if (this.startupFrames < 3) this.recordStartupFrame(updateStart, renderStart)
    const metrics = this.performance
    metrics.fps = this.fps
    metrics.frameMs = frameMs
    metrics.drawCalls = this.renderer.info.render.drawCalls
    metrics.triangles = this.renderer.info.render.triangles
    // Read-only look at the renderer's own pipeline cache, as recordStartupFrame does once.
    const pipelines = this.pipelineCounter.scan((this.renderer as unknown as { _pipelines?: { caches?: Map<unknown, object> } })._pipelines?.caches)
    metrics.pipelinesLive = pipelines?.live ?? null
    metrics.pipelinesFresh = pipelines?.fresh ?? null
    if (metrics.firstFrameMs === null && metrics.drawCalls > 0) metrics.firstFrameMs = performance.now()
    // Frames in the lobby say how the lobby runs, not how the game will: only play is judged.
    this.quality.frame(metrics, view === 'playing')
    this.recordPhoneFrame?.(now, frameMs, view === 'playing')
  }

  /**
   * While true the world is not drawn at all. The shell sets it while the galaxy covers the
   * world and the world is being prepared: a frame drawn then would compile, on the spot,
   * whatever shader it met first, which is the stall precompile() exists to avoid.
   */
  holdDraws = false

  /**
   * Build the shaders and pipelines for everything in the scene before play shows it, by
   * drawing two real frames through the post chain with culling off, so what the camera cannot
   * see yet (the far side, the view on the way down, the ground behind the vehicle) is built
   * too. three's compileAsync is not used: in r187 it built shared uniform bind groups for its
   * own render context, and materials it built read camera uniforms that never updated.
   */
  async precompile(): Promise<void> {
    const start = performance.now()
    // Drawn for real, through the frames' own passes, so every shader and pipeline is built
    // exactly as play will use it, with culling off so what the camera cannot see yet is in
    // too. Each such frame may stall while it compiles: call this only while the world is
    // covered and the cover is still (the galaxy holding in the world's air).
    for (let i = 0; i < 2; i++) {
      const culled: THREE.Object3D[] = []
      this.scene.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o) } })
      try { drawFrame(this.renderer, this.scene, this.camera, this.postChain, 16) } finally { for (const o of culled) o.frustumCulled = true }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    try { performance.measure('syn3h:precompile', { start, end: performance.now() }) } catch { /* Older engines. */ }
  }

  private postChain: PostChain<THREE.WebGPURenderer, THREE.Scene, THREE.PerspectiveCamera> | null = null
  /**
   * Hand every frame to a post-processing chain, or pass null to draw straight through the
   * renderer again. With no chain the frame is `renderer.render(scene, camera)`, unchanged.
   * The chain is not called on frames Game skips (the world hidden behind the galaxy lobby).
   */
  setPostChain(chain: PostChain<THREE.WebGPURenderer, THREE.Scene, THREE.PerspectiveCamera> | null): void { this.postChain = chain }
  private lastDraw = 0
  private shell: Element | null = null
  /** See viewState. The shell element is looked up until it exists, then kept. */
  private view() {
    if (typeof document === 'undefined') return 'playing' as const
    this.shell ??= document.querySelector('.syn3h-shell')
    return viewState(this.shell?.classList)
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
