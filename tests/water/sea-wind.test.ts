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
      weather.setWeatherClock(() => weatherSeconds, () => mode === 'weather crossfade' ? 1 : 0)
      water.setWaterClock(waterClock, () => 1)
      wallMs = 5000 // Initial clock transition has finished.
      let wallCentre = wallMs
      if (mode === 'clock transition') {
        // Both callbacks read the same phase clock: only the smooth envelope is added.
        // Its quarter point is away from the start, midpoint clock swap and end.
        water.setWaterClock(waterClock, () => 1)
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

// Additional regressions share setup only; the original four cases above keep their oracle.
async function withRateFixture(run: (f: {
  water: typeof import('../../src/world/water/seaWaves')
  weather: typeof import('../../src/world/weather')
  registry: typeof params
  wallSpy: ReturnType<typeof vi.spyOn>
  at: (seconds: number) => void
}) => void | Promise<void>) {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['performance'] })
  let restore = () => {}
  try {
    let seconds = 0
    const wallSpy = vi.spyOn(performance, 'now').mockImplementation(() => seconds * 1000)
    restore = () => wallSpy.mockRestore()
    const { params: registry } = await import('../../shared/params')
    const water = await import('../../src/world/water/seaWaves')
    const weather = await import('../../src/world/weather')
    for (const [id, value] of Object.entries({
      'world.gravity': 9.81, 'world.seed': 11, 'world.lavaAltitude': 0,
      'water.waves': true, 'water.waveHeight': 1.4, 'water.waveLength': 60,
      'water.waveTurn': 0, 'weather.storminess': 0.5, 'weather.windSpeed': 16,
      'weather.gustiness': 0.5, 'weather.windDirection': 0,
    })) registry.set(id, value, 'local')
    if (registry.get('world.atmosphere')) registry.set('world.atmosphere', 1, 'local')
    water.seaWaves.configure(2048, 11)
    await run({ water, weather, registry, wallSpy, at: t => { seconds = t } })
  } finally {
    try { restore() } finally { vi.useRealTimers(); vi.resetModules() }
  }
}

function expectSmoothDerivative(height: (dt: number) => number, speed: () => number) {
  const h = 1e-4
  const values = [height(-h), height(h), height(-h / 2), height(h / 2)]
  const coarse = (values[1] - values[0]) / (2 * h)
  const fine = (values[3] - values[2]) / h
  height(0)
  const actual = speed()
  for (const n of [...values, coarse, fine, actual]) expect(Number.isFinite(n)).toBe(true)
  const convergence = Math.abs(fine - coarse)
  expect(convergence).toBeLessThanOrEqual(1e-6)
  const roundoff = 128 * Number.EPSILON * Math.max(1, ...values.map(Math.abs)) / (h / 2)
  expect(Math.abs(actual - fine)).toBeLessThanOrEqual(4 * convergence / 3 + roundoff)
}

