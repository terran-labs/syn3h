/**
 * Gear impacts by surface (src/weapons/impact/recipes.ts). Bugs these catch: a shot into a lake
 * drawn on the bed beneath it, where nobody sees it; a surface kind with no look (a crash on a
 * new terrain); a scorch left floating on water or stuck to a vehicle; counts that go negative,
 * fractional, or grow when quality falls.
 */
import { describe, expect, it } from 'vitest'
import { classifyImpact, impactCounts, RECIPES } from '../../src/weapons/impact/recipes'
import { SURFACE_KINDS } from '../../src/world/terrain/surface'

const out = { x: 0, y: 0, z: 0 }
const flatLake = (kind: 'water' | 'lava') => ({ surfaceAt: () => 'sand' as const, liquidHeightAt: () => 5, liquidKindAt: () => kind })

describe('impact by surface', () => {
  it('has a look for every surface, liquid and vehicle, and never scorches a liquid or a vehicle', () => {
    for (const kind of [...SURFACE_KINDS, 'water', 'lava', 'vehicle'] as const) expect(RECIPES[kind]).toBeDefined()
    for (const kind of ['water', 'lava', 'vehicle'] as const) expect(RECIPES[kind].scorch).toBe(false)
  })
  it('draws a shot into a lake where it crossed the surface, as water or lava', () => {
    // Coming down at 45 degrees onto a bed 3 m under the surface.
    const dir = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }
    expect(classifyImpact({ x: 10, y: 2, z: 0 }, dir, false, flatLake('water'), out)).toBe('water')
    expect(out.y).toBe(5); expect(out.x).toBeCloseTo(7, 6)
    expect(classifyImpact({ x: 10, y: 2, z: 0 }, dir, false, flatLake('lava'), out)).toBe('lava')
  })
  it('uses the ground kind on land, rock with no terrain, and a vehicle before either', () => {
    const dir = { x: 0, y: -1, z: 0 }
    expect(classifyImpact({ x: 0, y: 9, z: 0 }, dir, false, flatLake('water'), out)).toBe('sand')
    expect(out.y).toBe(9)
    expect(classifyImpact({ x: 0, y: 9, z: 0 }, dir, false, undefined, out)).toBe('rock')
    expect(classifyImpact({ x: 0, y: 2, z: 0 }, dir, true, flatLake('water'), out)).toBe('vehicle')
  })
  it('counts whole, never negative, fewer at lower quality, more for Thunder', () => {
    for (const recipe of Object.values(RECIPES)) for (const level of [0, 1, 2]) for (const thunder of [false, true]) {
      const c = impactCounts(recipe, 18, level, thunder)
      for (const v of [c.sparks, c.debris]) { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0) }
      if (level > 0) expect(impactCounts(recipe, 18, level - 1, thunder).sparks).toBeLessThanOrEqual(c.sparks)
      if (!thunder) expect(impactCounts(recipe, 18, level, true).sparks).toBeGreaterThanOrEqual(c.sparks)
    }
    expect(impactCounts(RECIPES.rock, 0, 2, true)).toEqual({ sparks: 0, debris: 0 })
  })
})
