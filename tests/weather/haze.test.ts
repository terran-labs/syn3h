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
import { FOG_BANK_DENSITY, FOG_DAWN, fogAllDay, fogBanks, fogCoast, fogHourWeights, fogValley } from '../../src/world/weather/fogMap'
import { storminess } from '../../src/world/weather/params'

afterEach(() => { applyPlanet('volcanic', 1, { source: 'preset' }); params.set(storminess.def.id, storminess.def.default) })

/** Distance (m) at which a target at the eye's height keeps `contrast` of itself, looking level, at `hour` at the densest point of a fog bank. */
function visible(contrast: number, eye: number, hour: number): number {
  const h = hazeNow(), a = { density: aerialDensityNow(), height: AERIAL_HEIGHT, sea: h.sea }
  const fog = Number(params.get('weather.fogDensity')?.value ?? 0)
  const w = fogHourWeights(hour, fogAllDay.value)
  // The worst fog bank: a cell at full density, at the bank's floor.
  const bank = FOG_BANK_DENSITY * fogBanks.value * Math.max(fogCoast.value * w.coast, fogValley.value * w.valley)
  const at = { x: 0, y: h.sea + eye, z: 0 }
  let L = 1
  while (L < 20000) {
    const to = { x: L, y: at.y, z: 0 }
    if (Math.exp(-(hazeDepth(h, at, to) + hazeDepth(a, at, to) + (fog * L) ** 2 + bank * L)) <= contrast) break
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
  // The owner's floor (the Foreman, 19 November 2026): inside a fog bank at its dawn peak, on
  // the worlds whose character is fog, a driver sees 20% contrast at 80 m; everywhere else,
  // and outside the dawn window everywhere, at 150 m. In a gale, 2 m above the ground.
  const FOG_WORLDS = ['archipelago', 'alpine', 'ice', 'swamp']
  it('lets a driver see far enough to steer on every world, at every hour, in a gale', () => {
    for (const p of PLANETS) {
      applyPlanet(p.id, 1, { source: 'preset' })
      params.set(storminess.def.id, 1)
      for (let hour = 0; hour < 24; hour += 0.25) {
        const dawn = hour >= FOG_DAWN.from && hour <= FOG_DAWN.to
        const floor = dawn && FOG_WORLDS.includes(p.id) ? 80 : 150
        const v = visible(0.2, 2, hour)
        if (process.env.HAZE_REPORT && hour === FOG_DAWN.peak) console.log(`${p.id}: ${Math.round(v)} m at the dawn peak`)
        expect(v, `${p.id} at ${hour} h`).toBeGreaterThan(floor)
      }
    }
  })
  it('turns the fog banks off at strength 0', () => {
    applyPlanet('archipelago', 1, { source: 'preset' })
    const clear = (() => { params.set('weather.fogBanks', 0); return visible(0.2, 2, FOG_DAWN.peak) })()
    params.set('weather.fogBanks', 1)
    expect(visible(0.2, 2, FOG_DAWN.peak)).toBeLessThan(clear)
  })
})