describe('declared sea clock rates and boundaries', { concurrent: false }, () => {
  it.each([[0, 0], [0, 1], [2, 0], [0.5, 2]])('phase rate %s and weather rate %s', async (phaseRate, fanRate) => {
    await withRateFixture(({ water, weather, at }) => {
      let delta = 0
      water.setWaterClock(() => 143 + phaseRate * delta, () => phaseRate)
      weather.setWeatherClock(() => 150 + fanRate * delta, () => fanRate)
      expectSmoothDerivative(dt => {
        delta = dt; at(5 + dt)
        return water.seaWaves.offsetAt(123, -456, -50, 0)
      }, () => water.seaWaves.verticalSpeedAt(123, -456, -50, 0))
    })
  })

  it('pairs old and new phase rates and retains motion when phase is paused', async () => {
    await withRateFixture(({ water, weather, at }) => {
      let delta = 0
      water.setWaterClock(() => 143 + 2 * delta, () => 2)
      weather.setWeatherClock(() => 150 + delta, () => 1)
      at(5)
      water.setWaterClock(() => 207, () => 0)
      // Old advancing phase on descent, new paused phase on ascent. Weather and wall move.
      for (const centre of [5.3, 5.9]) {
        expectSmoothDerivative(dt => {
          delta = dt; at(centre + dt)
          return water.seaWaves.offsetAt(123, -456, -50, 0)
        }, () => water.seaWaves.verticalSpeedAt(123, -456, -50, 0))
      }
    })
  })

  it('declares the initial constant water clock as zero and omitted rates as one', async () => {
    await withRateFixture(({ water, weather, at }) => {
      weather.setWeatherClock(() => 150, () => 0)
      at(5)
      expect(water.seaWaves.verticalSpeedAt(123, -456, -50, 0)).toBe(0)
      let delta = 0
      water.setWaterClock(() => 143 + delta)
      weather.setWeatherClock(() => 150 + delta)
      expectSmoothDerivative(dt => {
        delta = dt; at(10 + dt)
        return water.seaWaves.offsetAt(123, -456, -50, 0)
      }, () => water.seaWaves.verticalSpeedAt(123, -456, -50, 0))
    })
  })

  it('samples each applicable clock and rate once and preserves fixed-input height and caches', async () => {
    await withRateFixture(async ({ water, weather, at, wallSpy }) => {
      const phase = vi.fn(() => 143), phaseRate = vi.fn(() => 1)
      const fan = vi.fn(() => 150), fanRate = vi.fn(() => 1)
      water.setWaterClock(phase, phaseRate)
      weather.setWeatherClock(fan, fanRate)
      at(5)
      const { waveOffset, shoalFactor } = await import('../../shared/water/waves')
      const set = water.seaWaves.waves
      const phases = water.seaWaves.phasesNow()
      // Original height expression at fixed inputs, including the geometric mask.
      const legacyHeight = water.waveScale() * shoalFactor(50, set.dominantLength) * waveOffset(set, phases, 123, -456)
      for (const { query, rateCalls } of [
        { query: () => water.seaWaves.offsetAt(123, -456, -50, 0), rateCalls: 0 },
        { query: () => water.seaWaves.verticalSpeedAt(123, -456, -50, 0), rateCalls: 1 },
        { query: () => water.seaWaves.slopeAt(123, -456), rateCalls: 0 },
        { query: () => water.seaWaves.phasesNow(), rateCalls: 0 },
      ]) {
        for (const spy of [wallSpy, phase, phaseRate, fan, fanRate]) spy.mockClear()
        query()
        expect(wallSpy).toHaveBeenCalledTimes(1)
        expect(phase).toHaveBeenCalledTimes(1)
        expect(fan).toHaveBeenCalledTimes(1)
        // Rate metadata is needed only by the speed query, never inferred from values.
        expect(phaseRate).toHaveBeenCalledTimes(rateCalls)
        expect(fanRate).toHaveBeenCalledTimes(rateCalls)
      }
      expect(water.seaWaves.offsetAt(123, -456, -50, 0)).toBe(legacyHeight)
      expect(water.seaWaves.waves).toBe(set)
      expect(water.seaWaves.phasesNow()).toBe(phases)
    })
  })

  it('has continuous speed at envelope endpoints and fan boundaries', async () => {
    await withRateFixture(({ water, weather, at }) => {
      let delta = 0, weatherCentre = 150
      water.setWaterClock(() => 143 + 2 * delta, () => 2)
      weather.setWeatherClock(() => weatherCentre + delta, () => 1)
      at(5)
      water.setWaterClock(() => 207 + 0.5 * delta, () => 0.5)
      const h = 1e-5, half = water.CLOCK_SWITCH_SECONDS / 2
      // For each fan sum|a| <= height/2; wind and shoaling <=1. Geometric waves
      // have k <= 2pi/minLength. These bound H'' on EACH side, including the C1
      // but generally not C2 midpoint; no centred Richardson assumption there.
      const amplitude = 1.4 / 2
      const omega = Math.sqrt(9.81 * 2 * Math.PI / (4 * 2048 / water.SEA_GRID))
      const maxPhaseRate = 2, T = water.FAN_SECONDS
      const m1 = amplitude * omega * maxPhaseRate + 2 * amplitude * 1.5 / T
      const m2 = amplitude * omega ** 2 * maxPhaseRate ** 2
        + 4 * amplitude * 1.5 / T * omega * maxPhaseRate + 2 * amplitude * 6 / T ** 2
      const curvatureBound = 6 / half ** 2 * amplitude + 2 * 1.5 / half * m1 + m2
      const roundoff = 128 * Number.EPSILON / h
      for (const [wallCentre, fanCentre] of [[5, 150], [5 + half, 150], [5 + 2 * half, 150], [10, 140], [10, 160]]) {
        weatherCentre = fanCentre
        const sample = (dt: number) => {
          delta = dt; at(wallCentre + dt)
          return { height: water.seaWaves.offsetAt(123, -456, -50, 0), speed: water.seaWaves.verticalSpeedAt(123, -456, -50, 0) }
        }
        const left = sample(-h), mid = sample(0), right = sample(h)
        for (const n of [left.height, mid.height, right.height, left.speed, mid.speed, right.speed]) expect(Number.isFinite(n)).toBe(true)
        // A one-sided first difference differs from H' by at most sup|H''|*h/2.
        for (const derivative of [(mid.height - left.height) / h, (right.height - mid.height) / h]) {
          expect(Math.abs(derivative - mid.speed)).toBeLessThanOrEqual(curvatureBound * h / 2 + roundoff)
        }
        expect(Math.abs(left.speed - right.speed)).toBeLessThanOrEqual(2 * curvatureBound * h + roundoff)
        if (wallCentre === 5 + half) {
          // H and H' vanish analytically at the switch despite different phase values.
          expect(Math.abs(mid.height)).toBeLessThanOrEqual(roundoff)
          expect(Math.abs(mid.speed)).toBeLessThanOrEqual(roundoff)
        }
      }
    })
  })

  it.each(['disabled', 'zero height'])('returns finite zero for %s through the envelope', async (mode) => {
    await withRateFixture(({ water, weather, registry, at }) => {
      water.setWaterClock(() => 143, () => 1)
      weather.setWeatherClock(() => 150, () => 1)
      at(5)
      water.setWaterClock(() => 207, () => 2)
      registry.set(mode === 'disabled' ? 'water.waves' : 'water.waveHeight', mode === 'disabled' ? false : 0, 'local')
      for (const t of [5, 5.3, 5.6, 5.9, 6.2, 10]) {
        at(t)
        expect(water.seaWaves.offsetAt(123, -456, -50, 0)).toBe(0)
        expect(water.seaWaves.verticalSpeedAt(123, -456, -50, 0)).toBe(0)
      }
    })
  })
})
