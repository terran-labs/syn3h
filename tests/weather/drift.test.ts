/** Clouds and particles follow the wind (src/world/weather/clouds.ts and windDrift). */
import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { advanceCloudDrift, currentWindFrame, setWeatherClock, storminess, windAt, windDrift, windHeading } from '../../src/world/weather'
import '../../src/world/terrain/settings'

const T = 1_794_700_000
afterEach(() => { params.set(storminess.def.id, storminess.def.default); params.set('world.atmosphere', 1); setWeatherClock(() => Date.now() / 1000) })

describe('cloud drift', () => {
  it('keeps today\'s speed at storminess 0, pointed downwind', () => {
    setWeatherClock(() => T)
    params.set(storminess.def.id, 0)
    const o = { x: 0, y: 0 }
    advanceCloudDrift(o, 0.00002, 10)
    // Today: 0.00002 per second on each axis.
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(Math.hypot(0.0002, 0.0002), 12)
    const a = windHeading(currentWindFrame(null), T)
    expect(-o.x / Math.hypot(o.x, o.y)).toBeCloseTo(Math.cos(a), 9)
    expect(-o.y / Math.hypot(o.x, o.y)).toBeCloseTo(Math.sin(a), 9)
  })

  it('moves faster in a storm', () => {
    setWeatherClock(() => T)
    const calm = { x: 0, y: 0 }, gale = { x: 0, y: 0 }
    params.set(storminess.def.id, 0); advanceCloudDrift(calm, 0.00002, 1)
    params.set(storminess.def.id, 1); advanceCloudDrift(gale, 0.00002, 1)
    expect(Math.hypot(gale.x, gale.y)).toBeCloseTo(3 * Math.hypot(calm.x, calm.y), 12)
  })

  it('moves exactly as before on an airless world', () => {
    params.set('world.atmosphere', 0)
    const o = { x: 0, y: 0 }
    advanceCloudDrift(o, 0.00002, 10)
    expect(o.x).toBeCloseTo(0.0002, 15); expect(o.y).toBeCloseTo(0.0002, 15)
  })
})

describe('windDrift', () => {
  it('is the wind at that place and time', () => {
    setWeatherClock(() => T)
    const a = windDrift(100, 300, -50, { x: 0, y: 0, z: 0 })
    const b = windAt(currentWindFrame(null), 100, 300, -50, T, { x: 0, y: 0, z: 0 })
    expect(a).toEqual(b)
    expect(Math.hypot(a.x, a.z)).toBeGreaterThan(0)
  })
})

import { prevailingWindHeading, prevailingWindStrength } from '../../src/world/weather'

describe('prevailing wind', () => {
  it('turns slowly and is zero strength without air', () => {
    let max = 0
    for (let i = 1; i < 600; i++) max = Math.max(max, Math.abs(prevailingWindHeading(T + i) - prevailingWindHeading(T + i - 1)))
    expect(max).toBeLessThan(0.02)
    expect(prevailingWindStrength()).toBeGreaterThan(0.2)
    params.set('world.atmosphere', 0)
    expect(prevailingWindStrength()).toBe(0)
  })
})
