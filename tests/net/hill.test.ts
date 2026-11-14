import { describe, expect, it } from 'vitest'
import { cleanZone, inZone } from '../../shared/protocol'
import { computeHillZone } from '../../src/modes/hill'

const ring = (cx: number, cz: number, r: number, y: number) =>
  Array.from({ length: 32 }, (_, i) => ({ x: cx + Math.cos(i / 5.09) * r, y, z: cz + Math.sin(i / 5.09) * r }))

describe('computeHillZone', () => {
  it('makes a ring around the rim road, clear of the lava lake', () => {
    const zone = computeHillZone({
      heightAt: () => 0,
      data: {
        lava: { lake: { x: 500, z: -200, radius: 40, surface: 180 } },
        roads: [{ kind: 'volcano', closed: false, points: [] }, { kind: 'rim', closed: true, points: ring(500, -200, 60, 200) }],
      },
    })
    expect(zone.x).toBe(500)
    expect(zone.z).toBe(-200)
    expect(zone.inner).toBe(46) // 60 - 14
    expect(zone.outer).toBe(74)
    expect(zone.yMin).toBe(196)
    expect(cleanZone(zone)).toEqual(zone)
    expect(inZone(zone, [560, 201, -200])).toBe(true)
    expect(inZone(zone, [500, 181, -200])).toBe(false) // in the lake
    expect(inZone(zone, [560, 150, -200])).toBe(false) // below the band
  })

  it('keeps the inner edge out of a lake wider than the road ring allows', () => {
    const zone = computeHillZone({
      heightAt: () => 0,
      data: { lava: { lake: { x: 0, z: 0, radius: 55, surface: 0 } }, roads: [{ kind: 'rim', closed: true, points: ring(0, 0, 60, 10) }] },
    }, 2)
    expect(zone.inner).toBe(57)
    expect(zone.outer).toBe(88)
  })

  it('falls back to the caldera, then to a disc at the origin', () => {
    const v = computeHillZone({ heightAt: () => 300, data: { layout: { volcano: { x: 10, z: 20, calderaRadius: 50 } } } })
    expect(v).toMatchObject({ x: 10, z: 20, yMin: 294 })
    const flat = computeHillZone({ heightAt: () => 5 })
    expect(flat).toMatchObject({ x: 0, z: 0, inner: 0, outer: 25 })
  })
})
