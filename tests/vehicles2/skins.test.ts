import { describe, expect, it } from 'vitest'
import { wingVertexMira } from '../../src/vehicles/skins/MiraBuggySkin'

describe('flight wing deformation', () => {
  it('collapses width and height while preserving length', () => {
    expect(wingVertexMira(3, .2, 1, 0, 0, 0)).toEqual([0, 0, 1])
    expect(wingVertexMira(3, .2, 1, .5, 0, 0)).toEqual([1.5, .1, 1])
    const open = wingVertexMira(3, .2, 1, 1, 0, 0)
    expect(open[0]).toBeCloseTo(3); expect(open[1]).toBeCloseTo(.2); expect(open[2]).toBe(1)
  })
  it('flexes only once fully open, and never moves a vertex along the body', () => {
    const p = wingVertexMira(3, 0, 1, 1, 0, 1), s = wingVertexMira(3, 0, 1, 1, 1, 0)
    expect(Math.abs(p[1])).toBeGreaterThan(.01)
    expect(Math.abs(s[1])).toBeGreaterThan(.001)
    expect(p[2]).toBe(1); expect(s[2]).toBe(1)
    // Steering bends the two wings opposite ways; a vertex on the centre line stays put.
    expect(Math.sign(wingVertexMira(-3, 0, 1, 1, 1, 0)[1])).toBe(-Math.sign(s[1]))
    expect(wingVertexMira(0, 0, 1, 1, 1, 1)[1]).toBeCloseTo(0)
    expect(wingVertexMira(3, 0, 1, .99, 1, 1)[1]).toBe(0)
  })
})
