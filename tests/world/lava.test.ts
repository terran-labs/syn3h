import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../../src/world/terrain/generate'
import { ROAD_CLEARANCE, lavaSurfaceAt } from '../../src/world/terrain/lava'
import { distanceToPolyline } from '../../src/world/terrain/raster'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const settings = defaultTerrainSettings()
const SEEDS = [1, 2, 3, 4, 5, 99, 777, 12345]

describe('lava and vents', () => {
  it('produce a lake, rivers, pools and vents, deterministically', () => {
    const counts: string[] = []
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, settings)
      const { lake, rivers, pools } = d.lava
      expect(lake).not.toBeNull()
      expect(lake!.surface).toBeGreaterThan(lake!.floor)
      expect(rivers.length).toBeGreaterThanOrEqual(2)
      expect(rivers.length).toBeLessThanOrEqual(9)
      expect(pools.length).toBe(rivers.length)
      expect(d.vents.length).toBeGreaterThanOrEqual(10)
      expect(d.vents.length).toBeLessThanOrEqual(30)
      for (const v of d.vents) expect(['flame', 'embers', 'smoke']).toContain(v.kind)
      counts.push(`${seed}: ${rivers.length} rivers, ${d.vents.length} vents`)
    }
    process.stdout.write(`lava: ${counts.join('; ')}\n`)
    const a = generateTerrain(9, settings)
    const b = generateTerrain(9, settings)
    expect(a.lava).toEqual(b.lava)
    expect(a.vents).toEqual(b.vents)
  }, 20000)

  it('rivers run downhill in carved channels to their pool, clear of roads', () => {
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      for (const r of d.lava.rivers) {
        const pts = r.points
        // Every river rises on the volcano: below the rim road, or below a wrap of the spiral road.
        expect(Math.hypot(pts[0].x - v.x, pts[0].z - v.z)).toBeLessThan(v.radius * (1 + v.gentleStretch))
        for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeLessThanOrEqual(pts[i - 1].y)
        for (const p of pts) {
          // The lava sits in the ground: the channel bed is below the lava surface.
          expect(s.heightAt(p.x, p.z)).toBeLessThan(p.y)
          for (const road of d.roads) {
            expect(distanceToPolyline(road.points, road.closed, p.x, p.z)).toBeGreaterThan(ROAD_CLEARANCE - 0.01)
          }
        }
        const end = pts[pts.length - 1]
        expect(Math.hypot(end.x - r.pool.x, end.z - r.pool.z)).toBeLessThan(r.pool.radius)
        expect(r.pool.surface).toBeLessThanOrEqual(end.y)
        // The pool basin holds its lava.
        expect(s.heightAt(r.pool.x, r.pool.z)).toBeLessThan(r.pool.surface)
      }
    }
  }, 20000)

  it('liquid height: lake in the caldera, rivers and pools, fallback elsewhere', () => {
    const d = generateTerrain(3, settings)
    const lake = d.lava.lake!
    expect(lavaSurfaceAt(d.lava, lake.x, lake.z, 0)).toBe(lake.surface)
    const pool = d.lava.pools[0]
    expect(lavaSurfaceAt(d.lava, pool.x, pool.z, 0)).toBe(pool.surface)
    const mid = d.lava.rivers[0].points[10]
    expect(lavaSurfaceAt(d.lava, mid.x, mid.z, 0)).toBeCloseTo(mid.y, 3)
    // Open sea, far from the volcano: only the sea level applies.
    expect(lavaSurfaceAt(d.lava, 950, 950, 0)).toBe(0)
  })
})
