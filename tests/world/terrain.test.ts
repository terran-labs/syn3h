import { beforeAll, describe, expect, it } from 'vitest'
import { RAPIER, initPhysics } from '../../src/core/physics'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import {
  SPAWN_LEVEL, coneProfile, generateTerrain, rimRadius, terrainChecksum, type TerrainData,
} from '../../src/world/terrain/generate'
import { perlin, rng } from '../../src/world/terrain/noise'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

const settings = defaultTerrainSettings()

describe('terrain generation', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateTerrain(42, settings)
    const b = generateTerrain(42, settings)
    const c = generateTerrain(43, settings)
    expect(a.heights).toEqual(b.heights)
    expect(a.volcanic).toEqual(b.volcanic)
    expect(terrainChecksum(a)).toBe(terrainChecksum(b))
    expect(terrainChecksum(a)).not.toBe(terrainChecksum(c))
    let diff = 0
    for (let i = 0; i < a.heights.length; i++) if (a.heights[i] !== c.heights[i]) diff++
    expect(diff / a.heights.length).toBeGreaterThan(0.5)
  })

  it('reacts to parameters', () => {
    const a = generateTerrain(7, settings)
    const b = generateTerrain(7, { ...settings, volcanoHeight: settings.volcanoHeight + 50 })
    expect(terrainChecksum(a)).not.toBe(terrainChecksum(b))
  })

  it('has a volcano at the centre with a crater below its flat summit', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      expect(v.x).toBe(0)
      expect(v.z).toBe(0)
      const centre = s.heightAt(0, 0)
      expect(centre).toBeCloseTo(v.floorHeight, 0)
      // The summit ring is well above the crater floor and towers over the plains.
      const ring = rimRadius(v)
      const summit = s.heightAt(-v.gentleX * ring, -v.gentleZ * ring)
      expect(summit).toBeGreaterThan(centre + 10)
      expect(summit).toBeGreaterThan(SPAWN_LEVEL + settings.volcanoHeight * 0.4)
      expect(Math.abs(summit - d.layout.summitHeight)).toBeLessThan(6)
    }
  }, 20000)

  it('is an island: sea on every edge, land in the middle', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = generateTerrain(seed, settings)
      const n = d.resolution
      const h = d.heights
      // Every sample on the border of the simulated square is under the sea surface.
      let highestEdge = -Infinity
      for (let i = 0; i < n; i++) {
        highestEdge = Math.max(highestEdge, h[i], h[(n - 1) * n + i], h[i * n], h[i * n + n - 1])
      }
      expect(highestEdge).toBeLessThan(-10)
      // A sensible share of the square is land, and nothing sits within a metre of the
      // surface over a wide area (a shelf there would flicker through the liquid).
      let land = 0
      let shelf = 0
      for (let i = 0; i < h.length; i++) {
        if (h[i] > 0) land++
        if (h[i] > -1 && h[i] < 1) shelf++
      }
      expect(land / h.length).toBeGreaterThan(0.3)
      expect(land / h.length).toBeLessThan(0.65)
      expect(shelf / h.length).toBeLessThan(0.03)
    }
  }, 20000)

  it('profiles a continuous cone', () => {
    expect(coneProfile(0)).toBeCloseTo(1, 6)
    expect(coneProfile(0.5 - 1e-9)).toBeCloseTo(coneProfile(0.5 + 1e-9), 6)
    // Concave: steeper near the summit than at the foot.
    expect(coneProfile(0.1) - coneProfile(0.2)).toBeGreaterThan(coneProfile(0.8) - coneProfile(0.9))
    expect(coneProfile(1)).toBe(0)
  })

  it('generates fast enough and reports the time', () => {
    // The budget is 150 ms at the shipping resolution on an idle machine of the class this
    // was measured on. Tests run in parallel, often on a busy machine, where everything is
    // slower by the same factor, so a fixed noise workload is timed between runs and the
    // budget is stretched by however much slower than idle that workload ran. On an idle
    // machine the factor is 1 and this is a plain 150 ms limit.
    const CALIBRATION_IDLE_MS = 32
    const calibrate = () => {
      let sum = 0
      const t = performance.now()
      for (let i = 0; i < 2_000_000; i++) sum += perlin(i * 0.37, i * 0.11, 7)
      return sum === Infinity ? Infinity : performance.now() - t
    }
    generateTerrain(4, settings) // warm the JIT, as a running game would be
    generateTerrain(5, settings)
    let best = Infinity
    let calibration = Infinity
    const runs: number[] = []
    for (let i = 0; i < 12; i++) {
      calibration = Math.min(calibration, calibrate())
      const t = performance.now()
      generateTerrain(1000 + i, settings)
      runs.push(performance.now() - t)
      best = Math.min(best, runs[i])
    }
    const slowdown = Math.max(1, calibration / CALIBRATION_IDLE_MS)
    const median = [...runs].sort((a, b) => a - b)[runs.length >> 1]
    process.stdout.write(
      `terrain generation 513x513: best ${best.toFixed(1)} ms, median ${median.toFixed(1)} ms over ${runs.length} runs; ` +
      `machine ${slowdown.toFixed(2)}x slower than idle, so ${(best / slowdown).toFixed(1)} ms idle equivalent\n`,
    )
    expect(best).toBeLessThan(150 * slowdown)
    const t = performance.now()
    generateTerrain(2000, settings, { resolution: 1025 })
    process.stdout.write(`terrain generation 1025x1025: ${(performance.now() - t).toFixed(1)} ms\n`)
  }, 60000)
})

