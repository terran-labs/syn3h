import { beforeAll, describe, expect, it } from 'vitest'
import { RAPIER, initPhysics } from '../../src/core/physics'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { coneProfile, generateTerrain, shapePass, terrainChecksum, type TerrainData } from '../../src/world/terrain/generate'
import { rng } from '../../src/world/terrain/noise'
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

  it('has a dominant volcano with a caldera below its rim', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      const centre = s.heightAt(v.x, v.z)
      expect(centre).toBeCloseTo(v.floorHeight, 0)
      // Rim higher than the floor, and much higher than the plains.
      const rim = s.heightAt(v.x + v.calderaRadius * 1.05, v.z)
      expect(rim).toBeGreaterThan(centre + 10)
      expect(rim).toBeGreaterThan(settings.volcanoHeight * 0.6)
    }
  })

  it('keeps the natural gentle flank drivable (mostly under 30 degrees)', () => {
    const limit = Math.tan((30 * Math.PI) / 180)
    for (const seed of [1, 2, 3, 99, 12345]) {
      // Shape only: road cut banks cross this straight line and are steep by design.
      const d = generateTerrain(seed, settings, { passes: [shapePass] })
      const s = new HeightSampler(d)
      const v = d.layout.volcano
      // Walk from the gentle foot up to the caldera lip, along the approach that faces spawn.
      const start = v.radius * (1 + v.gentleStretch)
      const end = v.calderaRadius * 1.6
      let steep = 0
      let total = 0
      let max = 0
      for (let r = start; r > end; r -= 2) {
        const x = v.x + v.gentleX * r
        const z = v.z + v.gentleZ * r
        const grade = Math.abs(s.heightAt(x + v.gentleX, z + v.gentleZ) - s.heightAt(x - v.gentleX, z - v.gentleZ)) / 2
        max = Math.max(max, grade)
        if (grade > limit) steep++
        total++
      }
      expect(steep / total).toBeLessThan(0.1)
    }
  })

  it('profiles a continuous cone', () => {
    expect(coneProfile(0)).toBeCloseTo(1, 6)
    expect(coneProfile(0.7 - 1e-9)).toBeCloseTo(coneProfile(0.7 + 1e-9), 6)
    expect(coneProfile(1)).toBe(0)
  })

  it('generates fast enough and reports the time', () => {
    generateTerrain(5, settings) // warm the JIT, as a running game would be
    for (const resolution of [513, 1025]) {
      const runs: number[] = []
      for (let i = 0; i < 3; i++) {
        const t = performance.now()
        generateTerrain(1000 + i, settings, { resolution })
        runs.push(performance.now() - t)
      }
      const best = Math.min(...runs)
      process.stdout.write(`terrain generation ${resolution}x${resolution}: best ${best.toFixed(1)} ms, runs ${runs.map((r) => r.toFixed(1)).join(', ')}\n`)
      if (resolution === 513) expect(best).toBeLessThan(150)
    }
  })
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

  it('is not mirrored or transposed (asymmetric probes on the volcano)', () => {
    const v = data.layout.volcano
    // The volcano is off centre, so a mirror or transpose would move the peak.
    const hit = world.castRay(new RAPIER.Ray({ x: v.x + v.calderaRadius * 1.1, y: 2000, z: v.z }, { x: 0, y: -1, z: 0 }), 5000, true)
    expect(hit).not.toBeNull()
    expect(2000 - hit!.timeOfImpact).toBeGreaterThan(settings.volcanoHeight * 0.6)
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
  it('are on flat ground near the origin and do not overlap', () => {
    for (const seed of [1, 2, 3, 99]) {
      const d = generateTerrain(seed, settings)
      const s = new HeightSampler(d)
      const pts = Array.from({ length: 8 }, (_, i) => spawnPointAt(s, i))
      const n = { x: 0, y: 0, z: 0 }
      for (const p of pts) {
        const ground = s.heightAt(p.x, p.z)
        expect(p.y - ground).toBeGreaterThanOrEqual(0)
        expect(p.y - ground).toBeLessThan(3)
        expect(Math.hypot(p.x, p.z)).toBeLessThan(60)
        expect(s.normalAt(p.x, p.z, n).y).toBeGreaterThan(0.99)
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(7)
        }
      }
      // Same seed, same spawn.
      expect(spawnPointAt(s, 3)).toEqual(spawnPointAt(s, 3))
    }
  })
})
