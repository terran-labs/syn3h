import type { WebGPURenderer } from 'three/webgpu'

interface RenderObject { pipeline: object; geometry: object; scene: object }
interface CoveredBackend {
  device?: GPUDevice
  parallel?: unknown
  createRenderPipeline(object: RenderObject, promises: Promise<unknown>[] | null): void
  draw(object: RenderObject, ...args: unknown[]): void
}
interface FrameClock { frameId: number }

/** Use Three's async pipeline request on the exact render objects selected by the
 * production passes. The backend hooks are scoped to a single synchronous traversal.
 * Other renderers, ordinary world frames and promise continuations keep their own state.
 */
export class CoveredPipelines {
  private readonly pending: Promise<void>[] = []
  private readonly confirmed = new WeakMap<RenderObject, { pipeline: object; geometry: object }>()
  private constructor(private readonly backend: CoveredBackend, private readonly clock: FrameClock, private readonly scene: object) {}

  static forRenderer(renderer: WebGPURenderer, scene: object): CoveredPipelines | null {
    const backend = renderer.backend as unknown as CoveredBackend
    const clock = (renderer as unknown as { _nodes?: { nodeFrame?: FrameClock } })._nodes?.nodeFrame
    if (!clock || !(backend.device || backend.parallel) || typeof backend.createRenderPipeline !== 'function'
      || typeof backend.draw !== 'function') return null
    return new CoveredPipelines(backend, clock, scene)
  }

  run(discover: boolean, draw: () => void): void {
    const { backend, scene } = this
    const create = backend.createRenderPipeline, submit = backend.draw
    const requests: Promise<unknown>[] = []
    // PassNode and the CSM camera cache use Three's frame serial. Advance it for
    // each distinct pose without advancing real time or stepping game physics.
    this.clock.frameId++
    if (discover) {
      backend.createRenderPipeline = function (object, promises) {
        // A one-shot texture generator can run inside the traversal. It needs its
        // pixels immediately. Only defer geometry from the world and its caster passes.
        return create.call(this, object, object.scene === scene ? promises ?? requests : promises)
      }
      backend.draw = function (object, ...args) {
        if (object.scene !== scene) submit.call(this, object, ...args)
      }
    } else {
      const seen = this.confirmed
      backend.draw = function (object, ...args) {
        // The first real submission of each object and pipeline still reaches the
        // driver. The unchanged world need not be rasterised once per parked pose.
        if (object.scene !== scene) return submit.call(this, object, ...args)
        const previous = seen.get(object)
        if (previous?.pipeline === object.pipeline && previous.geometry === object.geometry) return
        submit.call(this, object, ...args)
        seen.set(object, { pipeline: object.pipeline, geometry: object.geometry })
      }
    }
    try { draw() }
    finally {
      backend.createRenderPipeline = create
      backend.draw = submit
      // Handle rejections immediately, including when the outer entry times out
      // before a system finishes.
      for (const request of requests) this.pending.push(request.then(() => {}, error => {
        this.failed = true
        console.warn('Covered graphics pipeline failed', error)
      }))
    }
  }

  private failed = false
  async ready(): Promise<boolean> {
    await Promise.all(this.pending)
    return !this.failed
  }
}
