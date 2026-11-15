import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../../src/world/terrain/generate'
import { DROP_FALL, ROAD_CLEARANCE, findDrops, lavaSurfaceAt } from '../../src/world/terrain/lava'
import { distanceToPolyline } from '../../src/world/terrain/raster'
import { FORD_DEPTH } from '../../src/world/terrain/roads'
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

  it('marks steep runs of a river as drops', () => {
    // A bed that falls gently, then 6 m in 12 m, then gently again.
    const ys = [50, 49.5, 49, 48.5, 45, 42.5, 42, 41.5, 41]
    const pts = ys.map((y, i) => ({ x: i * 6, y, z: 0 }))
    const drops = findDrops(pts)
    expect(drops.length).toBe(1)
    expect(pts[drops[0].start].y - pts[drops[0].end].y).toBeCloseTo(drops[0].height, 6)
    expect(drops[0].height).toBeGreaterThan(DROP_FALL)
    expect(drops[0].start).toBeLessThanOrEqual(3)
    expect(drops[0].end).toBeGreaterThanOrEqual(5)
    // The steepest 12 m is the 6 m fall in the middle, inside the drop.
    expect(drops[0].steepest.height).toBeCloseTo(6, 6)
    expect(drops[0].steepest.start).toBeGreaterThanOrEqual(drops[0].start)
    expect(drops[0].steepest.end).toBeLessThanOrEqual(drops[0].end)
    expect(findDrops(pts.map((p, i) => ({ ...p, y: 50 - i * 0.5 })))).toEqual([])
    // Every generated river carries the field, with indices inside its points.
    for (const seed of SEEDS) {
      for (const r of generateTerrain(seed, settings).lava.rivers) {
        for (const d of r.drops) {
          expect(d.start).toBeGreaterThanOrEqual(0)
          expect(d.end).toBeLessThan(r.points.length)
          expect(d.end).toBeGreaterThan(d.start)
          expect(d.height).toBeGreaterThan(DROP_FALL)
        }
      }
    }
  }, 20000)

  it('fords: off by default; on, rivers cross the level roads shallow and some reach the sea', () => {
    expect(settings.fords).toBe(0)
    for (const seed of SEEDS) for (const r of generateTerrain(seed, settings).roads) expect(r.fords).toEqual([])
    const water = { ...settings, kind: 2, fords: 1 }
    let fords = 0
    let toSea = 0
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, water)
      const s = new HeightSampler(d)
      for (const road of d.roads) {
        // Only the level roads of the plain are forded, never the climb or the rim.
        if (road.kind !== 'plain') expect(road.fords).toEqual([])
        for (const f of road.fords) {
          fords++
          expect(f.depth).toBeGreaterThan(0.05)
          expect(f.depth).toBeLessThan(FORD_DEPTH + 0.25)
          expect(f.end).toBeGreaterThanOrEqual(f.start)
          // The road data still describes ground a vehicle can drive: under water, not gone.
          const p = road.points[f.start]
          expect(lavaSurfaceAt(d.lava, p.x, p.z, -1e9) - s.heightAt(p.x, p.z)).toBeLessThan(FORD_DEPTH + 0.25)
        }
      }
      for (const r of d.lava.rivers) {
        const e = r.points[r.points.length - 1]
        if (s.heightAt(e.x, e.z) < 4) toSea++
        for (let i = 1; i < r.points.length; i++) expect(r.points[i].y).toBeLessThanOrEqual(r.points[i - 1].y)
      }
      // Lava never fords.
      for (const road of generateTerrain(seed, { ...settings, kind: 0, fords: 1 }).roads) expect(road.fords).toEqual([])
    }
    process.stdout.write(`fords: ${fords} fords and ${toSea} rivers to the sea over ${SEEDS.length} alpine seeds\n`)
    expect(fords).toBeGreaterThan(3)
    expect(toSea).toBeGreaterThan(1)
  }, 60000)

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
