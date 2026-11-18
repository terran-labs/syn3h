import { describe, expect, it } from 'vitest'
import { SPAWN_FLAT_RADIUS, generateTerrain } from '../../src/world/terrain/generate'
import { distanceToPolyline } from '../../src/world/terrain/raster'
import { type Road, rimRoadRadius } from '../../src/world/terrain/roads'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const settings = defaultTerrainSettings()
const SEEDS = [1, 2, 3, 4, 5, 99, 777, 12345]
const GRADE_CAP = Math.tan((15 * Math.PI) / 180)
const CROSS_CAP = Math.tan((4 * Math.PI) / 180)

/** Points of `road` far enough from road ends and other roads to be plain road, not a junction. */
function interior(road: Road, roads: Road[]) {
  const pts = road.points
  const out: number[] = []
  for (let i = 0; i < pts.length - 2; i++) {
    const p = pts[i]
    if (!road.closed && (i < 8 || i > pts.length - 9)) continue
    if (roads.some((o) => o !== road && distanceToPolyline(o.points, o.closed, p.x, p.z) < 35)) continue
    out.push(i)
  }
  return out
}

describe('roads', () => {
  it('climb from spawn pad 0 to the summit and ring it', () => {
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, settings)
      const v = d.layout.volcano
      const main = d.roads.find((r) => r.kind === 'volcano')!
      const rim = d.roads.find((r) => r.kind === 'rim')!
      expect(main && rim).toBeTruthy()
      const pad = d.layout.spawns[0]
      const start = main.points[0]
      expect(Math.hypot(start.x - pad.x, start.z - pad.z)).toBeLessThan(SPAWN_FLAT_RADIUS)
      const end = main.points[main.points.length - 1]
      expect(Math.hypot(end.x - v.x, end.z - v.z)).toBeCloseTo(rimRoadRadius(d), 0)
      // The road arrives at the height of the summit ring, with no step at the junction.
      expect(Math.abs(end.y - d.layout.summitHeight)).toBeLessThan(6)
      const near = rim.points.reduce((a, p) => (Math.hypot(p.x - end.x, p.z - end.z) < Math.hypot(a.x - end.x, a.z - end.z) ? p : a))
      expect(Math.abs(near.y - end.y)).toBeLessThan(1.5)
    }
  }, 20000)

  it('give every spawn pad a road to the ring round the volcano', () => {
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, settings)
      const ring = d.roads.find((r) => r.kind === 'plain' && r.closed)!
      expect(ring).toBeTruthy()
      const approaches = d.roads.filter((r) => r.kind === 'plain' && !r.closed)
      expect(approaches.length).toBe(d.layout.spawns.length - 1)
      for (let i = 1; i < d.layout.spawns.length; i++) {
        const pad = d.layout.spawns[i]
        const road = approaches.find((r) => Math.hypot(r.points[0].x - pad.x, r.points[0].z - pad.z) < SPAWN_FLAT_RADIUS)!
        expect(road).toBeTruthy()
        const end = road.points[road.points.length - 1]
        expect(distanceToPolyline(ring.points, true, end.x, end.z)).toBeLessThan(8)
      }
    }
  }, 20000)

  it('keep grades and cross slopes under the caps on the collider surface', () => {
    const s = { worstGrade: 0, worstCross: 0, samples: 0 }
    for (const seed of SEEDS) {
      const d = generateTerrain(seed, settings)
      const h = new HeightSampler(d)
      for (const road of d.roads) {
        const pts = road.points
        for (const i of interior(road, d.roads)) {
          const a = pts[i]
          const b = pts[i + 2]
          const len = Math.hypot(b.x - a.x, b.z - a.z)
          const grade = Math.abs(h.heightAt(b.x, b.z) - h.heightAt(a.x, a.z)) / len
          // Perpendicular to the road, 3.5 m either side of the centreline.
          const nx = -(b.z - a.z) / len
          const nz = (b.x - a.x) / len
          const cross = Math.abs(h.heightAt(a.x + nx * 3.5, a.z + nz * 3.5) - h.heightAt(a.x - nx * 3.5, a.z - nz * 3.5)) / 7
          s.worstGrade = Math.max(s.worstGrade, grade)
          s.worstCross = Math.max(s.worstCross, cross)
          s.samples++
          // The road data must describe the surface the collider has.
          // Within three quarters of a metre: on the tightest part of the spiral the 4 m grid
          // cannot follow a curving, climbing centreline more closely than that.
          expect(Math.abs(h.heightAt(a.x, a.z) - a.y)).toBeLessThan(0.75)
        }
      }
    }
    const deg = (t: number) => ((Math.atan(t) * 180) / Math.PI).toFixed(1)
    process.stdout.write(`roads: ${s.samples} samples, worst grade ${deg(s.worstGrade)} deg, worst cross slope ${deg(s.worstCross)} deg\n`)
    expect(s.worstGrade).toBeLessThan(GRADE_CAP)
    expect(s.worstCross).toBeLessThan(CROSS_CAP)
  }, 20000)

  // Two full terrain generations: the 5 s default timed out under load (16) on 17 Nov.
  it('are deterministic', () => {
    expect(generateTerrain(5, settings).roads).toEqual(generateTerrain(5, settings).roads)
  }, 20000)
})
