/**
 * The haze field (src/world/weather/haze.ts) and the playability floor on every world's haze.
 *
 * Bugs these catch:
 *  - the sky's horizon band going negative, NaN or above full (a black or flashing horizon);
 *  - the band not following the haze (thicker looking up than at the horizon, or present on an
 *    airless world);
 *  - a world fogged so thickly that a driver cannot see far enough to steer at speed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { AERIAL_HEIGHT, aerialDensityNow, hazeDepth, hazeNow } from '../../src/world/weather/fog'
import { skyHazeDepthCpu } from '../../src/world/weather/haze'
import { storminess } from '../../src/world/weather/params'

afterEach(() => { applyPlanet('volcanic', 1, { source: 'preset' }); params.set(storminess.def.id, storminess.def.default) })

/** Distance (m) at which a target at the eye's height keeps `contrast` of itself, looking level. */
function visible(contrast: number, eye: number): number {
  const h = hazeNow(), a = { density: aerialDensityNow(), height: AERIAL_HEIGHT, sea: h.sea }
  const fog = Number(params.get('weather.fogDensity')?.value ?? 0)
  const at = { x: 0, y: h.sea + eye, z: 0 }
  let L = 1
  while (L < 20000) {
    const to = { x: L, y: at.y, z: 0 }
    if (Math.exp(-(hazeDepth(h, at, to) + hazeDepth(a, at, to) + (fog * L) ** 2)) <= contrast) break
    L *= 1.02
  }
  return L
}

describe('the sky horizon band', () => {
  const u = { density: 0.0024, height: 40, aerialDensity: 0.0001, aerialHeight: 1600, camAbove: 2, invR: 1 / 770 }
  it('is finite and non-negative for every direction, height and planet size', () => {
    for (const invR of [0, 1 / 300, 1 / 770, 1 / 5000]) for (const camAbove of [0, 2, 50, 800]) for (let y = -0.3; y <= 1; y += 0.05) {
      const tau = skyHazeDepthCpu(y, { ...u, invR, camAbove })
      expect(Number.isFinite(tau)).toBe(true)
      expect(tau).toBeGreaterThanOrEqual(0)
    }
  })
  it('is thickest at the horizon and thins looking up and from higher up', () => {
    const at = (y: number, camAbove = 2) => skyHazeDepthCpu(y, { ...u, camAbove })
    expect(at(0)).toBeGreaterThan(at(0.1))
    expect(at(0.1)).toBeGreaterThan(at(0.5))
    expect(at(0, 500)).toBeLessThan(at(0, 2))
  })
  it('is none with no haze', () => {
    expect(skyHazeDepthCpu(0, { ...u, density: 0, aerialDensity: 0 })).toBe(0)
  })
})

describe('haze playability floor', () => {
  it('lets a driver see far enough to steer on every world, in a gale', () => {
    for (const p of PLANETS) {
      applyPlanet(p.id, 1, { source: 'preset' })
      params.set(storminess.def.id, 1)
      // 20% contrast at 150 m: about five seconds ahead at 30 m/s.
      expect(visible(0.2, 2), p.id).toBeGreaterThan(150)
    }
  })
})
