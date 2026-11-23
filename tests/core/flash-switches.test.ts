import { describe, expect, it } from 'vitest'
import { LOW_REST, flashSwitchLine, pinnedParams, readFlashSwitches } from '../../src/core/flashSwitches'
import { LEVELS, presetCell } from '../../src/core/quality'

describe('flash switches', () => {
  it('are all off without an address switch', () => {
    const s = readFlashSwitches('?autoplay=1&gfx=2')
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
})
