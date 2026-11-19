/**
 * Fog maps (src/world/weather/fogMap.ts). Bugs these catch: fog stuck on at dawn when the day
 * clock is held at noon; fog on high dry ground or over lava; a map with values outside 0..1
 * or NaN; banks that are not the world's own (same for every seed).
 */
import { describe, expect, it } from 'vitest'
import { buildFogMap, fogHourWeights, sampleFogMap } from '../../src/world/weather/fogMap'

/** A round island 600 m across in a 2 km sea, a bowl valley in its middle, a lava pool east. */
const island = {
  size: 2000,
  heightAt(x: number, z: number) {
    const r = Math.hypot(x, z)
    const island = r < 600 ? 60 * Math.cos((r / 600) * Math.PI / 2) : -20
    const bowl = Math.hypot(x + 150, z) < 120 ? -30 * Math.cos((Math.hypot(x + 150, z) / 120) * Math.PI / 2) : 0
    return island + bowl
  },
  liquidAt(x: number, z: number) {
    if (Math.hypot(x - 300, z) < 60) return 'lava'
    return this.heightAt(x, z) < 0 ? 'water' : null
  },
}

describe('fog map', () => {
  const map = buildFogMap(island, 0, 7)
  it('is finite and in range everywhere', () => {
    for (let i = 0; i < map.data.length; i += 4) {
      for (let c = 0; c < 2; c++) { expect(Number.isFinite(map.data[i + c])).toBe(true); expect(map.data[i + c]).toBeGreaterThanOrEqual(0); expect(map.data[i + c]).toBeLessThanOrEqual(1) }
      expect(map.data[i + 2]).toBeGreaterThanOrEqual(0)
    }
  })
  it('puts coastal fog over the near sea and the shore, not far inland or on lava', () => {
    const at = (x: number, z: number) => sampleFogMap(map, x, z)
    // Near-shore sea, averaged round the island (the seeded breakup varies it).
    let shore = 0, inland = 0
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; shore += at(Math.cos(a) * 700, Math.sin(a) * 700).coast; inland += at(Math.cos(a) * 150 + 100, Math.sin(a) * 150).coast }
    expect(shore / 16).toBeGreaterThan(0.3)
    expect(inland / 16).toBeLessThan(shore / 16)
    expect(at(300, 0).coast).toBeLessThan(0.15)
  })
  it('pools valley fog in the bowl and not on the open slope', () => {
    expect(sampleFogMap(map, -150, 0).valley).toBeGreaterThan(sampleFogMap(map, 250, 250).valley)
    expect(sampleFogMap(map, 800, 800).valley).toBe(0)
  })
  it('is each world\'s own', () => {
    const other = buildFogMap(island, 0, 8)
    let diff = 0
    for (let i = 0; i < map.data.length; i++) diff += Math.abs(map.data[i] - other.data[i])
    expect(diff).toBeGreaterThan(1)
  })
})

describe('fog by the hour', () => {
  it('rolls the coastal fog in at dawn and burns it off by noon', () => {
    expect(fogHourWeights(6.5).coast).toBeGreaterThan(0.9)
    expect(fogHourWeights(12).coast).toBeLessThan(0.05)
  })
  it('pools valley fog at night, thickest at dawn, and lifts it by midday', () => {
    expect(fogHourWeights(2).valley).toBeGreaterThan(0.2)
    expect(fogHourWeights(6.5).valley).toBeGreaterThan(fogHourWeights(2).valley)
    expect(fogHourWeights(13).valley).toBeLessThan(1e-6)
  })
  it('keeps a marsh\'s all-day share at noon', () => {
    expect(fogHourWeights(12, 0.25).coast).toBeGreaterThanOrEqual(0.25)
    expect(fogHourWeights(12, 0.25).valley).toBeGreaterThanOrEqual(0.25)
  })
})

// Bug this catches: a fog graph that throws while it is built (an If outside a shader
// function did, on 18 November 2026), which leaves the game unable to start at all.
describe('the fog node with banks', () => {
  it('builds', async () => {
    const THREE = await import('three/webgpu')
    const { texture, uniform, vec3 } = await import('three/tsl')
    const { heightFog } = await import('../../src/world/weather/fog')
    const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType)
    const banks = { map: texture(t), weights: uniform(new THREE.Vector2(0.006, 0.006)), invSize: uniform(1 / 2048), height: uniform(25), detail: uniform(2), atCamera: uniform(new THREE.Vector3(0.5, 0.5, 10)), glow: uniform(1.5) }
    expect(() => heightFog(vec3(0.5, 0.6, 0.7), uniform(0.0002), undefined, banks)).not.toThrow()
  })
})
