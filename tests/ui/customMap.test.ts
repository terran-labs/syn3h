import { afterEach, describe, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import { PLANETS } from '../../src/world/planets'
import { paintPlanetMap, settingsForRecipe } from '../../src/world/planetMap'
import { currentTerrainSettings } from '../../src/world/terrain/settings'
import { Galaxy } from '../../src/ui/galaxy/Galaxy'

const bytes = (overrides?: Record<string, number | boolean>) => paintPlanetMap('alpine', 42, 64, 32, overrides).data

afterEach(() => vi.unstubAllGlobals())
describe('Custom planet snapshots', () => {
  it('preserves omitted overrides, accepts zero and leaves recipes unchanged', () => {
    const before = JSON.stringify(PLANETS)
    expect(bytes()).toEqual(bytes({}))
    expect(bytes({ 'world.seaKind': 0 })).not.toEqual(bytes({ 'world.seaKind': 1 }))
    expect(settingsForRecipe({ ...PLANETS[0], values: { ...PLANETS[0].values, 'terrain.volcanoHeight': 0 } }).volcanoHeight).toBe(0)
    expect(JSON.stringify(PLANETS)).toBe(before)
  })
  it('uses the same terrain settings as the sanitized registry snapshot', () => {
    const saved = params.snapshot('world')
    try {
      params.set('terrain.volcanoHeight', 999999)
      params.set('terrain.treeCover', 0)
      const snapshot = params.snapshot('world')
      expect(snapshot['terrain.volcanoHeight']).toBeLessThan(999999)
      expect(settingsForRecipe({ ...PLANETS[0], values: { ...PLANETS[0].values, ...snapshot } })).toEqual(currentTerrainSettings())
    } finally { params.applySnapshot(saved) }
  })
  it('forwards snapshots, refreshes cache identity and rejects stale worker results', () => {
    const workers: FakeWorker[] = []
    class FakeWorker {
      onmessage?: (event: { data: unknown }) => void
      onerror?: () => void
      jobs: any[] = []
      constructor() { workers.push(this) }
      postMessage(job: unknown) { this.jobs.push(job) }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const world = { id: 'custom', seed: 7, forming: true }
    const g: any = Object.assign(Object.create(Galaxy.prototype), {
      options: { worlds: [world] }, maps: new Map(), queue: [], worker: null,
      painting: false, active: true, chosen: -1,
    })
    g.updateCustom('alpine', 42, { 'terrain.treeCover': 0 })
    const worker = workers[0], first = worker.jobs[0]
    expect(first.overrides).toEqual({ 'terrain.treeCover': 0 })
    g.updateCustom('alpine', 42, { 'terrain.treeCover': 0.5 })
    g.updateCustom('alpine', 42, { 'terrain.treeCover': 0.8 })
    expect(g.queue).toHaveLength(1)
    worker.onmessage!({ data: { ...first, data: new Uint8ClampedArray(4) } })
    expect(g.maps.has(first.key)).toBe(false)
    const latest = worker.jobs[1]
    expect(latest.key).not.toBe(first.key)
    expect(latest.overrides['terrain.treeCover']).toBe(0.8)
    worker.onmessage!({ data: { ...latest, data: new Uint8ClampedArray(4) } })
    expect(g.maps.has(latest.key)).toBe(true)
    g.updateCustom('alpine', 42, { 'terrain.treeCover': 0.9 })
    expect(g.maps.has(latest.key)).toBe(false)
    // A terminated worker cannot supply a result into the next generation's cache.
    worker.onmessage!({ data: { ...latest, data: new Uint8ClampedArray(4) } })
    expect(g.maps.has(latest.key)).toBe(false)
  })
})
