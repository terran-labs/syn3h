/**
 * Height fog (src/world/weather/fog.ts): plainly there on every world with air, none on an
 * airless one, thinning with height, and never hiding the volcano from a spawn pad. The pad
 * view is a release gate, so it is checked on the real generated island of each planet, for
 * several seeds, in a gale.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { params } from '../../shared/params'
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'
import { hazeDepth, hazeNow } from '../../src/world/weather/fog'
import { storminess } from '../../src/world/weather/params'
import { PLANET_WEATHER } from '../../src/world/weather/planetWeather'

afterEach(() => { applyPlanet('volcanic', 1, { source: 'preset' }); params.set(storminess.def.id, storminess.def.default) })

const seen = (tau: number) => Math.exp(-tau)

describe('height fog', () => {
  it('is thick at sea level and thin at the summit', () => {
    const h = { density: 0.0009, height: 90, sea: 0 }
    const low = hazeDepth(h, new Vector3(0, 2, 0), new Vector3(1000, 2, 0))
    const high = hazeDepth(h, new Vector3(0, 400, 0), new Vector3(1000, 400, 0))
    expect(seen(low)).toBeLessThan(0.5)
    expect(seen(high)).toBeGreaterThan(0.98)
    // Equal heights: the closed form meets its limit.
    const near = hazeDepth(h, new Vector3(0, 50, 0), new Vector3(1000, 50.0001, 0))
    expect(near).toBeCloseTo(0.0009 * 1000 * Math.exp(-50 / 90), 6)
    // Looking up and looking down along the same ray see the same haze.
    const a = new Vector3(0, 10, 0), b = new Vector3(800, 300, 100)
    expect(hazeDepth(h, a, b)).toBeCloseTo(hazeDepth(h, b, a), 10)
  })

  it('is set by every planet, with none on an airless one', () => {
    for (const p of PLANETS) {
      applyPlanet(p.id, 1, { source: 'preset' })
      const h = hazeNow()
      if (params.get('world.atmosphere')?.value === 0) expect(h.density).toBe(0)
      else {
        expect(PLANET_WEATHER[p.id], p.id).toBeDefined()
        // Plainly visible: at most two thirds of a shore 1 km away shows through.
        expect(seen(hazeDepth(h, new Vector3(0, 3, 0), new Vector3(1000, 3, 0))), p.id).toBeLessThan(0.67)
      }
    }
    expect(PLANET_WEATHER.moon['weather.hazeDensity']).toBe(0)
  })

  it('never hides the volcano from a spawn pad, even in a gale', () => {
    const report: string[] = []
    for (const p of PLANETS) {
      for (const seed of [1, 4821]) {
        applyPlanet(p.id, seed, { source: 'preset' })
        params.set(storminess.def.id, 1, 'preset')
        const h = hazeNow()
        const data = generateTerrain(seed, currentTerrainSettings())
        const sampler = new HeightSampler(data)
        const v = data.layout.volcano
        const peak = sampler.heightAt(v.x, v.z)
        for (let i = 0; i < 4; i++) {
          const s = spawnPointAt(sampler, i)
          const eye = new Vector3(s.x, s.y + 3, s.z)
          // The rim on the side facing the pad, and the flank half way up.
          const dx = s.x - v.x, dz = s.z - v.z, d = Math.hypot(dx, dz) || 1
          let rimH = 0, rimR = 0
          for (let r = 20; r < 400; r += 5) { const y = sampler.heightAt(v.x + dx / d * r, v.z + dz / d * r); if (y > rimH) { rimH = y; rimR = r } }
          const rim = new Vector3(v.x + dx / d * rimR, rimH, v.z + dz / d * rimR)
          let flankR = rimR
          while (flankR < d && sampler.heightAt(v.x + dx / d * flankR, v.z + dz / d * flankR) > rimH / 2) flankR += 5
          const flank = new Vector3(v.x + dx / d * flankR, sampler.heightAt(v.x + dx / d * flankR, v.z + dz / d * flankR), v.z + dz / d * flankR)
          const rimSeen = seen(hazeDepth(h, eye, rim)), flankSeen = seen(hazeDepth(h, eye, flank))
          report.push(`${p.id} ${seed} pad ${i}: ${d.toFixed(0)} m, peak ${peak.toFixed(0)}, rim ${(rimSeen * 100).toFixed(0)}%, flank ${(flankSeen * 100).toFixed(0)}%`)
          expect(rimSeen, `${p.id} seed ${seed} pad ${i} rim`).toBeGreaterThan(0.7)
          expect(flankSeen, `${p.id} seed ${seed} pad ${i} flank`).toBeGreaterThan(0.45)
        }
      }
    }
    console.log(report.join('\n'))
  }, 120_000)
})
