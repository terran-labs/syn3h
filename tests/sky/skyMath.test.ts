import { describe, expect, it } from 'vitest'
import {
  EARTH_RAYLEIGH, horizonColors, moonAmount, nightAmount, sanitizeRGB, skyRadiance,
  sunDirection, sunlightColor, wrapHour, type RGB, type SkyParams, type Vec3,
} from '../../src/world/sky/skyMath'
import { SKY_PRESETS } from '../../src/world/sky/presets'

const earth: SkyParams = {
  rayleighColor: [...EARTH_RAYLEIGH], rayleigh: 1, turbidity: 2,
  mieCoefficient: 0.005, mieDirectionalG: 0.8, nightBrightness: 1,
}

const expectFiniteInRange = (c: RGB, max: number) => {
  for (const v of c) {
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(max)
  }
}

describe('sunDirection', () => {
  it('is a unit vector at every hour, tilt and azimuth', () => {
    for (let h = 0; h <= 24; h += 1.5) {
      for (const tilt of [0, 20, 45, 80]) {
        for (const az of [0, 90, 237]) {
          const d = sunDirection(h, tilt, az)
          expect(Math.hypot(...d)).toBeCloseTo(1, 9)
        }
      }
    }
  })

  it('puts noon high and midnight below the horizon', () => {
    for (const tilt of [0, 25, 60, 80]) {
      const noon = sunDirection(12, tilt)
      const midnight = sunDirection(0, tilt)
      expect(noon[1]).toBeCloseTo(Math.cos((tilt * Math.PI) / 180), 9)
      expect(noon[1]).toBeGreaterThan(0.15)
      expect(midnight[1]).toBeLessThan(-0.15)
    }
    expect(sunDirection(12, 0)[1]).toBeCloseTo(1, 9)
  })

  it('rises in the east and sets in the west', () => {
    const dawn = sunDirection(6, 30)
    const dusk = sunDirection(18, 30)
    expect(dawn[1]).toBeCloseTo(0, 9)
    expect(dusk[1]).toBeCloseTo(0, 9)
    expect(dawn[0]).toBeCloseTo(1, 9)
    expect(dusk[0]).toBeCloseTo(-1, 9)
    expect(sunDirection(9, 30)[1]).toBeGreaterThan(0)
    expect(sunDirection(21, 30)[1]).toBeLessThan(0)
  })

  it('leans the noon sun toward the south for a northern tilt', () => {
    expect(sunDirection(12, 40)[2]).toBeGreaterThan(0)
  })

  it('azimuth rotates about Y without changing elevation', () => {
    const a = sunDirection(15, 30, 0)
    const b = sunDirection(15, 30, 90)
    expect(b[1]).toBeCloseTo(a[1], 9)
    expect(Math.hypot(b[0], b[2])).toBeCloseTo(Math.hypot(a[0], a[2]), 9)
  })
})

describe('time of day', () => {
  it('wraps and survives bad input', () => {
    expect(wrapHour(-1)).toBe(23)
    expect(wrapHour(Number.POSITIVE_INFINITY)).toBe(12)
  })
})

