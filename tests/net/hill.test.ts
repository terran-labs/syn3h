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
