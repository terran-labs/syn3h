import { describe, expect, it, afterEach } from 'vitest'
import { beginLoad, classifyDevice, finishLoad, FrameBudgetMonitor, graphicsLevel, LOAD_KEY, qualityBudget } from '../../src/core/quality'
import { Scene } from 'three/webgpu'
import { Emitters } from '../../src/fx/Emitters'
import { params } from '../../shared/params'
const desktop = { userAgent: 'Macintosh Chrome', touchPoints: 0, memoryGB: 8, adapter: 'available' as const }
afterEach(() => params.set(graphicsLevel.def.id, 2))
describe('device quality', () => {
  it('classifies desktops, touch iPads, low memory devices and fallback adapters', () => {
    expect(classifyDevice(desktop)).toBe(2)
    expect(classifyDevice({ ...desktop, touchPoints: 5 })).toBe(1)
    expect(classifyDevice({ ...desktop, userAgent: 'Android', memoryGB: 4 })).toBe(1)
    expect(classifyDevice({ ...desktop, userAgent: 'iPhone', adapter: 'missing' })).toBe(0)
    expect(classifyDevice({ ...desktop, memoryGB: 2 })).toBe(0)
    expect(classifyDevice({ ...desktop, adapter: 'fallback' })).toBe(0)
    expect(classifyDevice({ ...desktop, adapter: 'missing' })).toBe(1)
  })
  it('steps down repeated interrupted loads, then clears the pending marker', () => {
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) } }
    expect(beginLoad(storage, 2)).toBe(2)
    expect(beginLoad(storage, 2)).toBe(1)
    expect(beginLoad(storage, 2)).toBe(0)
    finishLoad(storage); expect(entries.has(LOAD_KEY)).toBe(false)
    expect(beginLoad(storage, 2)).toBe(2)
  })
  it('works when browser storage is disabled', () => {
    const unavailable = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(beginLoad(unavailable, 1)).toBe(1); expect(() => finishLoad(unavailable)).not.toThrow()
  })
  it('caps actual vent instances and rebuilds only when the budget changes', () => {
    const emitters = new Emitters(new Scene())
    for (let i = 0; i < 50; i++) emitters.addVent({ x: i, y: 0, z: 0 }, { kind: 'embers', radius: 1, height: 5, intensity: 1 })
    emitters.update(0); expect(emitters.particleCount).toBe(2400)
    params.set('gfx.level', 0); emitters.update(0); expect(emitters.particleCount).toBe(200)
    emitters.update(0.1); expect(emitters.particleCount).toBe(200)
    emitters.clear(); expect(emitters.particleCount).toBe(0)
  })
  it('reduces local particle and bot budgets with graphics level', () => {
    params.set('gfx.level', 0); expect(qualityBudget().particles).toBe(240); expect(qualityBudget().bots).toBe(2)
    params.set('gfx.level', 1); expect(qualityBudget().pixelRatio).toBe(1); expect(qualityBudget().bots).toBe(4)
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
