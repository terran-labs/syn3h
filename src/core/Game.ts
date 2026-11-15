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
import { installRenderDiagnostics } from './diagnostics'
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
  constructor(readonly canvas: HTMLCanvasElement) { this.observeRenderer = installRenderDiagnostics(this) }

  async init(): Promise<void> {
    await this.quality.initialize()
    reportLoading('physics', 0.15)
    await initPhysics()
    this.world = createWorld(worldGravity.value)
    params.onChange((id, value) => {
      if (id === worldGravity.def.id) this.world.gravity = { x: 0, y: -(value as number), z: 0 }
    })

    reportLoading('renderer', 0.4)
    // `?webgl=1` forces the WebGL 2 backend: a way round a WebGPU implementation that
    // initialises but draws nothing (first seen as a black screen on iPadOS Safari).
    const forceWebGL = new URLSearchParams(location.search).has('webgl')
    this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL })
    this.observeRenderer?.()
    await this.renderer.init()
    this.backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl'
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
  }

  add<T extends System>(system: T): T {
    this.systems.push(system)
    return system
  }

  remove(system: System): void {
    const i = this.systems.indexOf(system)
    if (i >= 0) this.systems.splice(i, 1)
    system.dispose?.()
  }

  start(): void {
    this.last = performance.now()
    this.renderer.setAnimationLoop(() => this.frame())
  }

  private frame(): void {
    const now = performance.now()
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
    for (const s of this.systems) s.update?.(frameDt, alpha)
    this.renderer.render(this.scene, this.camera)
    const metrics = this.performance
    metrics.fps = this.fps
    metrics.frameMs = frameMs
    metrics.drawCalls = this.renderer.info.render.drawCalls
    metrics.triangles = this.renderer.info.render.triangles
    if (metrics.firstFrameMs === null && metrics.drawCalls > 0) metrics.firstFrameMs = performance.now()
    this.quality.frame(metrics)
  }
}
