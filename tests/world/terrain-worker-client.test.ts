import { describe, expect, it } from 'vitest'
import { requestTerrain, type TerrainWorkerLike } from '../../src/world/terrain/terrainWorkerClient'
import type { TerrainSettings } from '../../src/world/terrain/settings'

/**
 * Entering a world must never wait on a terrain worker that cannot help: each failure ends in
 * an answer, so the world is generated on the main thread and the dive lands.
 */
function fakeWorker(answer: (post: (type: 'message' | 'error' | 'messageerror', event: Event) => void, message: { key: string }) => void): TerrainWorkerLike & { listeners: number } {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const emit = (type: string, event: Event) => { for (const l of [...(listeners.get(type) ?? [])]) l(event) }
  return {
    get listeners() { let n = 0; for (const set of listeners.values()) n += set.size; return n },
    postMessage(message: unknown) { answer(emit, message as { key: string }) },
    addEventListener(type, l) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(l) },
    removeEventListener(type, l) { listeners.get(type)?.delete(l) },
  }
}
const settings = {} as TerrainSettings
const reply = (data: unknown) => ({ data } as MessageEvent)

describe('the terrain worker client', () => {
  it('returns the worker\'s heights when it answers', async () => {
    const heights = { heights: new Float32Array(4) }
    const worker = fakeWorker((emit, m) => queueMicrotask(() => emit('message', reply({ key: m.key, data: heights, seam: 1, ms: 9 }))))
    const result = await requestTerrain(worker, 'a', 1, settings)
    expect(result).toEqual({ data: heights, seam: 1, ms: 9 })
    expect(worker.listeners).toBe(0)
  })

  it('falls back when the worker reports an error, and keeps the worker', async () => {
    const worker = fakeWorker((emit, m) => queueMicrotask(() => emit('message', reply({ key: m.key, error: 'boom' }))))
    expect(await requestTerrain(worker, 'a', 1, settings)).toEqual({ failed: 'boom' })
  })

  it('gives the worker up when it fails to load (a blocked or missing script)', async () => {
    const worker = fakeWorker(emit => queueMicrotask(() => emit('error', new Event('error'))))
    expect(await requestTerrain(worker, 'a', 1, settings)).toHaveProperty('broken')
    expect(worker.listeners).toBe(0)
  })

  it('gives the worker up when it never answers, instead of holding the world', async () => {
    const worker = fakeWorker(() => {})
    const result = await requestTerrain(worker, 'a', 1, settings, 20)
    expect(result).toEqual({ broken: 'no answer in 20 ms' })
    expect(worker.listeners).toBe(0)
  })

  it('ignores answers for other worlds', async () => {
    const worker = fakeWorker((emit, m) => queueMicrotask(() => { emit('message', reply({ key: 'other', error: 'x' })); emit('message', reply({ key: m.key, error: 'mine' })) }))
    expect(await requestTerrain(worker, 'a', 1, settings)).toEqual({ failed: 'mine' })
  })
})
