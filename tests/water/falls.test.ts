import { describe, expect, it } from 'vitest'
import type * as THREE from 'three/webgpu'
import { RIVER_DRAPE_DEPTH, buildFallSheet, riverPieces } from '../../src/world/water/falls'
import { fallsFromRivers } from '../../src/world/water/mist'
import { buildRiverSurface } from '../../src/world/water/surface'
import { applyPlanet } from '../../src/world/planets'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../src/world/terrain/settings'

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

describe('rivers off a drop', () => {
  // A plateau at 20 m ending in a cliff at x = 30, a plunge pool surface at 2 m below it.
  const cliff = { heightAt: (x: number) => (x < 30 ? 20 : 0) }
  const pool = (x: number) => (x >= 30 ? 2 : -Infinity)
  // The planned surface runs level past the lip, as the generator plans it over a carved pool.
  const planned = Array.from({ length: 11 }, (_, i) => ({ x: i * 6, y: 21.2 - i * .05, z: 0 }))

  it('never draws a vertex hanging above both the ground and the receiving water', () => {
    const before = buildRiverSurface(cliff, planned, 10, () => 1)
    expect(highestFloat(cliff, pool, before)).toBeGreaterThan(15)
    const pieces = riverPieces(cliff, planned, 9, pool, 9.81, 6)
    const after = buildRiverSurface(cliff, pieces.points, 10, () => 1)
    expect(highestFloat(cliff, pool, after)).toBeLessThanOrEqual(1e-3)
    // It stops at the pool instead of lying on top of it.
    const end = pieces.points.at(-1)!
    expect(end.x).toBeGreaterThanOrEqual(30)
    expect(end.x).toBeLessThan(36)
    expect(end.y).toBeCloseTo(2)
    // The level water reaches the edge itself before it falls.
    expect(pieces.points.some((p) => p.x > 29.5 && p.x <= 30 && p.y > 20)).toBe(true)
  })

  it('falls from the lip to the pool with a sheet and mist at the foot', () => {
    const pieces = riverPieces(cliff, planned, 9, pool, 9.81, 6)
    expect(pieces.sheets.length).toBe(1)
    const p = pieces.sheets[0].getAttribute('position')
    // From the planned surface at the edge to the pool, landing out from the cliff foot.
    expect(p.getY(0)).toBeCloseTo(21.2 - 5 * .05 + .04, 1)
    expect(p.getY(p.count - 1)).toBeCloseTo(2.04, 3)
    expect(p.getX(p.count - 1)).toBeGreaterThan(30)
    const falls = fallsFromRivers([pieces])
    expect(falls).toHaveLength(1)
    expect(falls[0].y).toBeCloseTo(2)
  })

  it('leaves no floating river surface on the ice moon Vagard III (seed 1)', () => {
    applyPlanet('ice', 1)
    const data = generateTerrain(1, currentTerrainSettings())
    const ground = new HeightSampler(data)
    const lava = data.lava
    const waterAt = (x: number, z: number) => {
      let y = data.settings.dry ? -Infinity : 0
      for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) {
        if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.radius ** 2) y = Math.max(y, b.surface)
      }
      return y
    }
    let worstBefore = 0, worstAfter = 0
    for (const r of lava.rivers) {
      const before = buildRiverSurface(ground, r.points, r.width + 1.5, () => 1)
      worstBefore = Math.max(worstBefore, highestFloat(ground, waterAt, before))
      const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, 6)
      const after = buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1)
      worstAfter = Math.max(worstAfter, highestFloat(ground, waterAt, after))
    }
    // River 1 ran its last 18 m level over its mouth pool, 4 m above the water.
    expect(worstBefore).toBeGreaterThan(3)
    expect(worstAfter).toBeLessThanOrEqual(.25)
  })
})

/** Metres the highest ribbon vertex stands above both the water depth over the ground and the receiving water. */
function highestFloat(ground: { heightAt(x: number, z: number): number }, waterAt: (x: number, z: number) => number, g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position')
  let worst = -Infinity
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    worst = Math.max(worst, y - Math.max(ground.heightAt(x, z) + RIVER_DRAPE_DEPTH, waterAt(x, z)))
  }
  g.dispose()
  return worst
}
