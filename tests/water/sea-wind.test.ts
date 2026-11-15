import { describe, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import { FAN_SECONDS, seaWaves, setWaterClock } from '../../src/world/water/seaWaves'
import { setWeatherClock } from '../../src/world/weather'

describe('sea following the prevailing wind', () => {
  it('never steps: the surface is continuous across a change of wave fans', () => {
    params.set('water.waves', true, 'local')
    seaWaves.configure(2048, 11)
    let t = 0
    setWeatherClock(() => t)
    vi.useFakeTimers({ toFake: ['performance'] })
    setWaterClock(() => t)
    // Past the calm that eases in a clock change.
    vi.advanceTimersByTime(5000)
    const at = (time: number) => { t = time; return seaWaves.offsetAt(123, -456, -50, 0) }
    for (const boundary of [FAN_SECONDS * 7, FAN_SECONDS * 8]) {
      const before = at(boundary - 1e-3)
      const after = at(boundary + 1e-3)
      expect(Math.abs(before)).toBeGreaterThan(1e-4)
      expect(Math.abs(after - before)).toBeLessThan(0.01)
    }
    params.set('water.waves', false, 'local')
    vi.useRealTimers()
  })
})
