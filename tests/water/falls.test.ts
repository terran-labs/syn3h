import { describe, expect, it } from 'vitest'
import { buildFallSheet } from '../../src/world/water/falls'

const lip = { x: 0, y: 10, z: 0 }, foot = { x: 8, y: 0, z: 0 }
const empty = { heightAt: () => -10 }

describe('falling sheets', () => {
  it('joins the lip and pool with an accelerating arc and bounded geometry', () => {
    const g = buildFallSheet(empty, lip, foot, 2, 9.81, 6)!
    expect(g).not.toBeNull()
    const p = g.getAttribute('position'), uv = g.getAttribute('uv')
    expect(p.count).toBeLessThanOrEqual(66)
    expect(p.getY(0)).toBeCloseTo(10.04)
    expect(p.getX(p.count - 1)).toBeCloseTo(8)
    expect(p.getY(p.count - 1)).toBeCloseTo(.04)
    for (let i = 0; i < p.count; i++) {
      const t = uv.getY(i)
      expect(p.getY(i)).toBeCloseTo(10.04 - .5 * 9.81 * t * t, 4)
    }
    g.dispose()
  })
  it('keeps shallow, blocked or excessively fast flows as cascades', () => {
    expect(buildFallSheet(empty, lip, { ...foot, x: 30 }, 2, 9.81, 6)).toBeNull()
    expect(buildFallSheet({ heightAt: () => 20 }, lip, foot, 2, 9.81, 6)).toBeNull()
    expect(buildFallSheet(empty, lip, foot, 2, 9.81, 1)).toBeNull()
    expect(buildFallSheet(empty, lip, foot, 2, 0, 6)).toBeNull()
  })
})
