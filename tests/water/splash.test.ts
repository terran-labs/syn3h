/**
 * Splashes: a bigger hit never makes a smaller splash, no splash grows without bound, and one
 * splash can never take the whole droplet pool (the rest of the sea would stop spraying).
 */
import { describe, expect, it } from 'vitest'
import { SPLASH_MAX_IMPACT, SpraySim, splashShape, sprayCapacity } from '../../src/world/water/spraySim'

describe('entry splashes', () => {
  it('grow monotonically with impact speed and are bounded', () => {
    const keys = Object.keys(splashShape(0)) as (keyof ReturnType<typeof splashShape>)[]
    const top = splashShape(SPLASH_MAX_IMPACT)
    let previous = splashShape(0)
    for (let impact = 0; impact <= 200; impact += 0.5) {
      const shape = splashShape(impact)
      for (const k of keys) {
        expect(Number.isFinite(shape[k])).toBe(true)
        expect(shape[k]).toBeGreaterThanOrEqual(previous[k])
        expect(shape[k]).toBeLessThanOrEqual(top[k])
      }
      previous = shape
    }
    expect(splashShape(30).columnHeight).toBeGreaterThan(splashShape(3).columnHeight)
    for (const bad of [NaN, -5, Infinity]) for (const k of keys) expect(Number.isFinite(splashShape(bad)[k])).toBe(true)
  })

  it('never fills more than half the droplet pool, however hard the hit', () => {
    for (const tier of [0, 1, 2]) {
      const cap = sprayCapacity(tier)
      const sim = new SpraySim(cap)
      sim.vehicle('a', 0, 0, 0, 0, 0, 0, 0, 1 / 60)
      sim.vehicle('a', 0, 0, 0, 30, -60, 10, 1, 1 / 60, 3)
      expect(sim.dropletCount).toBeGreaterThan(0)
      expect(sim.dropletCount).toBeLessThanOrEqual(cap.droplets)
      expect(sim.lastSplash).toBeGreaterThan(30)
    }
  })

  it('splashes when a fast hull skims down flat', () => {
    const sim = new SpraySim(sprayCapacity(2))
    sim.vehicle('j', 0, 0, 0, 25, 0, 0, 0, 1 / 60)
    expect(sim.vehicle('j', 0.4, 0, 0, 25, -0.2, 0, 0.3, 1 / 60)).toBe(true)
  })
})
