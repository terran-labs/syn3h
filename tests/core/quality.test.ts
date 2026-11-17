import { PARTICLE_SHARES, particleBudget } from '../../src/fx/params'
import { describe, expect, it, afterEach } from 'vitest'
import { assessCapability, beginLoad, finishLoad, FrameBudgetMonitor, graphicsLevel, LOAD_KEY, qualityBudget, qualityLevel } from '../../src/core/quality'
import { Scene } from 'three/webgpu'
import { Emitters } from '../../src/fx/Emitters'
import { params } from '../../shared/params'
const capable = { memoryGB: 8, adapter: 'available' as const, maxTextureDimension2D: 16384 }
afterEach(() => params.set(qualityLevel.def.id, 4))
describe('device quality', () => {
  it('judges what the graphics stack can do, never what kind of device it is', () => {
    expect(assessCapability(capable)).toEqual({ start: 3, ceiling: 5 })
    // Unknown memory (Safari reports none) is not a reason to hold a device back.
    expect(assessCapability({ adapter: 'available', maxTextureDimension2D: 16384 })).toEqual({ start: 3, ceiling: 5 })
    expect(assessCapability({ ...capable, memoryGB: 2 })).toEqual({ start: 2, ceiling: 5 })
    expect(assessCapability({ ...capable, maxTextureDimension2D: 4096 })).toEqual({ start: 2, ceiling: 5 })
    // No WebGPU adapter means the WebGL 2 path; a software adapter starts at the bottom.
    expect(assessCapability({ ...capable, adapter: 'missing' })).toEqual({ start: 2, ceiling: 2 })
    expect(assessCapability({ ...capable, adapter: 'fallback' })).toEqual({ start: 0, ceiling: 2 })
    // The inputs carry no user agent or touch count, so a phone and a desktop with the same stack get the same answer.
    expect(Object.keys(capable).sort()).toEqual(['adapter', 'maxTextureDimension2D', 'memoryGB'])
  })
  it('steps down repeated interrupted loads, then clears the pending marker', () => {
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) } }
    expect(beginLoad(storage, 5)).toBe(5)
    expect(beginLoad(storage, 5)).toBe(4)
    expect(beginLoad(storage, 5)).toBe(3)
    expect(beginLoad(storage, 2)).toBe(2)
    for (const expected of [1, 0, 0]) expect(beginLoad(storage, 5)).toBe(expected)
    finishLoad(storage); expect(entries.has(LOAD_KEY)).toBe(false)
    expect(beginLoad(storage, 5)).toBe(5)
  })
  it('works when browser storage is disabled', () => {
    const unavailable = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(beginLoad(unavailable, 1)).toBe(1); expect(() => finishLoad(unavailable)).not.toThrow()
  })
  it('caps actual vent instances and rebuilds only when the budget changes', () => {
    const emitters = new Emitters(new Scene())
    for (let i = 0; i < 50; i++) emitters.addVent({ x: i, y: 0, z: 0 }, { kind: 'embers', radius: 1, height: 5, intensity: 1 })
    const cap = () => Math.floor(Math.min(particleBudget.value, qualityBudget().particles) * PARTICLE_SHARES.vents)
    emitters.update(0); const high = emitters.particleCount
    expect(high).toBeGreaterThan(0); expect(high).toBeLessThanOrEqual(cap())
    params.set('gfx.level', 0); emitters.update(0); const low = emitters.particleCount
    expect(low).toBeLessThan(high); expect(low).toBeLessThanOrEqual(cap())
    emitters.update(0.1); expect(emitters.particleCount).toBe(low)
    emitters.clear(); expect(emitters.particleCount).toBe(0)
  })
  it('reduces local particle and bot budgets with graphics level', () => {
    params.set('gfx.quality', 0); expect(qualityBudget().particles).toBe(240); expect(qualityBudget().bots).toBe(2)
    params.set('gfx.quality', 2); expect(qualityBudget().pixelRatio).toBe(1); expect(qualityBudget().bots).toBe(4)
    params.set('gfx.quality', 5); expect(qualityBudget().name).toBe('Cinematic'); expect(qualityBudget().bots).toBe(16)
  })
  it('keeps the older three-step value in step with the level, both ways', () => {
    for (const [level, older] of [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2]]) { params.set('gfx.quality', level); expect(graphicsLevel.value).toBe(older) }
    // Code that still sets the older value lands on the level with the same budget as before.
    for (const [older, level] of [[0, 0], [1, 2], [2, 4]]) { params.set('gfx.quality', 5); params.set('gfx.level', older); expect(qualityLevel.value).toBe(older === 2 ? 5 : level) }
  })
})
describe('sustained frame pressure', () => {
  it('steps down sustained 45 fps at the desktop target but not the mobile target', () => {
    const desktop = new FrameBudgetMonitor(), mobile = new FrameBudgetMonitor()
    let desktopDrops = 0, mobileDrops = 0
    for (let i = 0; i < 900; i++) {
      if (desktop.sample(1000 / 45, true, 54)) desktopDrops++
      if (mobile.sample(1000 / 45, true, 28)) mobileDrops++
    }
    expect(desktopDrops).toBe(1); expect(mobileDrops).toBe(0)
  })
  it('ignores warmup, short spikes and hidden tabs, then steps down once for sustained pressure', () => {
    const monitor = new FrameBudgetMonitor()
    let drops = 0
    for (let i = 0; i < 500; i++) if (monitor.sample(100, false)) drops++
    for (let i = 0; i < 300; i++) if (monitor.sample(1000 / 60)) drops++
    for (let i = 0; i < 30; i++) if (monitor.sample(100)) drops++
    expect(drops).toBe(0)
    for (let i = 0; i < 60; i++) if (monitor.sample(100)) drops++
    expect(drops).toBe(1)
    for (let i = 0; i < 100; i++) if (monitor.sample(100)) drops++
    expect(drops).toBe(1)
  })
})
