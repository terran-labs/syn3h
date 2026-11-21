import { CoveredPipelines } from './coveredPipelines'
import { longFrames } from './longFrames'
import { installLongFrameRenderer } from './longFrameRenderer'
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
import { installRenderDiagnostics, recordCoveredVehicleDraw, recordEntryWarmIssue, recordStartupGameDraw, recordStartupPhase, recordStartupPrecompile, showRendererLost, startupTiming, timeStartup } from './diagnostics'
import { shaderWorkCount } from './diagnosticShaders'
import { guardDevice, runGuarded, type GuardedRenderer } from './deviceLoss'
import { snapshotPixelRatio } from './snapshotScale'
import { drawFrame, gpuDeadlineMs, startRenderer, viewState, withDeadline, type PostChain } from './renderOptions'
import { worldGravity, params } from '../../shared/params'
import { Input } from './Input'
import { QualityController, reportLoading, vehicleShading, type AdjacentRenderPreset, type QualityLevel, type FrameMetrics } from './quality'
import { drawCoveredShowroomVariant } from '../vehicles/skins/showroom'
import { PipelineCounter } from './performanceHistory'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from './physics'

/** A normal frame through the production post chain, drawn with the entry overlay opaque. */
export interface CoveredWarm {
  draw(vehicleKind?: string): void
  yieldFrame(label: string): Promise<void>
}

