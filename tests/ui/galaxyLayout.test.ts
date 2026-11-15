import { describe, expect, it } from 'vitest'
import { GALAXY_MAX, orbitLayout } from '../../src/ui/galaxy/Galaxy'

/** The narrowest clear space between any two worlds' surfaces, over many moments. */
function smallestGap(count: number): number {
  let smallest = Infinity
  // An hour of orbit in uneven steps, so no alignment of the orbits is skipped over.
  for (let step = 0; step < 4000; step++) {
    const places = orbitLayout(count, step * 0.917)
    for (let a = 0; a < places.length; a++) for (let b = a + 1; b < places.length; b++) {
      const [ax, ay, az] = places[a].position, [bx, by, bz] = places[b].position
      smallest = Math.min(smallest, Math.hypot(ax - bx, ay - by, az - bz) - places[a].radius - places[b].radius)
    }
  }
  return smallest
}

describe('galaxy layout', () => {
  it('never lets two worlds touch, with clear space between them, for every count', () => {
    const gaps = Array.from({ length: GALAXY_MAX - 1 }, (_, i) => smallestGap(i + 2))
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(0.25)
    // The tightest pair anywhere: neighbouring orbits with their largest worlds lined up.
    expect(Math.min(...gaps)).toBeCloseTo(0.3, 2)
  })
  it('places one world for each, up to the limit, and keeps them moving', () => {
    for (let count = 1; count <= GALAXY_MAX + 2; count++) expect(orbitLayout(count, 0)).toHaveLength(Math.min(count, GALAXY_MAX))
    expect(orbitLayout(5, 0)[0].position).not.toEqual(orbitLayout(5, 10)[0].position)
  })
  it('is the same every time for the same moment', () => {
    expect(orbitLayout(10, 123.4)).toEqual(orbitLayout(10, 123.4))
  })
  it('keeps the system inside the size the first view frames', () => {
    for (let count = 1; count <= GALAXY_MAX; count++) for (const place of orbitLayout(count, 7)) expect(Math.hypot(...place.position)).toBeLessThanOrEqual(7.25)
  })
})
