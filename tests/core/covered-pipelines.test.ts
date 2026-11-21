import type { WebGPURenderer } from 'three/webgpu'
import { expect, it, vi } from 'vitest'
import { CoveredPipelines, registerCoveredComposite } from '../../src/core/coveredPipelines'

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

it('defers the final glass quad but submits intermediate texture generators during discovery', async () => {
  const submit = vi.fn()
  const create = vi.fn((_object: object, pending: Promise<void>[] | null) => {
    pending?.push(Promise.resolve())
  })
  const backend = { device: {}, createRenderPipeline: create, draw: submit }
  const renderer = { backend, _nodes: { nodeFrame: { frameId: 0 } } } as unknown as WebGPURenderer
  const batch = CoveredPipelines.forRenderer(renderer, {})!
  const quad = {}
  registerCoveredComposite({ _quadMesh: quad })
  const final = { object: quad, scene: {}, pipeline: {}, geometry: {} }
  const intermediate = { ...final, object: {} }
  batch.run(true, () => {
    for (const pass of [intermediate, final]) {
      backend.createRenderPipeline(pass, null)
      backend.draw(pass)
    }
  })
  expect(create.mock.calls[0][1]).toBeNull()
  expect(create.mock.calls[1][1]).toHaveLength(1)
  expect(submit.mock.calls).toEqual([[intermediate]])
  expect(await batch.ready()).toBe(true)
  batch.run(false, () => backend.draw(final))
  expect(submit).toHaveBeenLastCalledWith(final)
})

it('reuses only previously submitted geometry and pipelines on the same backend', () => {
  const backend = { parallel: true, draw: vi.fn(), createRenderPipeline: vi.fn() }
  const renderer = { backend, _nodes: { nodeFrame: { frameId: 1 } } } as unknown as WebGPURenderer
  const scene = {}, object = { pipeline: {}, geometry: {}, scene }
  const visit = () => {
    const batch = CoveredPipelines.forRenderer(renderer, scene)!
    batch.run(true, () => backend.draw(object))
    return batch
  }
  expect(visit().needsConfirmation).toBe(true)
  const first = visit()
  first.run(false, () => backend.draw(object))
  expect(visit().needsConfirmation).toBe(false)
  object.pipeline = {}
  expect(visit().needsConfirmation).toBe(true)
  first.run(false, () => backend.draw(object))
  object.geometry = {}
  expect(visit().needsConfirmation).toBe(true)
})

it('confirms a cold scene even when Three skips every draw until its pipeline is ready', async () => {
  const create = (_object: object, pending: Promise<void>[] | null) => pending?.push(Promise.resolve())
  const backend = { device: {}, createRenderPipeline: create, draw: vi.fn() }
  const renderer = { backend, _nodes: { nodeFrame: { frameId: 0 } } } as unknown as WebGPURenderer
  const scene = {}, mesh = { scene, object: {}, geometry: {}, pipeline: {} }
  const batch = CoveredPipelines.forRenderer(renderer, scene)!
  batch.run(true, () => backend.createRenderPipeline(mesh, null))
  expect(await batch.ready()).toBe(true)
  expect(batch.needsConfirmation).toBe(true)
  batch.run(false, () => backend.draw(mesh))
  expect(backend.draw).toHaveBeenCalledWith(mesh)
})
