import { describe, expect, it } from 'vitest'
import { cleanZone, inZone } from '../../shared/protocol'
import { computeHillZone } from '../../src/modes/hill'

const spawn = (x: number, z: number) => () => ({ position: { x, z } })

describe('computeHillZone', () => {
  it('makes a ring around the rim road, clear of the lava lake', () => {
    const zone = computeHillZone({
      heightAt: () => 0,
      spawnPoint: spawn(900, 900),
      summit: () => ({ x: 500, z: -200, rimRadius: 60, rimHeight: 200, lake: { radius: 40, surface: 180 } }),
    })
    expect(zone).toEqual({ x: 500, z: -200, inner: 46, outer: 74, yMin: 185, yMax: 225 })
    expect(cleanZone(zone)).toEqual(zone)
    expect(inZone(zone, [560, 201, -200])).toBe(true)
    expect(inZone(zone, [500, 181, -200])).toBe(false) // in the lake
    expect(inZone(zone, [560, 150, -200])).toBe(false) // below the band
  })

  it('keeps the inner edge out of a lake wider than the road ring allows', () => {
    const zone = computeHillZone({
      heightAt: () => 0,
      spawnPoint: spawn(0, 0),
      summit: () => ({ x: 0, z: 0, rimRadius: 60, rimHeight: 10, lake: { radius: 55, surface: 0 } }),
    }, 2)
    expect(zone.inner).toBe(57)
    expect(zone.outer).toBe(88)
  })

  it('without a summit, uses a disc at spawn point 0, wherever that is', () => {
    const flat = computeHillZone({ heightAt: () => 5, spawnPoint: spawn(-700, 320), summit: () => null })
    expect(flat).toMatchObject({ x: -700, z: 320, inner: 0, outer: 25, yMin: -1 })
    expect(computeHillZone({ heightAt: () => 5, spawnPoint: spawn(1, 2) })).toMatchObject({ x: 1, z: 2 })
  })
})

import { StuckTimer, inStickyLiquid } from '../../src/modes/Koth'

describe('inStickyLiquid', () => {
  const at = { x: 0, y: 4.9, z: 0 }
  it('counts any liquid when the terrain cannot tell lava from water', () => {
    expect(inStickyLiquid({ liquidHeightAt: () => 5 }, at)).toBe(true)
    expect(inStickyLiquid({ liquidHeightAt: () => 4 }, at)).toBe(false)
    expect(inStickyLiquid({ liquidHeightAt: () => -Infinity }, at)).toBe(false)
    expect(inStickyLiquid({}, at)).toBe(false)
  })
  it('counts only lava when it can: water never sticks', () => {
    expect(inStickyLiquid({ liquidHeightAt: () => 5, liquidKindAt: () => 'lava' }, at)).toBe(true)
    expect(inStickyLiquid({ liquidHeightAt: () => 5, liquidKindAt: () => 'water' }, at)).toBe(false)
  })
})

describe('StuckTimer', () => {
  it('reports stuck once, then lifts the vehicle back to its pad after the delay', () => {
    const t = new StuckTimer()
    expect(t.step(10, false, 3)).toBe(null)
    expect(t.step(11, true, 3)).toBe('stuck')
    expect(t.stuck).toBe(true)
    expect(t.step(12, true, 3)).toBe(null)
    expect(t.step(13.9, true, 3)).toBe(null)
    expect(t.step(14, true, 3)).toBe('returned')
    expect(t.stuck).toBe(false)
    // Back on the pad, clear of the lava: nothing more to report.
    expect(t.step(14.1, false, 3)).toBe(null)
  })
  it('lets a vehicle crawl out, but only once it has been clear for half a second', () => {
    const t = new StuckTimer()
    expect(t.step(1, true, 3)).toBe('stuck')
    expect(t.step(1.5, false, 3)).toBe(null)
    // Bobbed back under: the clear time starts again and it is still the same stuck.
    expect(t.step(1.7, true, 3)).toBe(null)
    expect(t.step(2, false, 3)).toBe(null)
    expect(t.step(2.4, false, 3)).toBe(null)
    expect(t.step(2.5, false, 3)).toBe('crawled')
    expect(t.stuck).toBe(false)
    expect(t.step(3, true, 3)).toBe('stuck')
  })
  it('forgets the countdown when cleared', () => {
    const t = new StuckTimer()
    t.step(1, true, 3)
    t.clear()
    expect(t.stuck).toBe(false)
    expect(t.step(2, false, 3)).toBe(null)
  })
})
