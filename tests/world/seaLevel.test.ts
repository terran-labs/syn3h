import { afterEach, describe, expect, it } from 'vitest'
import { params, worldLavaAltitude } from '../../shared/params'
import { GLIDE_SECONDS, onSeaSettled, seaLevel, seaLevelSpeed, seaSettled, setSeaClock, snapSeaLevel } from '../../src/world/seaLevel'

// Bug caught: the sea teleporting when the slider moves (vehicles launched or dropped), or a
// glide that never reaches the shared setting, so players in one room disagree on the coast.
let now = 0
setSeaClock(() => now)
afterEach(() => { now = 0; params.set(worldLavaAltitude.def.id, 0, 'local'); snapSeaLevel() })

/** The largest jump in level between samples dt apart, over a span of time. */
function largestStep(from: number, to: number, dt = 1 / 240): number {
  let worst = 0
  now = from
  let last = seaLevel()
  for (let t = from + dt; t <= to; t += dt) { now = t; const v = seaLevel(); worst = Math.max(worst, Math.abs(v - last)); last = v }
  return worst
}

describe('sea level glide', () => {
  it('moves continuously from the old level to the new one and settles on the setting', () => {
    now = 10
    params.set(worldLavaAltitude.def.id, 40, 'remote')
    expect(seaLevel()).toBe(0)
    // 40 m in 1.5 s: no step between 1/240 s samples is more than a sliver of it.
    expect(largestStep(10, 10 + GLIDE_SECONDS + 0.2)).toBeLessThan(40 / 60)
    expect(seaLevel()).toBe(40)
    expect(seaSettled()).toBe(true)
    expect(seaLevelSpeed()).toBe(0)
  })

  it('stays continuous when the target changes mid-glide, and ends on the last value', () => {
    now = 0
    params.set(worldLavaAltitude.def.id, 30, 'local')
    now = 0.5
    const before = seaLevel()
    const speedBefore = seaLevelSpeed()
    params.set(worldLavaAltitude.def.id, -20, 'local')
    expect(seaLevel()).toBeCloseTo(before, 9)
    expect(seaLevelSpeed()).toBeCloseTo(speedBefore, 9)
    expect(largestStep(0.5, 0.5 + GLIDE_SECONDS + 0.2)).toBeLessThan(50 / 60)
    expect(seaLevel()).toBe(-20)
  })

  it('reports its speed as the rate the level actually changes', () => {
    now = 0
    params.set(worldLavaAltitude.def.id, 20, 'local')
    now = 0.6
    const a = seaLevel(), speed = seaLevelSpeed()
    now = 0.6 + 1e-4
    expect((seaLevel() - a) / 1e-4).toBeCloseTo(speed, 2)
  })

  it('tells listeners once it has settled, and a terrain rebuild snaps it', () => {
    let settledCount = 0
    const off = onSeaSettled(() => settledCount++)
    now = 0
    params.set(worldLavaAltitude.def.id, 12, 'local')
    now = GLIDE_SECONDS + 0.01
    expect(seaSettled()).toBe(true)
    expect(settledCount).toBe(1)
    params.set(worldLavaAltitude.def.id, -5, 'remote')
    snapSeaLevel()
    expect(seaLevel()).toBe(-5)
    off()
  })

  it('never changes the shared setting itself', () => {
    now = 0
    params.set(worldLavaAltitude.def.id, 25, 'local')
    now = 0.3
    seaLevel()
    expect(worldLavaAltitude.value).toBe(25)
  })
})