export interface System {
  warmCovered?(warm: CoveredWarm): Promise<void>
  /** Apply scene-wide material inputs to any model temporarily attached for this draw. */
  prepareCoveredDraw?(): void
  /** Apply world render state after updates can attach actors or switch their materials. */
  prepareWorldDraw?(): void
  /** Apply forces. Runs before every physics step. */
  fixedUpdate?(dt: number): void
  /** Read results. Runs after every physics step. */
  postPhysics?(dt: number): void
  /** Once per rendered frame. `alpha` blends between the previous and current physics state. */
  update?(dt: number, alpha: number): void
  /** Existing hidden meshes that should participate in the covered precompile draw. */
  precompileMeshes?(): Iterable<THREE.Mesh>
  /** Already-planted scenery a live quality change can reveal at this camera. */
  precompileQualityMeshes?(): Iterable<THREE.Mesh>
  /** Select or expose the draws the direct Minimal renderer will need, restoring them synchronously. */
  drawCoveredMinimal?(draw: () => void): void
  /** Attach retained player models for the existing Medium to Low preview draw. */
  drawCoveredLowFleet?(draw: () => void): void
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
  vehicleKind = (): string => 'unknown'
  readLongFrames(after = 0) { return longFrames.read(after) }
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
    const forceWebGL = new URLSearchParams(location.search).has('webgl')
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
    installLongFrameRenderer(this.renderer)
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
    // Bot and player vehicles use the same Rapier world. Capture actual collider creation
    // inside construction separately from mesh creation and the enclosing bot spawn.
    const createCollider = this.world.createCollider
    this.world.createCollider = function (descriptor, parent) {
      const start = longFrames.start()
      try { return createCollider.call(this, descriptor, parent) }
      finally { longFrames.end('Physics collider creation', start) }
    }
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
  add<T extends System>(system: T, before?: System | string): T {
    const at = before && typeof before !== 'string' ? this.systems.indexOf(before) : -1
    if (at < 0) this.systems.push(system)
    else this.systems.splice(at, 0, system)
    // Before the loop starts, each add closes the phase that built the system. In order,
    // main adds environment and sky, the player vehicle, bots, the chase camera, then the
    // HUD after the shell and lobby are built.
    if (this.buildMark) this.buildMark = recordStartupPhase(`build until add ${this.systems.length}: ${typeof before === 'string' ? before : systemName(system)}`, this.buildMark)
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
    longFrames.pause()
    this.paused = true
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

  /**
   * The view as it stands, for a screenshot (src/ui/screenshot.ts): draw it with the camera
   * exactly where it is, through the same post chain, and copy the canvas into a new 2D canvas
   * in the same task. Neither backend keeps a drawn frame readable once the task ends (WebGL
   * without preserveDrawingBuffer, WebGPU once the frame is presented), so the copy is made
   * before returning. Nothing steps: no physics, no system update, the clock untouched.
   *
   * `full` draws at the device's own pixel ratio whatever Auto resolution chose for play, the
   * long side capped at `maxSide` so a phone is not asked for more memory than it has. The
   * render scale goes back in a finally, and one frame is drawn at the old size so the paused
   * view is not left blank. If the larger frame cannot be made, the frame is taken at the size
   * play uses. Only for the pause screen, where the loop is stopped and nothing is on time.
   * Null before the first frame or with a lost device.
   */
  snapshot(options: { full?: boolean; maxSide?: number } = {}): HTMLCanvasElement | null {
    if (!this.started || (this.renderer as unknown as GuardedRenderer)._isDeviceLost) return null
    const before = this.renderer.getPixelRatio()
    const target = options.full ? snapshotPixelRatio(before, devicePixelRatio || 1, Math.max(innerWidth, innerHeight), options.maxSide ?? 3840) : before
    if (target !== before) {
      try {
        this.renderer.setPixelRatio(target)
        // Twice: anything that blends with the frame before it settles at the new size.
        const copy = this.copyFrame(2, true)
        if (copy) return copy
      } catch (error) { console.warn('A full-size screenshot could not be made; taking it at the play size.', error) }
      finally {
        this.renderer.setPixelRatio(before)
        // The resize cleared the canvas; the loop is stopped, so draw the paused view again.
        try { runGuarded(this.renderer as unknown as GuardedRenderer, () => drawFrame(this.renderer, this.scene, this.camera, this.postChain, 16)) } catch { /* The copy below draws too. */ }
      }
    }
    return this.copyFrame(1)
  }
  /**
   * Draw `draws` frames and copy the last into a new 2D canvas, all in this task. `verify` reads
   * one pixel back: a 2D canvas too large for the device draws nothing and says nothing.
   */
  private copyFrame(draws: number, verify = false): HTMLCanvasElement | null {
    const { width, height } = this.canvas
    if (!width || !height) return null
    const copy = document.createElement('canvas'); copy.width = width; copy.height = height
    const context = copy.getContext('2d'); if (!context) return null
    let drawn = false
    runGuarded(this.renderer as unknown as GuardedRenderer, () => { for (let i = 0; i < draws; i++) drawFrame(this.renderer, this.scene, this.camera, this.postChain, 16); drawn = true })
    if (!drawn) return null
    context.drawImage(this.canvas, 0, 0)
    if (verify && context.getImageData(width >> 1, height >> 1, 1, 1).data[3] === 0) return null
    return copy
  }

  /** Frames the loop has run since start, drawn or not. Stands still while paused. */
  frames = 0

  /**
   * One animation frame, inside the device-loss guard (deviceLoss.ts runGuarded): once the
   * renderer is lost the world still steps (the room and other players go on) but nothing is
   * drawn and no frame's work can throw a dead device's errors into the page.
   */
  private frame(): void {
    try { runGuarded(this.renderer as unknown as GuardedRenderer, () => this.step()) }
    finally { longFrames.finish(performance.now()) }
  }

  private step(): void {
    const now = performance.now()
    this.frames++
    longFrames.begin(now, this.frames, this.backend, this.quality.governor.level, this.vehicleKind())
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
      const physicsStep = longFrames.start()
      this.world.step()
      longFrames.end('Physics step', physicsStep)
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
    longFrames.end('System updates', updateStart)
    const view = this.view()
    longFrames.renderContext(view, this.scene.userData.playerVehicleCache?.current)
    // A lost device draws nothing: no render, no buffer, no pipeline (see frame()).
    const draw = !this.holdDraws && !this.applyingQuality && !(this.renderer as unknown as GuardedRenderer)._isDeviceLost && (view !== 'covered' || this.startupFrames < 3 || this.quality.isLoading || now - this.lastDraw >= 500)
    if (draw) {
      const watchingDraw = startupTiming.firstWorldFrameMs === undefined ||
        (view === 'playing' && startupTiming.playRequestMs !== undefined && startupTiming.firstPlayableFrameMs === undefined)
      const previousDraws = watchingDraw ? this.renderer.info.render.drawCalls : 0
      for (const system of this.systems) system.prepareWorldDraw?.()
      drawFrame(this.renderer, this.scene, this.camera, this.postChain, frameMs)
      if (view === 'playing') this.rememberVehicleLevel(this.quality.governor.level)
      longFrames.end('Render submission', renderStart)
      this.lastDraw = now
      // A render invocation without draw calls (or an earlier covered draw) is not this frame.
      if (watchingDraw && this.renderer.info.render.drawCalls > previousDraws) recordStartupGameDraw(view === 'playing')
    }
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
    if (!this.applyingQuality) this.quality.frame(metrics, view === 'playing')
  }

  /**
   * While true the world is not drawn at all. The shell sets it while the galaxy covers the
   * world and the world is being prepared: a frame drawn then would compile, on the spot,
   * whatever shader it met first, which is the stall precompile() exists to avoid.
   */
  holdDraws = false
  private applyingQuality = false

  private manualVehicleLevels = new WeakMap<object, number>()

  private rememberVehicleLevel(level: QualityLevel): void {
    const actor = this.scene.userData.playerVehicleCache?.active
    if (!actor) return
    const previous = this.manualVehicleLevels.get(actor) ?? 0
    const levels = previous | (1 << level)
    if (levels !== previous) this.manualVehicleLevels.set(actor, levels)
  }

  manualQualityReady(level: QualityLevel): boolean {
    const current = this.quality.getQualityState()
    if (Object.keys(current.overrides).length) return false
    if (level === current.level && current.rung === 0) return true
    // These neighbouring presets retain the shadow rig and the corresponding
    // vehicle materials. Larger transitions can release one of those resources.
    if (Math.min(level, current.level) < 1 || Math.max(level, current.level) > 3 ||
        Math.abs(level - current.level) > 1) return false
    const actor = this.scene.userData.playerVehicleCache?.active
    if (actor && !((this.manualVehicleLevels.get(actor) ?? 0) & (1 << level))) return false
    return !!this.postChain?.hasRenderPreset?.(this.quality.renderPreset(level, false))
  }

  /** The caller installs the opaque veil before starting this operation. */
  async prepareManualQuality(apply: () => void, signal: AbortSignal, progress: (phase: string) => void = () => {}): Promise<void> {
    if (signal.aborted) return
    const stop = new AbortController()
    let release!: () => void
    const cancelled = new Promise<void>(resolve => { release = resolve })
    const cancel = () => { stop.abort(); release() }
    signal.addEventListener('abort', cancel, { once: true })
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    let applied = false
    this.applyingQuality = true
    try {
      const prepare = async () => {
        await frame()
        await frame() // Give the browser a paint opportunity before changing the preset.
        stop.signal.throwIfAborted()
        applied = true
        apply()
        this.quality.settleCoveredPostBudget()
        await frame()
        await frame() // Let normal system updates adopt the new geometry and effects.
        stop.signal.throwIfAborted()
        await this.warmVisibleQuality(stop.signal, progress)
      }
      const result = await withDeadline(Promise.race([prepare(), cancelled]), 15_000)
      if (!result.ok && !signal.aborted) {
        console.warn('Manual graphics preparation', result.reason)
        if (!applied) apply()
      }
    } finally {
      stop.abort()
      signal.removeEventListener('abort', cancel)
      this.applyingQuality = false
    }
  }

  private async warmVisibleQuality(signal: AbortSignal, progress: (phase: string) => void): Promise<void> {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const submit = () => {
      signal.throwIfAborted()
      const hidden: THREE.Object3D[] = []
      try {
        for (const system of this.systems) {
          if (!system.precompileQualityMeshes) continue
          for (const mesh of system.precompileQualityMeshes()) {
            for (let o: THREE.Object3D | null = mesh; o && o !== this.scene; o = o.parent) {
              if (!o.visible) { hidden.push(o); o.visible = true }
            }
          }
        }
        for (const system of this.systems) system.prepareWorldDraw?.()
        drawFrame(this.renderer, this.scene, this.camera, this.postChain, 16)
      } finally {
        for (let i = hidden.length - 1; i >= 0; i--) hidden[i].visible = false
      }
    }
    progress('Preparing visible surfaces')
    await frame()
    signal.throwIfAborted()
    const batch = CoveredPipelines.forRenderer(this.renderer, this.scene)
    if (batch) {
      batch.run(true, submit)
      progress('Compiling graphics pipelines')
      await batch.ready()
    }
    progress('Drawing the new level')
    await frame()
    submit()
    await this.finishWorldFrame(signal, () => signal.throwIfAborted(), false)
    signal.throwIfAborted()
    // Let the ordinary camera, governor and post chain present both temporal targets
    // behind the veil. A slow GPU drain can leave the camera far from its last draw.
    this.applyingQuality = false
    let clean = 0
    for (let i = 0; i < 8 && clean < 2; i++) {
      const before = shaderWorkCount()
      await frame()
      signal.throwIfAborted()
      clean = shaderWorkCount() === before ? clean + 1 : 0
    }
  }

  /**
   * Build the shaders and pipelines for everything in the scene before play shows it, by
   * drawing two real frames through the post chain with culling off, so what the camera cannot
   * see yet (the far side, the view on the way down, the ground behind the vehicle) is built
   * too. three's compileAsync is not used: in r187 it built shared uniform bind groups for its
   * own render context, and materials it built read camera uniforms that never updated.
   */
  async precompile(progress?: (label: string) => void): Promise<void> {
    const start = performance.now()
    const stop = new AbortController()
    const limit = 15_000
    const deadline = start + limit
    try {
      const result = await withDeadline(this.warmEntry(stop.signal, deadline, progress), limit)
      if ((this.renderer as unknown as GuardedRenderer)._isDeviceLost) {
        recordEntryWarmIssue('GPU device lost during entry')
      } else if (!result.ok) {
        recordEntryWarmIssue(result.reason === 'timeout' || performance.now() >= deadline ? 'Entry warm-up timed out' : 'Entry warm-up failed')
        if (result.reason === 'rejected') console.warn('Covered entry warm-up failed', result.error)
      }
    } finally {
      // A skin load or frame callback may settle after the overlay has gone.
      stop.abort()
      const end = performance.now()
      recordStartupPrecompile(end - start)
      try { performance.measure('syn3h:precompile', { start, end }) } catch { /* Older engines. */ }
    }
  }

  private async warmEntry(signal: AbortSignal, deadline: number, progress?: (label: string) => void): Promise<void> {
    // Traverse the game passes with the cover opaque. The first sweep issues pipelines
    // with the live light set, geometry, material side and render target. After they
    // settle the second sweep exercises the real draws for those same configurations.
    let batch = CoveredPipelines.forRenderer(this.renderer, this.scene)
    const check = () => {
      signal.throwIfAborted()
      if ((this.renderer as unknown as GuardedRenderer)._isDeviceLost) throw new Error('GPU device lost during entry')
      if (performance.now() >= deadline) throw new Error('Entry warm-up timed out')
    }
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const yieldFrame = async (label: string) => {
      check()
      progress?.(label)
      if (!batch) await nextFrame()
      check()
    }
    let discover = !!batch
    const draw = (vehicleKind?: string, visibleOnly = false) => {
      check()
      const drawStart = longFrames.start()
      longFrames.event('Covered precompile')
      for (const system of this.systems) system.prepareCoveredDraw?.()
      for (const system of this.systems) system.prepareWorldDraw?.()
      const culled: THREE.Object3D[] = []
      if (!visibleOnly) this.scene.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o) } })
      const hidden: THREE.Object3D[] = []
      try {
        if (!visibleOnly) for (const system of this.systems) {
          if (!system.precompileMeshes) continue
          for (const mesh of system.precompileMeshes()) {
            for (let object: THREE.Object3D | null = mesh; object && object !== this.scene; object = object.parent) {
              if (!object.visible) { hidden.push(object); object.visible = true }
            }
          }
        }
        this.postChain?.setCovered?.(this.holdDraws || this.applyingQuality)
        const submit = () => drawFrame(this.renderer, this.scene, this.camera, this.postChain, 16)
        runGuarded(this.renderer as unknown as GuardedRenderer, () => {
          if (batch) batch.run(discover, submit)
          else submit()
        })
      } finally {
        this.postChain?.setCovered?.(false)
        for (let j = hidden.length - 1; j >= 0; j--) hidden[j].visible = false
        for (const o of culled) o.frustumCulled = true
        if (vehicleKind) recordCoveredVehicleDraw(vehicleKind, performance.now() - drawStart)
        longFrames.end('Covered precompile', drawStart)
      }
    }
    const warm = { draw, yieldFrame }
    const preparedLevels = new Set<QualityLevel>()
    const sweep = async () => {
      for (let i = 0; i < 2; i++) {
        await yieldFrame('Preparing world')
        draw()
      }
      for (const [index, system] of [...this.systems].entries()) {
        check()
        if (!system.warmCovered) continue
        try {
          await system.warmCovered(warm)
        } catch (error) {
          check()
          recordEntryWarmIssue('System warm-up failed', index + 1)
          console.warn('Covered system warm-up failed', systemName(system), error)
        }
      }
      // Only the current view and player need the cheaper programs at a relief boundary.
      // Use exact destination targets, including the direct-to-canvas Minimal path.
      const chain = this.postChain
      const governor = this.quality?.governor
      if (!chain?.warmCovered || !governor?.auto || governor.levelPinned) return
      const player = this.scene.userData.playerVehicleCache?.active?.object
      const entryLevel = governor.level
      // Ultra and Cinematic change cascade counts. Preview just their existing neighbour
      // until the renderer can retain the actual destination shadow state.
      const lowest = entryLevel > 3 ? entryLevel - 1 : 0
      for (let lower = entryLevel - 1; lower >= lowest; lower--) {
        const level = lower as QualityLevel
        const preset = this.quality.renderPreset(level, true)
        const shade = Number(preset.value(vehicleShading.def.id))
        const existingPreview = entryLevel > 3 || (entryLevel < 3 && lower === entryLevel - 1)
        const root = existingPreview ? this.scene : player
        const drawView = () => draw(undefined, !existingPreview)
        const drawVariants = () => root && (shade === 0 || shade === 1 || shade === 2)
          ? drawCoveredShowroomVariant(root, shade, drawView) : drawView()
        // Medium entry already warms the parked Low models on WebGPU for later swaps.
        const fleet = existingPreview && this.backend === 'webgpu' && level === 1 && shade === 0
          ? this.systems.find(system => system.drawCoveredLowFleet) : undefined
        let submit = () => fleet?.drawCoveredLowFleet ? fleet.drawCoveredLowFleet(drawVariants) : drawVariants()
        if (level === 0) {
          for (const system of this.systems) {
            if (!system.drawCoveredMinimal) continue
            const inner = submit
            submit = () => system.drawCoveredMinimal!(inner)
          }
        }
        const seen = new Set<string>()
        for (const target of [preset, { ...preset, shed: true }]) {
          const key = chain.coveredVariantKey?.(target)
          if (key && seen.has(key)) continue
          if (key) seen.add(key)
          await chain.warmCovered({ yieldFrame, draw: submit }, target)
        }
        preparedLevels.add(level)
      }
    }
    await sweep()
    if (batch) {
      if (!await batch.ready()) recordEntryWarmIssue('Pipeline compilation failed')
      check()
      discover = false
      // Discovery uses the actual scene and renderer cache. Parked models or changed
      // passes get confirmed again, while an unchanged entry needs only its final draw.
      if (batch.needsConfirmation) await sweep()
      // The confirmation draws can leave partially filled world and shadow targets.
      // Refresh them from the settled scene before lifting cover.
      batch = null
      await yieldFrame('Preparing first frame')
      draw()
    }
    // Submission can return before Metal finishes work for the first draw. Drain our
    // world queue while the cover is still opaque, independently of the galaxy renderer.
    await yieldFrame('Finishing graphics')
    await this.finishWorldFrame(signal, check, true)
    for (const level of preparedLevels) this.rememberVehicleLevel(level)
  }

  private async finishWorldFrame(signal: AbortSignal, check: () => void, entry: boolean): Promise<void> {
    const backend = this.renderer.backend as { device?: GPUDevice; gl?: WebGL2RenderingContext }
    if (backend.device) {
      const result = await withDeadline(backend.device.queue.onSubmittedWorkDone(), 2_000)
      if (entry && !signal.aborted && !result.ok) recordEntryWarmIssue(result.reason === 'timeout' ? 'GPU completion timed out' : 'GPU completion failed')
    } else if (backend.gl) {
      const gl = backend.gl
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (fence) {
        try {
          gl.flush()
          const deadline = performance.now() + 2_000
          while (!gl.isContextLost() && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) {
            if (performance.now() >= deadline) {
              if (entry) recordEntryWarmIssue('GPU completion timed out')
              break
            }
            check()
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
        } finally { gl.deleteSync(fence) }
      }
    }
  }

  private postChain: (PostChain<THREE.WebGPURenderer, THREE.Scene, THREE.PerspectiveCamera> & {
    warmCovered?(warm: CoveredWarm, preset: AdjacentRenderPreset): Promise<void>
    coveredVariantKey?(preset: AdjacentRenderPreset): string | undefined
    hasRenderPreset?(preset: AdjacentRenderPreset): boolean
  }) | null = null
  /**
   * Hand every frame to a post-processing chain, or pass null to draw straight through the
   * renderer again. With no chain the frame is `renderer.render(scene, camera)`, unchanged.
   * The chain is not called on frames Game skips (the world hidden behind the galaxy lobby).
   */
  setPostChain(chain: Game['postChain']): void {
    this.postChain = chain
    this.quality.governor.canClimbVisible = level => {
      const last = this.quality.levelChanges.at(-1)
      if (last?.from !== level) return false
      const target = this.quality.renderPreset(level, true)
      // Only a change in cascade count invalidates the shadow shader. Low keeps the two Medium cascades idle.
      return Math.max(1, Number(target.value('gfx.shadowQuality'))) === Math.max(1, Number(params.get('gfx.shadowQuality')?.value)) &&
        !!chain?.hasRenderPreset?.(target)
    }
  }
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
