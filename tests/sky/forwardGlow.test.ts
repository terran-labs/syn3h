// The sun shafts draw the low sun's forward glow in place of the sky (AlienSkyMesh.glowShare).
// Bug this catches: a sky that goes negative, NaN or infinite where it hands that glow off, which
// shows as a black or flashing hole round the sun at some hour on some planet.
import { describe, expect, it } from 'vitest'
import { forwardGlow, skyRadianceBase, sunDirection, type RGB, type SkyParams, type Vec3 } from '../../src/world/sky/skyMath'
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
        for (const dir of around(sun)) {
          forwardGlow(dir, sun, p, glow)
          skyRadianceBase(dir, sun, p, sky)
          for (let i = 0; i < 3; i++) {
            const where = `${name} at ${q / 4}h, channel ${i}`
            expect(Number.isFinite(glow[i]), where).toBe(true)
            expect(glow[i], where).toBeGreaterThanOrEqual(0)
            // What the sky draws when the shafts take the whole glow.
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
