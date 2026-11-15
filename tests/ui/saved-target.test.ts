import { afterEach, expect, it, vi } from 'vitest'
import { Galaxy } from '../../src/ui/galaxy/Galaxy'
afterEach(() => vi.unstubAllGlobals())
it('restores the recipe slot and Custom cache after a saved flight and rejects late paint', () => {
  const workers: any[] = []
  class Worker {
    onmessage?: (event: any) => void
    jobs: any[] = []
    constructor() { workers.push(this) }
    postMessage(job: unknown) { this.jobs.push(job) }
    terminate() {}
  }
  vi.stubGlobal('Worker', Worker)
  const parent = { id: 'alpine', seed: 4, land: 1, sea: 2, glow: false }
  const custom = { id: 'custom', seed: 7, recipe: 'desert', overrides: { 'world.seaKind': 0 }, mapVariant: 'custom-current' }
  const original = structuredClone(parent), customBefore = structuredClone(custom), cache = { data: new Uint8Array([4]) }
  const g: any = Object.assign(Object.create(Galaxy.prototype), {
    options: { worlds: [parent, custom] }, maps: new Map([['custom:retained:1024', cache]]), queue: [], worker: null,
    painting: false, active: true, chosen: -1, layers: ['old'], closeKey: 'custom:retained:1024',
  })
  const release = g.savedWorldTarget('alpine', 99, { 'world.seaKind': 1 }, 'saved-id')
  expect(parent.seed).toBe(99)
  const worker = workers[0], obsolete = worker.jobs[0]
  expect(obsolete.overrides).toEqual({ 'world.seaKind': 1 })
  release(); release()
  expect(parent).toEqual(original); expect(custom).toEqual(customBefore)
  expect(g.maps.get('custom:retained:1024')).toBe(cache)
  worker.onmessage({ data: { ...obsolete, data: new Uint8ClampedArray(4) } })
  expect(g.maps.has(obsolete.key)).toBe(false)
  expect(g.queue.every((job: any) => !job.key.includes('saved-id'))).toBe(true)
  expect(g.savedTarget).toBe(false)
})
