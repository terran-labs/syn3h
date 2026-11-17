/**
 * Landforms (extra mountains and islands) on every planet. Bugs caught: a mountain or isle
 * breaking the wrap into a cliff at the tile's edge; a non-finite height; the landing point
 * ending up under water or on a slope.
 */
import { describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { generateTerrain, shapeHeight } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { spawnPointAt } from '../../src/world/terrain/spawn'
import { currentTerrainSettings } from '../../src/world/terrain/settings'

describe('landforms', () => {
  it('keep every planet finite, wrapping and landing on dry flat ground, even crowded', () => {
    const n = { x: 0, y: 0, z: 0 }
    for (const p of PLANETS) {
      for (const seed of [1, 4242]) {
        applyPlanet(p.id, seed)
        // As many as the sliders allow, so they reach the edges of the tile.
        params.set('terrain.landforms', 12)
        params.set('terrain.isles', 12)
        const s = currentTerrainSettings()
        const d = generateTerrain(seed, s)
        const label = `${p.id} ${seed}`
        expect(d.heights.every(Number.isFinite), `${label} finite`).toBe(true)
        // The analytic field itself, before the seam is sealed, meets across both edges.
        const half = d.size / 2
        let seam = 0
        for (let t = -half; t < half; t += 8) {
          seam = Math.max(seam,
            Math.abs(shapeHeight(d.layout, s, -half, t) - shapeHeight(d.layout, s, half, t)),
            Math.abs(shapeHeight(d.layout, s, t, -half) - shapeHeight(d.layout, s, t, half)))
        }
        expect(seam, `${label} seam`).toBeLessThan(0.5)
        // The landing point: a flat pad, clear of the sea.
        const sampler = new HeightSampler(d)
        const pad = spawnPointAt(sampler, 0)
        expect(pad.y, `${label} pad above sea`).toBeGreaterThan(Number(params.get('world.lavaAltitude')!.value) + 5)
        expect(sampler.normalAt(pad.x, pad.z, n).y, `${label} pad flat`).toBeGreaterThan(0.99)
      }
    }
    applyPlanet('volcanic', 1)
  }, 120000)
})