describe('colour helpers', () => {
  const presets: SkyParams[] = [earth, ...Object.values(SKY_PRESETS).map((p) => ({
    rayleighColor: [p['sky.rayleighR'], p['sky.rayleighG'], p['sky.rayleighB']] as RGB,
    rayleigh: p['sky.rayleigh'], turbidity: p['sky.turbidity'], mieCoefficient: p['sky.mieCoefficient'],
    mieDirectionalG: p['sky.mieDirectionalG'], nightBrightness: p['sky.nightBrightness'],
  }))]
  const extremes: SkyParams[] = [
    { ...earth, rayleighColor: [0, 0, 0], mieCoefficient: 0 },
    { ...earth, rayleighColor: [80, 80, 80], rayleigh: 4, turbidity: 20, mieCoefficient: 0.1, mieDirectionalG: 0.999 },
    { ...earth, rayleighColor: [80, 0, 0], rayleigh: 0, mieDirectionalG: 0 },
  ]

  it('stay finite and in range for every hour and preset', () => {
    for (const p of [...presets, ...extremes]) {
      for (let h = 0; h < 24; h += 0.25) {
        const sun = sunDirection(h, 25)
        const hc = horizonColors(sun, p)
        for (const c of [hc.toward, hc.away, hc.side, hc.mean, hc.zenith]) expectFiniteInRange(c, 1e4)
        expectFiniteInRange(sunlightColor(sun, p), 1.0001)
        for (const dir of [[0, -1, 0], [0.6, 0.8, 0]] as Vec3[]) expectFiniteInRange(skyRadiance(dir, sun, p), 1e4)
        // Straight at the sun with g near 1 the Mie lobe is enormous by design; it must stay finite.
        expectFiniteInRange(skyRadiance(sun, sun, p), 1e12)
      }
    }
  })

  it('make Earth blue at noon and the sun redder at sunset', () => {
    const zen = skyRadiance([0, 1, 0], sunDirection(12, 20), earth)
    expect(zen[2]).toBeGreaterThan(zen[0])
    const sunset = sunlightColor(sunDirection(17.8, 20), earth)
    expect(sunset[0]).toBeGreaterThan(sunset[2] * 2)
    const noon = sunlightColor(sunDirection(12, 0), earth)
    expect(noon[0]).toBeGreaterThan(0.8)
  })

  // The sunset's own hue is graded at a low sun (skyMath gradeGlow), so only the day sky is pinned.
  it('give a red scattering sky a red day sky', () => {
    const mars: SkyParams = { ...earth, rayleighColor: [30, 14, 5] }
    const zen = skyRadiance([0, 1, 0], sunDirection(12, 20), mars)
    expect(zen[0]).toBeGreaterThan(zen[2])
  })

  it('darkens the sky at night and hands over to the moon', () => {
    const day = skyRadiance([0, 1, 0], sunDirection(12, 20), earth)
    const night = skyRadiance([0, 1, 0], sunDirection(0, 20), earth)
    expect(night[2]).toBeLessThan(day[2] * 0.1)
    expect(sunlightColor(sunDirection(0, 20), earth)).toEqual([0, 0, 0])
    expect(nightAmount(1)).toBe(0)
    expect(nightAmount(-1)).toBe(1)
    expect(moonAmount(0.5)).toBe(0)
    expect(moonAmount(-0.5)).toBe(1)
  })

  it('sanitizeRGB removes NaN and clamps', () => {
    expect(sanitizeRGB([Number.NaN, -1, 5], 2)).toEqual([0, 0, 2])
  })
})

describe('sky colours across a whole day on every sky preset', () => {
  // A NaN or negative colour reaches the GPU as black or garbage light, every few minutes now
  // that days run. Every preset, every quarter hour, toward, across and away from the sun.
  it('stays finite and non-negative, and sunlight never exceeds 1', () => {
    for (const preset of Object.values(SKY_PRESETS)) {
      const p: SkyParams = {
        rayleighColor: [preset['sky.rayleighR'], preset['sky.rayleighG'], preset['sky.rayleighB']], rayleigh: preset['sky.rayleigh'],
        turbidity: preset['sky.turbidity'], mieCoefficient: preset['sky.mieCoefficient'], mieDirectionalG: preset['sky.mieDirectionalG'], nightBrightness: preset['sky.nightBrightness'],
      }
      for (let hour = 0; hour < 24; hour += 0.25) {
        const sun = sunDirection(hour, 30, 0)
        const light = sunlightColor(sun, p)
        for (const v of light) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
        for (const dir of [[sun[0], 0.03, sun[2]], [-sun[0], 0.03, -sun[2]], [0, 1, 0], [sun[2], 0.2, -sun[0]]] as Vec3[]) {
          const n = Math.hypot(...dir); const c = skyRadiance([dir[0] / n, dir[1] / n, dir[2] / n], sun, p)
          for (const v of c) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0) }
        }
      }
    }
  })
})

// Eye adaptation (world/Environment.ts) feeds the sky's colours straight into the tone mapping
// exposure. Bug caught: one sky colour that is not a number (the side colour enters the average
// unsanitised) making the exposure NaN, which draws the whole screen black, sky included.
describe('autoExposure', () => {
  it('stays finite whatever the sky luminance', async () => {
    const { autoExposure } = await import('../../src/world/sky/skyMath')
    for (const lum of [NaN, Infinity, -Infinity, -1, 0, 1e-30, 4, 1e30]) {
      const k = autoExposure(lum, 1)
      expect(Number.isFinite(k) && Number.isFinite(Math.log(k))).toBe(true)
    }
  })
})
