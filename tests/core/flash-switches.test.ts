import { describe, expect, it } from 'vitest'
import { LOW_REST, flashSwitchLine, gateSunShadows, pinnedParams, pinnedValue, pins, readFlashSwitches, sunShadowsLine } from '../../src/core/flashSwitches'
import { LEVELS, presetCell } from '../../src/core/quality'

describe('flash switches', () => {
  it('are all off without an address switch', () => {
    const s = readFlashSwitches('?autoplay=1&world=mire.7')
    expect(pinnedParams(s)).toEqual({})
    expect(flashSwitchLine(s)).toBe('Flash switches: none')
  })

  it('read each switch, and name each one that is on', () => {
    const s = readFlashSwitches('?blank=1&shadows=0&shading=0&post=base&samples=1&lowrest=1&freeze=1&ui=flat')
    expect(s).toMatchObject({ blank: true, shadows0: true, shading0: true, post: 'base', samples1: true, lowRest: true, freeze: true, uiFlat: true })
    expect(flashSwitchLine(s)).toBe('Flash switches: blank=1, shadows=0, shading=0, post=base, samples=1, lowrest=1, freeze=1, ui=flat')
  })

  it('post=off takes flat interface glass, which needs no post chain', () => {
    expect(readFlashSwitches('?post=off')).toMatchObject({ post: 'off', uiFlat: true })
    expect(readFlashSwitches('?post=lite').post).toBeNull()
  })

  it("pin Low's values: the shadow and shading switches, and lowrest's are the Low column of the preset table", () => {
    expect(pinnedParams(readFlashSwitches('?shadows=0&shading=0'))).toEqual({ 'gfx.shadowQuality': 0, 'gfx.vehicleShading': 0 })
    expect(presetCell('gfx.shadowQuality', 1)).toBe(0)
    expect(presetCell('gfx.vehicleShading', 1)).toBe(0)
    for (const [id, value] of Object.entries(LOW_REST)) {
      expect(presetCell(id, 1), id).toBe(value)
      // Each is something Medium sets differently, or it would not be a Low and Medium difference.
      expect(presetCell(id, 2), id).not.toBe(value)
    }
    expect(LEVELS[1].postTier).toBe('base')
  })

  it('name ?gfx, ?diag and ?webgl too, so the report names every switch that is on', () => {
    expect(flashSwitchLine(readFlashSwitches('?gfx=2&diag=1&webgl=1&shadows=1'))).toBe('Flash switches: shadows=1, gfx=2, diag=1, webgl=1')
    expect(flashSwitchLine(readFlashSwitches('?gfx=9'))).toBe('Flash switches: none')
  })

  // The v26.11.2305 stopgap: Safari WebGPU flashed black with sun shadows on.
  it('hold sun shadows off on an unproven WebGPU device, not on WebGL 2, and not with ?shadows=1', () => {
    const none = readFlashSwitches('')
    try {
      gateSunShadows(true, true, none)
      expect(pinnedValue('gfx.shadowQuality')).toBe(0)
      expect(sunShadowsLine(none)).toBe('Sun shadows: off: not yet proven on this device')
      expect(pins(none)).toEqual({ 'gfx.shadowQuality': { value: 0, by: 'device gate: sun shadows not yet proven on this device' } })
      expect(pins(readFlashSwitches('?shadows=0'))['gfx.shadowQuality']).toEqual({ value: 0, by: 'link switch ?shadows=0' })
      gateSunShadows(false, true, none)
      expect(pinnedValue('gfx.shadowQuality')).toBeUndefined()
      gateSunShadows(true, false, none)
      expect(pinnedValue('gfx.shadowQuality')).toBeUndefined()
      expect(sunShadowsLine(none)).toBe('Sun shadows: on')
      const forced = readFlashSwitches('?shadows=1')
      gateSunShadows(true, true, forced)
      expect(pinnedValue('gfx.shadowQuality')).toBeUndefined()
      expect(sunShadowsLine(forced)).toBe('Sun shadows: on: ?shadows=1, though not yet proven on this device')
    } finally { gateSunShadows(false, false, none) }
  })
})
