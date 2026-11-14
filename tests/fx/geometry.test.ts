import { describe, expect, it } from 'vitest'
import { buildRibbonGeometry, traceDownhill } from '../../src/fx/LavaFlow'
const ground = { size: 100, heightAt: (x: number, z: number) => (x * x + z * z) * 0.02 }
describe('downhill trace', () => {
  it('is deterministic and strictly descends a bowl to its minimum', () => {
    const a = traceDownhill(ground, { x: 30, z: 20 })
    expect(a).toEqual(traceDownhill(ground, { x: 30, z: 20 }))
    expect(a.length).toBeGreaterThan(10)
    a.slice(1).forEach((point, i) => expect(point.y).toBeLessThan(a[i].y))
    expect(a.at(-1)!.y).toBeLessThan(0.001)
  })
  it('stops on flats, at requested heights and at boundaries', () => {
    expect(traceDownhill({ size: 10, heightAt: () => 1 }, { x: 0, z: 0 })).toHaveLength(1)
    const a = traceDownhill(ground, { x: 10, z: 10 }, { stopHeight: 2 })
    expect(a.at(-1)!.y).toBeLessThanOrEqual(2)
    const edge = traceDownhill({ size: 10, heightAt: (x) => -x }, { x: 0, z: 0 })
    expect(edge.at(-1)!.x).toBe(5)
  })
})
describe('ribbon', () => {
  it('drapes every edge and preserves downstream UV distances and counts', () => {
    const geometry = buildRibbonGeometry(ground, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 6, z: 0 }], 2)
    const positions = geometry.attributes.position
    expect(positions.count).toBe(6); expect(geometry.index!.count).toBe(12)
    for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(ground.heightAt(positions.getX(i), positions.getZ(i)) + 0.15)
    expect(geometry.attributes.uv.getY(4)).toBe(6)
    geometry.dispose()
  })
  it('rejects degenerate dimensions', () => {
    expect(() => buildRibbonGeometry(ground, [], 2)).toThrow()
    expect(() => traceDownhill(ground, { x: 0, z: 0 }, { step: 0 })).toThrow()
  })
})
