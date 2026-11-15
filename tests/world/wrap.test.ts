import { beforeAll, describe, expect, it } from 'vitest'
import { RAPIER, initPhysics } from '../../src/core/physics'
import { COLLIDER_MARGIN, createTerrainCollider } from '../../src/world/terrain/collider'
import { type TerrainData, generateTerrain } from '../../src/world/terrain/generate'
import { rng } from '../../src/world/terrain/noise'
import { HeightSampler, sealSeam } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

const settings = defaultTerrainSettings()

describe('wrapping terrain', () => {
  let world: RAPIER.World
  let data: TerrainData
  let sampler: HeightSampler
  let correction = 0

  beforeAll(async () => {
    await initPhysics()
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    data = generateTerrain(314159, settings)
    correction = sealSeam(data)
    sampler = new HeightSampler(data)
    createTerrainCollider(world, data)
    world.step()
  })

  it('seals the seam: the far row and column equal the first', () => {
    const n = data.resolution
    const h = data.heights
    for (let i = 0; i < n; i++) {
      expect(h[i * n + n - 1]).toBe(h[i * n])
      expect(h[(n - 1) * n + i]).toBe(h[i])
    }
    process.stdout.write(`seam correction: ${correction.toExponential(2)} m\n`)
    expect(correction).toBeLessThan(5)
  })

  it('heightAt and normalAt repeat every size metres on both axes', () => {
    const next = rng(5)
    const size = data.size
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    let worst = 0
    let worstN = 0
    for (let i = 0; i < 2000; i++) {
      const x = (next() * 2 - 1) * size
      const z = (next() * 2 - 1) * size
      const h = sampler.heightAt(x, z)
      sampler.normalAt(x, z, a)
      for (const [dx, dz] of [[size, 0], [0, size], [-size, size], [2 * size, -3 * size]]) {
        worst = Math.max(worst, Math.abs(sampler.heightAt(x + dx, z + dz) - h))
        sampler.normalAt(x + dx, z + dz, b)
        worstN = Math.max(worstN, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
      }
    }
    // Float rounding of x + size moves the sample by under a millimetre on a 4 m cell.
    expect(worst).toBeLessThan(1e-3)
    expect(worstN).toBeLessThan(1e-3)
  })

  it('is continuous across the seam', () => {
    const half = data.size / 2
    for (let z = -half; z < half; z += 37) {
      expect(Math.abs(sampler.heightAt(half - 1e-3, z) - sampler.heightAt(-half, z))).toBeLessThan(0.01)
      expect(Math.abs(sampler.heightAt(z, half - 1e-3) - sampler.heightAt(z, -half))).toBeLessThan(0.01)
    }
  })

  it('collider matches heightAt in the wrapped margin past every edge', () => {
    const next = rng(99)
    const half = data.size / 2
    const margin = COLLIDER_MARGIN * data.cell
    let worst = 0
    let misses = 0
    let rays = 0
    const cast = (x: number, z: number) => {
      rays++
      const top = 2000
      const hit = world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 5000, true)
      if (!hit) { misses++; return }
      worst = Math.max(worst, Math.abs(top - hit.timeOfImpact - sampler.heightAt(x, z)))
    }
    for (let i = 0; i < 2000; i++) {
      // A point in the band past one edge (or a corner), up to a metre short of the margin's end.
      const along = (next() * 2 - 1) * (half + margin - 1)
      const out = half + next() * (margin - 1)
      const side = i % 4
      if (side === 0) cast(out, along)
      else if (side === 1) cast(-out, along)
      else if (side === 2) cast(along, out)
      else cast(along, -out)
    }
    process.stdout.write(`margin collider vs heightAt: worst ${worst.toExponential(2)} m over ${rays} rays\n`)
    expect(misses).toBe(0)
    expect(worst).toBeLessThan(0.01)
  })
})
