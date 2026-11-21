import type { Object3D, WebGPURenderer } from 'three/webgpu'

// Three's timestamp API reports a query for each render context. Adjacent
// passes share a context, so capture each query ID while that quad is drawn.
interface TimestampBackend {
  trackTimestamp: boolean
  device?: { features: { has(feature: string): boolean } }
  disjoint?: unknown
  getTimestampUID(context: unknown): string
  hasTimestampQuery(id: string): boolean
  getTimestamp(id: string): number
  resolveTimestampsAsync(type: 'render'): Promise<unknown>
}
interface TimedQuad { _quadMesh?: Object3D }

export class GlassTiming {
  visible = false
  ms: number | null = null
  private next = 0
  private pending = false

  draw(renderer: WebGPURenderer, pipeline: { render(): void }, blurPasses: readonly object[]) {
    if (!this.visible || this.pending || performance.now() < this.next) {
      pipeline.render()
      return
    }
    this.next = performance.now() + 1000
    const backend = renderer.backend as unknown as TimestampBackend
    if (!backend.trackTimestamp && !backend.device?.features.has('timestamp-query') && !backend.disjoint) {
      pipeline.render()
      return
    }
    const quads = [...blurPasses, pipeline].map(pass => (pass as TimedQuad)._quadMesh)
    if (quads.some(q => !q)) { pipeline.render(); return }
    const ids = new Set<string>()
    const tracking = backend.trackTimestamp
    const restore: (() => void)[] = []
    try {
      backend.trackTimestamp = true
      for (const quad of quads) {
        if (!quad) continue
        const previous = quad.onAfterRender
        quad.onAfterRender = function (...args) {
          previous.apply(this, args)
          const context = (renderer as unknown as { _currentRenderContext: unknown })._currentRenderContext
          const uid = backend.getTimestampUID(context)
          if (uid) ids.add(uid)
        }
        restore.push(() => { quad.onAfterRender = previous })
      }
      pipeline.render()
      this.pending = true
      this.ms = null
      void backend.resolveTimestampsAsync('render').then(() => {
        if (ids.size !== quads.length) return
        let sum = 0
        for (const id of ids) {
          if (!backend.hasTimestampQuery(id)) return
          const value = backend.getTimestamp(id)
          if (!(value > 0) || !Number.isFinite(value)) return
          sum += value
        }
        this.ms = sum
      }).catch(() => {}).finally(() => { this.pending = false })
    } finally {
      for (const undo of restore) undo()
      backend.trackTimestamp = tracking
    }
  }
}
