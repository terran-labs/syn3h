import { describe, expect, it } from 'vitest'
import { FRESH_YAW, homeward, PORTRAIT_PITCH, REST } from '../../src/ui/galaxy/Galaxy'

/**
 * Leaving a world must bring the lobby back to the view a fresh load rests at, with the camera
 * above the orbital plane (the owner, 17 November 2026: after exiting a world the lobby was
 * upside down, the name under the planets). The flight into a world leaves the view on the
 * world's lit side, at any heading and often below the plane; returnHome eases from there.
 */
const fresh = (pitch: number) => ({ yaw: FRESH_YAW, pitch, distance: 30 })
const starts = [
  { yaw: 0.6, pitch: 0.35, distance: 30 },
  { yaw: -2.9, pitch: -0.9, distance: 4 },       // a world's lit side, under the plane, close in
  { yaw: 3.7, pitch: 1.3, distance: 90 },        // orbited far round and steep before entering
  { yaw: 0.6 + Math.PI - 0.01, pitch: -0.2, distance: 12 },
  { yaw: 40, pitch: 0.1, distance: 30 },         // a heading wound many turns by dragging
]
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

describe('the lobby after leaving a world', () => {
  for (const to of [fresh(REST.pitch), fresh(PORTRAIT_PITCH)]) {
    it(`settles at exactly the fresh-load view (pitch ${to.pitch.toFixed(2)}) from any start`, () => {
      for (const from of starts) {
        const end = homeward(from, to, 1)
        expect(wrap(end.yaw - to.yaw)).toBeCloseTo(0, 9)
        expect(end.pitch).toBeCloseTo(to.pitch, 9)
        expect(end.distance).toBeCloseTo(to.distance, 9)
        expect(end.pitch).toBeGreaterThan(0)
      }
    })
    it('turns the short way, never dips below where it started or under the plane once above it', () => {
      for (const from of starts) {
        const short = Math.abs(wrap(to.yaw - from.yaw))
        let prev = homeward(from, to, 0), above = prev.pitch > 0
        for (let i = 1; i <= 200; i++) {
          const p = homeward(from, to, i / 200)
          for (const v of [p.yaw, p.pitch, p.distance]) expect(Number.isFinite(v)).toBe(true)
          expect(Math.abs(wrap(p.yaw - from.yaw))).toBeLessThanOrEqual(short + 1e-9)
          expect(p.pitch).toBeGreaterThanOrEqual(Math.min(from.pitch, to.pitch) - 1e-9)
          if (above) expect(p.pitch).toBeGreaterThan(0)
          above ||= p.pitch > 0
          // No step larger than the whole way spread evenly would allow a jolt (smootherstep peaks at 1.875x).
          expect(Math.abs(p.pitch - prev.pitch)).toBeLessThanOrEqual(Math.abs(to.pitch - from.pitch) * 1.9 / 200 + 1e-9)
          prev = p
        }
      }
    })
  }
})