describe('terrain collider', () => {
  let world: RAPIER.World
  let data: TerrainData
  let sampler: HeightSampler

  beforeAll(async () => {
    await initPhysics()
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    data = generateTerrain(314159, settings)
    sampler = new HeightSampler(data)
    createTerrainCollider(world, data)
    world.step() // build the query structures
  })

  it('matches heightAt under rays at seeded random points', () => {
    const next = rng(2024)
    const half = data.size / 2
    let worst = 0
    let misses = 0
    for (let i = 0; i < 2000; i++) {
      const x = (next() * 2 - 1) * (half - 1)
      const z = (next() * 2 - 1) * (half - 1)
      const top = 2000
      const hit = world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 5000, true)
      if (!hit) { misses++; continue }
      const y = top - hit.timeOfImpact
      worst = Math.max(worst, Math.abs(y - sampler.heightAt(x, z)))
    }
    process.stdout.write(`collider vs heightAt: worst error ${worst.toExponential(2)} m over 2000 rays` + '\n')
    expect(misses).toBe(0)
    expect(worst).toBeLessThan(0.01)
  })

  it('is not mirrored or transposed (probes along the volcano road)', () => {
    // The road winds up one side of the cone, so a mirrored or transposed collider would
    // put different ground under its points.
    const road = data.roads.find((r) => r.kind === 'volcano')!
    for (const f of [0.25, 0.5, 0.75]) {
      const p = road.points[Math.floor(road.points.length * f)]
      const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: 2000, z: p.z }, { x: 0, y: -1, z: 0 }), 5000, true)
      expect(hit).not.toBeNull()
      expect(Math.abs(2000 - hit!.timeOfImpact - p.y)).toBeLessThan(0.5)
    }
  })

  it('normalAt matches the collider triangle normal', () => {
    const next = rng(77)
    const half = data.size / 2
    const n = { x: 0, y: 0, z: 0 }
    let worst = 0
    for (let i = 0; i < 500; i++) {
      const x = (next() * 2 - 1) * (half - 1)
      const z = (next() * 2 - 1) * (half - 1)
      const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: 2000, z }, { x: 0, y: -1, z: 0 }), 5000, true)
      if (!hit) continue
      sampler.normalAt(x, z, n)
      const dot = n.x * hit.normal.x + n.y * hit.normal.y + n.z * hit.normal.z
      worst = Math.max(worst, 1 - dot)
    }
    expect(worst).toBeLessThan(1e-3)
  })
})

describe('spawn points', () => {
  it('are on flat pads round the coast, apart from each other, facing the volcano', () => {
    for (const seed of [1, 2, 3, 99]) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const pts = Array.from({ length: 24 }, (_, i) => spawnPointAt(s, i))
      const n = { x: 0, y: 0, z: 0 }
      for (const p of pts) {
        const ground = s.heightAt(p.x, p.z)
        expect(ground).toBeCloseTo(SPAWN_LEVEL, 1)
        expect(p.y - ground).toBeGreaterThanOrEqual(0)
        expect(p.y - ground).toBeLessThan(3)
        expect(Math.abs(Math.hypot(p.x, p.z) - d.layout.spawnRadius)).toBeLessThan(30)
        expect(s.normalAt(p.x, p.z, n).y).toBeGreaterThan(0.99)
        // Heading 0 faces -Z; a heading h faces (-sin h, -cos h). That must point at the centre.
        const len = Math.hypot(p.x, p.z)
        expect(-Math.sin(p.heading) * (-p.x / len) + -Math.cos(p.heading) * (-p.z / len)).toBeGreaterThan(0.999)
      }
      // The first eight players each get their own pad, far apart.
      for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
          expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(200)
        }
      }
      // Later players share pads without overlapping.
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(6)
        }
      }
      // Same seed, same spawn.
      expect(spawnPointAt(s, 3)).toEqual(spawnPointAt(s, 3))
    }
  }, 20000)
})
