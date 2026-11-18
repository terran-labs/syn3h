// The sunburst's dark streaks take away up to the whole of the low sun's forward glow
// (src/fx/post/PostChain.ts). Bug this catches: a glow that is negative, NaN, infinite or larger
// than the sky, which shows as a black or flashing hole round the sun at some hour on some planet.
import { describe, expect, it } from 'vitest'
import { forwardGlow, lowSunGlowShare, rayGlowShare, skyRadianceBase, sunDirection, type RGB, type SkyParams, type Vec3 } from '../../src/world/sky/skyMath'
import { SKY_PRESETS } from '../../src/world/sky/presets'

const presets = Object.entries(SKY_PRESETS).map(([name, p]) => [name, {
  rayleighColor: [p['sky.rayleighR'], p['sky.rayleighG'], p['sky.rayleighB']] as RGB,
  rayleigh: p['sky.rayleigh'], turbidity: p['sky.turbidity'], mieCoefficient: p['sky.mieCoefficient'],
  mieDirectionalG: p['sky.mieDirectionalG'], nightBrightness: p['sky.nightBrightness'],
}] as const)

/** Directions on and round the sun, out past the glow's cap, and some below the horizon. */
function around(sun: Vec3): Vec3[] {
  const dirs: Vec3[] = []
  const flat = Math.hypot(sun[0], sun[2]) > 1e-6 ? [sun[0], sun[2]] : [1, 0]
  const az0 = Math.atan2(flat[1], flat[0]), el0 = Math.asin(Math.max(-1, Math.min(1, sun[1])))
  for (const dEl of [-0.3, -0.05, 0, 0.002, 0.05, 0.2, 0.45]) for (const dAz of [0, 0.01, 0.1, 0.3, 0.6]) {
    const el = el0 + dEl, az = az0 + dAz
    dirs.push([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)])
  }
  return dirs
}

describe('forward glow hand-off', () => {
  it('is finite, non-negative and never more than the sky, at every quarter hour for every sky preset', () => {
    const glow: RGB = [0, 0, 0], sky: RGB = [0, 0, 0]
    for (const [name, p] of presets as ReadonlyArray<readonly [string, SkyParams]>) {
      for (let q = 0; q < 96; q++) {
        const sun = sunDirection(q / 4, 20, 30)
        // The low sun's own share, and the whole glow, the most the rays carry at any height.
        for (const dir of around(sun)) for (const share of [lowSunGlowShare(sun[1]), 1]) {
          forwardGlow(dir, sun, p, glow, share)
          skyRadianceBase(dir, sun, p, sky)
          for (let i = 0; i < 3; i++) {
            const where = `${name} at ${q / 4}h, share ${share}, channel ${i}`
            expect(Number.isFinite(glow[i]), where).toBe(true)
            expect(glow[i], where).toBeGreaterThanOrEqual(0)
            // What is left where a dark streak takes the whole glow.
            expect(sky[i] - glow[i], where).toBeGreaterThanOrEqual(-1e-9)
          }
        }
      }
    }
  })
  it('is nothing for a high sun', () => {
    const glow: RGB = [0, 0, 0]
    for (const [, p] of presets as ReadonlyArray<readonly [string, SkyParams]>) {
      const sun = sunDirection(12, 20, 30)
      for (const dir of around(sun)) expect(forwardGlow(dir, sun, p, glow)).toEqual([0, 0, 0])
    }
  })
})

// Bug this catches: sun rays that vanish once the sun is up, the v26.11.1611 behaviour the
// owner reported as no rays at all. With any high-sun share above 0 they carry light whenever
// the sun is up, and with 0 they are the old low-sun-only rays.
describe('sun ray share', () => {
  it('is above 0 whenever the sun is up and the high-sun share is', () => {
    for (let y = 0.03; y <= 1; y += 0.01) expect(rayGlowShare(y, 0.3), `sun height ${y}`).toBeGreaterThan(0.2)
    expect(rayGlowShare(-0.1, 1)).toBe(0)
  })
  it('is the low sun share with the high-sun share at 0', () => {
    for (let y = -0.1; y <= 1; y += 0.01) expect(rayGlowShare(y, 0)).toBeCloseTo(lowSunGlowShare(y), 12)
  })
})
