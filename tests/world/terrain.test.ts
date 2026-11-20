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
import { sharedTerrain } from './sharedTerrain'

const settings = defaultTerrainSettings()

describe('terrain generation', () => {
  // A coarse grid: the noise lattice is fixed in metres, so the same generator runs at any
  // resolution, a tenth of the work. Full-size worlds are generated twice and compared in the
  // lava test (lava and vents) and the road test (roads).
  const coarse = { resolution: 129 }

  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateTerrain(42, settings, coarse)
    const b = generateTerrain(42, settings, coarse)
    const c = generateTerrain(43, settings, coarse)
    expect(a.heights).toEqual(b.heights)
    expect(a.volcanic).toEqual(b.volcanic)
    expect(terrainChecksum(a)).toBe(terrainChecksum(b))
    expect(terrainChecksum(a)).not.toBe(terrainChecksum(c))
    let diff = 0
    for (let i = 0; i < a.heights.length; i++) if (a.heights[i] !== c.heights[i]) diff++
    expect(diff / a.heights.length).toBeGreaterThan(0.5)
  })

  it('reacts to parameters', () => {
    const a = generateTerrain(7, settings, coarse)
    const b = generateTerrain(7, { ...settings, volcanoHeight: settings.volcanoHeight + 50 }, coarse)
    expect(terrainChecksum(a)).not.toBe(terrainChecksum(b))
  })

  it('has a volcano at the centre with a crater below its flat summit', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = sharedTerrain(seed, settings)
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
  })

  it('is a wrapping tile: opposite edges match, and about the asked share is land', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = sharedTerrain(seed, settings)
      const n = d.resolution
      const h = d.heights
      // The first and last row, and the first and last column, are the same line of the
      // world. They must agree closely enough for the seam to be sealed without a step.
      let seam = 0
      for (let i = 0; i < n; i++) {
        seam = Math.max(seam, Math.abs(h[i] - h[(n - 1) * n + i]), Math.abs(h[i * n] - h[i * n + n - 1]))
      }
      expect(seam).toBeLessThan(0.5)
      let land = 0
      let shelf = 0
      for (let i = 0; i < h.length; i++) {
        if (h[i] > 0) land++
        if (h[i] > -1 && h[i] < 1) shelf++
      }
      expect(Math.abs(land / h.length - settings.landShare)).toBeLessThan(0.12)
      // Nothing sits within a metre of the surface over a wide area (it would flicker
      // through the liquid).
      expect(shelf / h.length).toBeLessThan(0.07)
    }
    // The land share slider does what it says, and a small and a large planet generate.
    const sparse = generateTerrain(7, { ...settings, landShare: 0.32 })
    const full = generateTerrain(7, { ...settings, landShare: 0.8 })
    const share = (d: TerrainData) => d.heights.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) / d.heights.length
    expect(share(sparse)).toBeLessThan(0.45)
    expect(share(full)).toBeGreaterThan(0.7)
    const small = generateTerrain(7, { ...settings, planetSize: 0 })
    expect(small.size).toBe(1024)
    expect(small.resolution).toBe(257)
    expect(small.roads.find((r) => r.kind === 'volcano')).toBeTruthy()
    const large = generateTerrain(7, { ...settings, planetSize: 2 })
    expect(large.size).toBe(4096)
    expect(large.cell).toBe(4)
  })

  it('profiles a continuous cone', () => {
    expect(coneProfile(0)).toBeCloseTo(1, 6)
    expect(coneProfile(0.5 - 1e-9)).toBeCloseTo(coneProfile(0.5 + 1e-9), 6)
    // Concave: steeper near the summit than at the foot.
    expect(coneProfile(0.1) - coneProfile(0.2)).toBeGreaterThan(coneProfile(0.8) - coneProfile(0.9))
    expect(coneProfile(1)).toBe(0)
  })

  it('reports generation time, and fails only on a gross slowdown', () => {
    // Generation time is reported, not pinned (AGENTS.md, testing). It is measured in CPU time
    // spent by this process against a fixed noise workload (the calibration), so waiting for a
    // core does not count; but on a loaded machine shared caches and clocks still slow the
    // generator more than the calibration, so the ratio drifts up with load: about 2.9 idle,
    // 5.02 measured at a load of 18, which failed the old limit of 4.69 (the old 150 ms
    // budget over a 32 ms calibration). The assertion is now a bound no load has come near and
    // only a real regression reaches: four times the idle ratio, a generator that has become
    // four times slower. The ratio is printed for the record.
    const IDLE_RATIO = 2.9
    const GROSS_SLOWDOWN = 4
    const cpuMs = (fn: () => void) => {
      const start = process.cpuUsage()
      fn()
      const used = process.cpuUsage(start)
      return (used.user + used.system) / 1000
    }
    let sink = 0
    const calibrate = () => { for (let i = 0; i < 2_000_000; i++) sink += perlin(i * 0.37, i * 0.11, 7) }
    generateTerrain(4, settings) // warm the JIT, as a running game would be
    calibrate()
    let best = Infinity
    let calibration = Infinity
    const runs: number[] = []
    for (let i = 0; i < 8; i++) {
      calibration = Math.min(calibration, cpuMs(calibrate))
      runs.push(cpuMs(() => { generateTerrain(1000 + i, settings) }))
      best = Math.min(best, runs[i])
    }
    expect(Number.isFinite(sink)).toBe(true)
    const ratio = best / calibration
    const median = [...runs].sort((a, b) => a - b)[runs.length >> 1]
    process.stdout.write(
      `terrain generation 513x513: best ${best.toFixed(1)} ms, median ${median.toFixed(1)} ms of CPU over ${runs.length} runs; ` +
      `calibration ${calibration.toFixed(1)} ms, ratio ${ratio.toFixed(2)} (idle about ${IDLE_RATIO}, fails at ${(IDLE_RATIO * GROSS_SLOWDOWN).toFixed(1)})\n`,
    )
    expect(ratio).toBeLessThan(IDLE_RATIO * GROSS_SLOWDOWN)
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
      const d = sharedTerrain(seed, settings)
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
  })
})
