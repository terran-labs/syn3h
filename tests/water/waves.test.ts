import { describe, expect, it } from 'vitest'
import { buildWaves, shoalFactor, WAVE_MAX_AMPLITUDE, wavePhases, waveOffset, waveVerticalSpeed } from '../../shared/water/waves'
import { riverSpeed } from '../../src/world/terrain/lava'

const base = { tileSize: 2048, height: 2, length: 60, direction: 0.4, gravity: 9.81, seed: 7, minGeometricLength: 4 * 2048 / 192 }

describe('sea waves', () => {
  it('repeat exactly at the tile width, so a wrapping planet has no seam', () => {
    const set = buildWaves(base)
    const ph = wavePhases(set, 1234.5)
    for (const [x, z] of [[10, -300], [-1000, 777], [3.3, 4.4]]) {
      expect(waveOffset(set, ph, x + 2048, z)).toBeCloseTo(waveOffset(set, ph, x, z), 9)
      expect(waveOffset(set, ph, x, z - 2048 * 3)).toBeCloseTo(waveOffset(set, ph, x, z), 8)
    }
  })

  it('travel at the deep water speed for their wavelength', () => {
    const set = buildWaves(base)
    for (const c of set.components) {
      const k = Math.hypot(c.kx, c.kz)
      expect(c.omega).toBeCloseTo(Math.sqrt(9.81 * k), 12)
      // Phase speed omega / k equals sqrt(g lambda / 2 pi).
      expect(c.omega / k).toBeCloseTo(Math.sqrt((9.81 * c.length) / (2 * Math.PI)), 9)
    }
  })

  it('never rise above the documented maximum', () => {
    const set = buildWaves({ ...base, height: 99 })
    expect(set.amplitude).toBeLessThanOrEqual(WAVE_MAX_AMPLITUDE + 1e-9)
  })

  it('leave out components too short for the sea mesh from the height', () => {
    const set = buildWaves({ ...base, tileSize: 4096, minGeometricLength: 4 * 4096 / 192 })
    expect(set.components.some((c) => c.lightOnly)).toBe(true)
    for (const c of set.components) expect(c.lightOnly).toBe(c.length < 4 * 4096 / 192)
  })

  it('agree between height and vertical speed (numerical derivative)', () => {
    const set = buildWaves(base)
    const t = 50
    const dt = 1e-4
    const h0 = waveOffset(set, wavePhases(set, t - dt), 12, 34)
    const h1 = waveOffset(set, wavePhases(set, t + dt), 12, 34)
    expect(waveVerticalSpeed(set, wavePhases(set, t), 12, 34)).toBeCloseTo((h1 - h0) / (2 * dt), 4)
  })

  it('keep phases small however long the server has run', () => {
    const set = buildWaves(base)
    for (const p of wavePhases(set, 3.2e9)) expect(p >= 0 && p < Math.PI * 2).toBe(true)
  })

  it('die away on the shore and are whole in deep water', () => {
    expect(shoalFactor(0, 60)).toBe(0)
    expect(shoalFactor(-2, 60)).toBe(0)
    expect(shoalFactor(6, 60)).toBe(1)
  })
})

describe('river speed', () => {
  it("follows Manning's formula and its cap", () => {
    expect(riverSpeed(0.01, 99)).toBeCloseTo((1.4 ** (2 / 3) * 0.1) / 0.035, 9)
    expect(riverSpeed(0, 99)).toBe(0.3)
    expect(riverSpeed(1, 6)).toBe(6)
  })
})
