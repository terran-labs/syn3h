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
import { worldGravity, params } from '../../shared/params'
import { Input } from './Input'
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

  private readonly systems: System[] = []
  private accumulator = 0
  private last = 0

  constructor(readonly canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    await initPhysics()
    this.world = createWorld(worldGravity.value)
    params.onChange((id, value) => {
      if (id === worldGravity.def.id) this.world.gravity = { x: 0, y: -(value as number), z: 0 }
    })

    this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true })
    await this.renderer.init()
    this.backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl'
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
    const frameDt = Math.min(0.25, (now - this.last) / 1000)
    this.last = now
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05

    this.input.poll()

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

    const alpha = this.accumulator / FIXED_DT
    for (const s of this.systems) s.update?.(frameDt, alpha)
    this.renderer.render(this.scene, this.camera)
  }
}
