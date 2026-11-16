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

// Fresh module graphs isolate the clock callbacks, fan cache and parameter registry.
// These cases must not share fake performance or clocks with concurrent tests.
describe('sea heave is the fixed-position surface height derivative', { concurrent: false }, () => {
  it.each(['phase only', 'clock transition', 'weather crossfade'] as const)('%s', async (mode) => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['performance'] })
    let restorePerformance = () => {}
    try {
      let wallMs = 0
      const wallSpy = vi.spyOn(performance, 'now').mockImplementation(() => wallMs)
      restorePerformance = () => wallSpy.mockRestore()
      const { params: isolatedParams } = await import('../../shared/params')
      const water = await import('../../src/world/water/seaWaves')
      const weather = await import('../../src/world/weather')
      const fixedParams = {
        'world.gravity': 9.81, 'world.seed': 11, 'world.lavaAltitude': 0,
        'water.waves': true, 'water.waveHeight': 1.4, 'water.waveLength': 60,
        'water.waveTurn': 0, 'weather.storminess': 0.5, 'weather.windSpeed': 16,
        'weather.gustiness': 0.5, 'weather.windDirection': 0,
      }
      for (const [id, value] of Object.entries(fixedParams)) {
        expect(isolatedParams.get(id), `registered parameter ${id}`).toBeDefined()
        isolatedParams.set(id, value, 'local')
        expect(isolatedParams.get(id)?.value).toBe(value)
      }
      // The optional terrain registry supplies this parameter; otherwise weather uses 1.
      if (isolatedParams.get('world.atmosphere')) isolatedParams.set('world.atmosphere', 1, 'local')
      expect(weather.atmosphereValue()).toBe(1)
      water.seaWaves.configure(2048, 11)
      let waterSeconds = 143
      const weatherCentre = water.FAN_SECONDS * 7.5
      let weatherSeconds = weatherCentre
      const waterClock = () => waterSeconds
      weather.setWeatherClock(() => weatherSeconds)
      water.setWaterClock(waterClock)
      wallMs = 5000 // Initial clock transition has finished.
      let wallCentre = wallMs
      if (mode === 'clock transition') {
        // Both callbacks read the same phase clock: only the smooth envelope is added.
        // Its quarter point is away from the start, midpoint clock swap and end.
        water.setWaterClock(waterClock)
        wallCentre += water.CLOCK_SWITCH_SECONDS * 1000 / 4
      }
      const setTime = (deltaSeconds: number) => {
        // Public water/weather callbacks use seconds; performance.now uses milliseconds.
        wallMs = wallCentre + deltaSeconds * 1000
        waterSeconds = 143 + deltaSeconds
        weatherSeconds = weatherCentre + (mode === 'weather crossfade' ? deltaSeconds : 0)
      }
      const height = (deltaSeconds: number) => {
        setTime(deltaSeconds)
        return water.seaWaves.offsetAt(123, -456, -50, 0)
      }
      // Differentiate exported height independently of wave components or heave code.
      // Both stencils stay inside one smooth fan interval and one envelope branch.
      const epsilon = 1e-4 // seconds
      const half = epsilon / 2
      const heights = [height(-epsilon), height(epsilon), height(-half), height(half)]
      const coarse = (heights[1] - heights[0]) / (2 * epsilon)
      const fine = (heights[3] - heights[2]) / (2 * half)
      setTime(0)
      const heave = water.seaWaves.verticalSpeedAt(123, -456, -50, 0)
      for (const value of [...heights, coarse, fine, heave]) expect(Number.isFinite(value)).toBe(true)
      const convergence = Math.abs(fine - coarse)
      // Reject an unresolved oracle instead of widening its bound to fit heave.
      // 1 micrometre/second is the independent derivative resolution requirement.
      expect(convergence).toBeLessThanOrEqual(1e-6)
      // A centred difference has leading O(h²) error at these smooth points.
      // Fine-grid error estimate is |D(h/2)-D(h)|/3; allow 4x that estimate,
      // plus a conservative floating-point subtraction/division allowance.
      const roundoff = 128 * Number.EPSILON * Math.max(1, ...heights.map(Math.abs)) / half
      const errorBound = 4 * convergence / 3 + roundoff
      expect(Math.abs(heave - fine), JSON.stringify({ mode, coarse, fine, heave, errorBound }))
        .toBeLessThanOrEqual(errorBound)
    } finally {
      // Discard the isolated registry and unobservable prior clock callbacks, rather
      // than pretending that installing a new callback restores an old one.
      try { restorePerformance() } finally {
        vi.useRealTimers()
        vi.resetModules()
      }
    }
  })
})
