import { describe, expect, it } from 'vitest'
import { approach } from '../../src/ui/galaxy/Galaxy'

const TILT = 0.38
/** The island's bearing from its world's centre for a spin: see approach. */
const islandBearing = (spin: number) => Math.atan2(-Math.sin(spin), Math.cos(TILT) * Math.cos(spin))
const turn = (a: number, b: number) => { const d = (b - a) % (Math.PI * 2); return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d }

describe('galaxy approach: the camera moves, the world does not', () => {
  it('goes to the island itself when the island is on the lit side', () => {
    for (const sun of [0, 1.1, -2.4]) for (const off of [0.6, 1.0, 1.3, -0.7, -1.2]) {
      // A spin that puts the island `off` round from the sun.
      let spin = 0, best = Infinity
      for (let s = -Math.PI; s < Math.PI; s += 0.0005) { const d = Math.abs(turn(sun + off, islandBearing(s))); if (d < best) { best = d; spin = s } }
      const { facing, latitude } = approach(sun, spin, sun)
      expect(Math.abs(turn(facing, islandBearing(spin)))).toBeLessThan(0.002)
      // And tilts to the island's own latitude, within the world's lean.
      expect(Math.abs(latitude)).toBeLessThanOrEqual(TILT + 1e-9)
      expect(latitude).toBeCloseTo(Math.asin(Math.sin(TILT) * Math.cos(spin)), 9)
    }
  })
  it('never settles on the night side or straight down the sun, whatever the world\'s turn', () => {
    for (let spin = -Math.PI; spin < Math.PI; spin += 0.01) for (const sun of [0, 2]) for (const from of [sun + 1, sun - 1]) {
      const off = Math.abs(turn(sun, approach(sun, spin, from).facing))
      expect(off).toBeGreaterThanOrEqual(0.5 - 1e-9); expect(off).toBeLessThanOrEqual(1.35 + 1e-9)
    }
  })
  it('takes the island\'s side of the sun, and the camera\'s own side when the island is dead behind', () => {
    const sun = 0.3
    for (let spin = -Math.PI; spin < Math.PI; spin += 0.01) {
      const island = turn(sun, islandBearing(spin)), settle = approach(sun, spin, sun + 1)
      if (Math.abs(Math.abs(island) - Math.PI) >= 0.2) expect(settle.side).toBe(island >= 0 ? 1 : -1)
      else expect(settle.side).toBe(1)
    }
  })
  it('keeps the side it took, so the camera never swings across the sun after an island', () => {
    const sun = 0, first = approach(sun, 0.4, sun + 1)
    let last = first.facing
    // The world turns a whole day under a settled camera: the bearing moves smoothly, on one side.
    for (let spin = 0.4; spin < 0.4 + Math.PI * 2; spin += 0.01) {
      const { facing, side } = approach(sun, spin, last, first.side)
      expect(side).toBe(first.side)
      expect(turn(sun, facing) * first.side).toBeGreaterThan(0)
      expect(Math.abs(turn(last, facing))).toBeLessThan(0.9)   // one step at the limits, never across the sun
      last = facing
    }
  })
})
