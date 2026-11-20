import type { WebGPURenderer } from 'three/webgpu'
import { expect, it, vi } from 'vitest'
import { CoveredPipelines } from '../../src/core/coveredPipelines'

it('issues both pending pipelines before confirmation and restores normal draws after a failure', async () => {
  const finish: (() => void)[] = []
  const submit = vi.fn()
  const create = vi.fn((_object: object, pending: Promise<void>[] | null) => {
    pending!.push(new Promise<void>(resolve => finish.push(resolve)))
  })
  const clock = { frameId: 10 }
  const backend = { device: {}, createRenderPipeline: create, draw: submit }
  const renderer = { backend, _nodes: { nodeFrame: clock } } as unknown as WebGPURenderer
  const scene = {}
  const batch = CoveredPipelines.forRenderer(renderer, scene)!
  const variants = [1, 2].map(() => ({ pipeline: {}, geometry: {}, scene }))
  for (const variant of variants) batch.run(true, () => {
    backend.createRenderPipeline(variant, null)
    backend.draw(variant)
  })
  expect(finish).toHaveLength(2)
  expect(submit).not.toHaveBeenCalled()
  const ready = batch.ready()
  finish.forEach(resolve => resolve())
  expect(await ready).toBe(true)
  expect(() => batch.run(false, () => {
    for (const variant of variants) { backend.draw(variant); backend.draw(variant) }
    throw new Error('failed effect')
  })).toThrow('failed effect')
  expect(submit).toHaveBeenCalledTimes(2)
  expect(backend.createRenderPipeline).toBe(create)
  expect(backend.draw).toBe(submit)
  backend.draw(variants[0])
  expect(submit).toHaveBeenCalledTimes(3)
})
