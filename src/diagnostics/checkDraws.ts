import type { Game } from '../core/Game'
import { shaderWorkCount } from '../core/diagnosticShaders'

type Kind = 'graph' | 'pipeline'
type Bucket = 'draw' | 'prep' | 'veil' | 'unmatched'
type Source = { object?: { name?: string; parent?: Source['object'] }; material?: object }
type Builder = Source & { build(...args: unknown[]): unknown }
type Backend = {
  createNodeBuilder(object: object, renderer: unknown): Builder
  createRenderPipeline(source: Source, ...args: unknown[]): unknown
  createComputePipeline?: (...args: unknown[]) => unknown
  draw(source: Source, ...args: unknown[]): unknown
}
const counts = () => ({ graph: 0, pipeline: 0 })
const row = () => ({ draw: counts(), prep: counts(), veil: counts(), unmatched: counts() })

/** Observe actual backend submissions only during the check. A render target or shadow pass
 * can contribute to the picture. A matched draw does not establish pixel coverage. */
export function observeCheckDraws(game: Game, veiled: () => boolean) {
  const backend = game.renderer.backend as unknown as Backend
  const builder = backend.createNodeBuilder, pipeline = backend.createRenderPipeline
  const compute = backend.createComputePipeline, draw = backend.draw
  let current = row(), workAtStart = shaderWorkCount(), frame = -1, open = true
  const pending = new Map<Source['object'], Map<Source['material'], Kind[]>>()
  const available = [builder, pipeline, draw].every(fn => typeof fn === 'function')
  function record(source: Source, kind: Kind) {
    if (!open) return
    if (veiled()) { current.veil[kind]++; return }
    for (let o = source.object; o; o = o.parent) {
      if (o.name === 'Showroom warm') { current.prep[kind]++; return }
    }
    current.unmatched[kind]++
    if (!source.object || !source.material) return
    if (frame !== game.frames) { pending.clear(); frame = game.frames }
    let group = pending.get(source.object)
    if (!group) { group = new Map(); pending.set(source.object, group) }
    const kinds = group.get(source.material)
    if (kinds) kinds.push(kind)
    else group.set(source.material, [kind])
  }
  if (available) {
    backend.createNodeBuilder = function(object, renderer) {
      const b = builder.call(this, object, renderer), build = b.build
      b.build = function(...args) {
        try { return build.apply(this, args) }
        finally { record(this, 'graph'); b.build = build }
      }
      return b
    }
    backend.createRenderPipeline = function(source, ...args) {
      try { return pipeline.call(this, source, ...args) }
      finally { record(source, 'pipeline') }
    }
    if (compute) backend.createComputePipeline = function(...args) {
      try { return compute.apply(this, args) } finally { record({}, 'pipeline') }
    }
    backend.draw = function(source, ...args) {
      const result = draw.call(this, source, ...args)
      if (frame === game.frames && pending.size) {
        const group = pending.get(source.object), kinds = group?.get(source.material)
        if (kinds) {
          for (const kind of kinds) { current.unmatched[kind]--; current.draw[kind]++ }
          group!.delete(source.material)
          if (!group!.size) pending.delete(source.object)
        }
      }
      return result
    }
  }
  return {
    start() { current = row(); pending.clear(); workAtStart = shaderWorkCount() },
    result() {
      const pair = (bucket: Bucket) => current[bucket].graph+'/'+current[bucket].pipeline
      const total = Object.values(current).reduce((sum, c) => sum + c.graph + c.pipeline, 0)
      const missing = shaderWorkCount() - workAtStart - total
      return available ? [pair('draw'), pair('prep'), pair('veil'), pair('unmatched') + (missing ? ' ('+missing+' unclassified)' : '')]
        : ['?', '?', '?', (shaderWorkCount()-workAtStart)+' total']
    },
    dispose() {
      open = false; pending.clear()
      if (available) {
        backend.createNodeBuilder = builder; backend.createRenderPipeline = pipeline; backend.draw = draw
        if (compute) backend.createComputePipeline = compute
      }
    },
  }
}
