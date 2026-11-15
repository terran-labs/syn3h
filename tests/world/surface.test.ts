/**
 * The CPU's reading of what the ground is made of (src/world/terrain/surface.ts), which tyre
 * marks choose their look from.
 */
import { describe, expect, it } from 'vitest'
import { SURFACE_KINDS, type SurfaceInput, classifySurface } from '../../src/world/terrain/surface'

const flat: SurfaceInput = {
  look: 0, slope: 0.02, height: 40, sea: 0, lavaSea: false, snowHeight: 1e6, volcanic: 0, roadDist: 60, madeRoad: false,
}
const at = (over: Partial<SurfaceInput>) => classifySurface({ ...flat, ...over })

describe('surface under a wheel', () => {
  it('names the bare ground of every look', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((look) => at({ look }))).toEqual(
      ['dust', 'sand', 'grass', 'grass', 'ice', 'glass', 'dust', 'regolith', 'mud'],
    )
  })

  it('only the swamp is mud', () => {
    for (let look = 0; look < 8; look++) expect(at({ look })).not.toBe('mud')
    expect(at({ look: 8 })).toBe('mud')
  })

  it('puts roads over everything, made or worn by the world', () => {
    expect(at({ look: 2, madeRoad: true, roadDist: 5 })).toBe('road')
    expect(at({ look: 2, madeRoad: true, roadDist: 6 })).toBe('grass')
    expect(at({ look: 8, roadDist: 1.3 })).toBe('track')
    // A worn track is only its ruts and the strip beside them, not the whole road bed.
    expect(at({ look: 8, roadDist: 4 })).toBe('mud')
    expect(at({ look: 2, madeRoad: true, roadDist: 2, height: 900, snowHeight: 300 })).toBe('road')
  })

  it('reads snow above the line, rock on cliffs and basalt', () => {
    expect(at({ look: 2, height: 400, snowHeight: 300 })).toBe('snow')
    expect(at({ look: 2, height: 310, snowHeight: 300 })).not.toBe('snow')
    // Snow does not lie on a steep face.
    expect(at({ look: 2, height: 400, snowHeight: 300, slope: 0.45 })).toBe('rock')
    expect(at({ look: 1, slope: 0.3 })).toBe('rock')
    expect(at({ look: 0, volcanic: 1, slope: 0.2 })).toBe('rock')
    // Flat ground on a volcano is dusted, not bare basalt.
    expect(at({ look: 0, volcanic: 0.6, slope: 0.02 })).toBe('dust')
  })

  it('reads the shore by its sea, and tundra below the alpine snow', () => {
    expect(at({ look: 2, height: 3 })).toBe('sand')
    expect(at({ look: 0, height: 3, lavaSea: true })).toBe('rock')
    expect(at({ look: 8, height: 3 })).toBe('mud')
    expect(at({ look: 2, height: 250, snowHeight: 300 })).toBe('dust')
  })

  it('always answers with a known kind', () => {
    for (const look of [-1, 0, 4, 99]) expect(SURFACE_KINDS).toContain(at({ look }))
  })
})
