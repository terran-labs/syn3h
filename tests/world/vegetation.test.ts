import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { FLORA, type Ground, type Plant, setTint } from '../../src/world/terrain/flora'
import { flowAt } from '../../src/world/terrain/groundcover'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { KIND_ALPINE, KIND_DESERT, KIND_VOLCANIC, defaultTerrainSettings } from '../../src/world/terrain/settings'

const KINDS = [KIND_VOLCANIC, KIND_DESERT, KIND_ALPINE]

function ground(over: Partial<Ground> = {}): Ground {
  return {
    x: 10, z: 20, y: 30, patch: 0.7, region: 0.6, rock: 0.1, flow: 0, clumpD: 0.3, clump: 0.5, outX: 1, outZ: 0, treeLine: 100,
    ...over,
  }
}

const plant = (): Plant => ({ scale: 0, r: 1, g: 1, b: 1, lx: 0, lz: 0 })

describe('vegetation', () => {
  it('gives every kind of world layers whose shapes fit in eight vertex buffers', () => {
    for (const kind of KINDS) {
      const layers = FLORA[kind].layers(100)
      expect(layers.length).toBeGreaterThan(1)
      // Exactly one layer shades the ground, on the coverage grid.
      const shading = layers.filter((l) => l.shade)
      expect(shading.length).toBe(1)
      expect(shading[0].n).toBe(176)
      expect(shading[0].spacing).toBe(0.8)
      for (const l of layers) {
        const names = Object.keys(l.geometry.attributes).sort()
        // Three per vertex; the instances add four. WebGPU allows eight.
        expect(names).toEqual(['aShape', 'color', 'position'])
        expect(l.geometry.getAttribute('aShape').itemSize).toBe(4)
        expect(l.geometry.getAttribute('position').count % 3).toBe(0)
      }
    }
  })

  it('decides what grows from the ground and the cell alone', () => {
    for (const kind of KINDS) {
      for (const l of FLORA[kind].layers(100)) {
        for (let h = 1; h < 4000; h += 97) {
          const a = plant(), b = plant()
          l.grow(ground(), h * 2654435761 >>> 0, a)
          l.grow(ground(), h * 2654435761 >>> 0, b)
          expect(a).toEqual(b)
          expect(Number.isFinite(a.scale) && a.scale >= 0).toBe(true)
        }
      }
    }
  })

  it('grows more alien plants beside the lava than away from it', () => {
    const [, anemones] = FLORA[KIND_VOLCANIC].layers(100)
    const count = (flow: number) => {
      let n = 0
      for (let h = 0; h < 20000; h++) {
        const p = plant()
        anemones.grow(ground({ flow, patch: 0.5 }), (h * 2654435761) >>> 0, p)
        if (p.scale > 0) n++
      }
      return n
    }
    expect(count(1)).toBeGreaterThan(count(0) * 4)
  })

  it('keeps volcanic plants in one warm family with a rare cold accent', () => {
    const [, anemones] = FLORA[KIND_VOLCANIC].layers(100)
    let warm = 0, cold = 0
    for (let h = 0; h < 40000; h++) {
      const p = plant()
      anemones.grow(ground({ flow: 1 }), (h * 2654435761) >>> 0, p)
      if (!(p.scale > 0)) continue
      if (p.b > p.r) cold++
      else warm++
    }
    const share = cold / (warm + cold)
    expect(share).toBeGreaterThan(0.02)
    expect(share).toBeLessThan(0.09)
  })

  it('stores tints in linear light, as the renderer expects', () => {
    const p = plant()
    setTint(p, 0xff8040, 0, 0)
    const c = new THREE.Color(0xff8040)
    expect(p.r).toBeCloseTo(c.r, 5)
    expect(p.g).toBeCloseTo(c.g, 5)
    // sRGB 0x80 is about 0.22 in linear light, not 0.5.
    expect(p.g).toBeLessThan(0.3)
  })

  it('measures closeness to rivers and pools, falling to nothing far away', () => {
    const data = generateTerrain(3, defaultTerrainSettings())
    const sampler = new HeightSampler(data)
    const pool = data.lava.pools[0]
    expect(flowAt(sampler, pool.x + pool.radius, pool.z, 100)).toBeCloseTo(1, 5)
    const r = data.lava.rivers[0]
    const m = r.points[Math.floor(r.points.length / 2)]
    expect(flowAt(sampler, m.x, m.z, 100)).toBe(1)
    // High above the sea, 40 m from a pool: less than at its edge (another river may be near).
    expect(flowAt(sampler, pool.x + pool.radius + 40, pool.z, 500)).toBeLessThan(1)
  })
})
