/** The generated wind voice's shaping (src/audio/weatherWind.ts). The graph itself is checked in a browser. */
import { describe, expect, it } from 'vitest'
import { WIND_LOUD, WIND_QUIET, windPan, windVoice } from '../../src/audio/weatherWind'

describe('wind voice', () => {
  it('is silent in still air and on an airless world, full in a gale', () => {
    expect(windVoice(0, 1).level).toBe(0)
    expect(windVoice(WIND_QUIET, 1).level).toBe(0)
    expect(windVoice(WIND_LOUD, 1).level).toBeCloseTo(1, 9)
    expect(windVoice(WIND_LOUD, 0).level).toBe(0)
  })

  it('grows louder and brighter with airspeed', () => {
    let last = windVoice(WIND_QUIET, 1)
    for (let a = WIND_QUIET + 2; a <= WIND_LOUD; a += 2) {
      const v = windVoice(a, 1)
      expect(v.level).toBeGreaterThan(last.level)
      expect(v.body).toBeGreaterThan(last.body)
      expect(v.whistle).toBeGreaterThan(last.whistle)
      last = v
    }
  })

  it('comes from where the air comes from', () => {
    const right = { x: 1, y: 0, z: 0 }
    // Air moving toward +x (to the right) arrives from the left.
    expect(windPan({ x: 10, y: 0, z: 0 }, right)).toBeCloseTo(-0.6, 9)
    expect(windPan({ x: -10, y: 0, z: 0 }, right)).toBeCloseTo(0.6, 9)
    expect(windPan({ x: 0, y: 0, z: -10 }, right)).toBeCloseTo(0, 9)
    expect(windPan({ x: 0, y: 0, z: 0 }, right)).toBe(0)
  })
})
