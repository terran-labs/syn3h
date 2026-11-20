/**
 * Your own "it" marker never covers the middle of your view (the owner, 19 November 2026: it
 * blocked what he was aiming at at certain angles). Bugs these catch: the marker drawn over the
 * reticle at some camera pitch or zoom; the marker jumping as the camera moves.
 *
 * A pinhole camera stands `back` metres behind and `up` metres above the car, pitched by
 * `pitch` (positive looks up), with a 60 degree view; `side` metres to the car's side (an orbited
 * camera, or the touch aim stick turning the view). Shares of the screen's height, so the
 * screen's shape does not enter.
 */
import { describe, expect, it } from 'vitest'
import { CLEAR_MARGIN, clearance, clearOfCentre, localMarkerLift, MARKER_BOTTOM } from '../../src/net/itMarkerRules'

const R = 0.12, FOV = 60
function camera(back: number, up: number, pitchDeg: number, side = 0) {
  const pitch = pitchDeg * Math.PI / 180, t = Math.tan(FOV * Math.PI / 360)
  // The marker's lowest point at `lift` over the car, in the camera's frame, then on screen.
  return (lift: number): [number, number] | null => {
    const y = lift - MARKER_BOTTOM - up, z = back
    const forward = z * Math.cos(pitch) + y * Math.sin(pitch), vertical = y * Math.cos(pitch) - z * Math.sin(pitch)
    if (forward < 0.05) return null
    return [side / forward / (2 * t), vertical / forward / (2 * t)]
  }
}

describe('your own it marker and the middle of the view', () => {
  for (const side of [0, 1.5, 4]) {
    it(`never shows over the centre at any pitch or zoom (${side} m to the side)`, () => {
      for (const back of [4, 8, 14, 25, 45]) for (const up of [1, 3, 6]) for (let pitch = -60; pitch <= 60; pitch += 0.5) {
        const screen = camera(back, up, pitch, side)
        const base = localMarkerLift(back, up, FOV)
        const { lift, opacity } = clearOfCentre(base, R, screen)
        const p = screen(lift)
        if (p && opacity > 0) expect(clearance(p[0], p[1], R), `back ${back} up ${up} pitch ${pitch}`).toBeGreaterThan(0)
        if (opacity === 1 && p) expect(clearance(p[0], p[1], R)).toBeGreaterThanOrEqual(R * CLEAR_MARGIN - 1e-3)
        expect(lift).toBeGreaterThanOrEqual(base)
      }
    })
    it(`moves smoothly as the camera pitches (${side} m to the side)`, () => {
      for (const back of [6, 14, 30]) {
        let last: { lift: number; opacity: number } | null = null
        for (let pitch = -50; pitch <= 50; pitch += 0.05) {
          const screen = camera(back, 3, pitch, side)
          const now = clearOfCentre(localMarkerLift(back, 3, FOV), R, screen)
          if (last) {
            expect(Math.abs(now.lift - last.lift), `back ${back} pitch ${pitch.toFixed(2)}`).toBeLessThan(0.5)
            expect(Math.abs(now.opacity - last.opacity)).toBeLessThan(0.1)
          }
          last = now
        }
      }
    })
  }
  it('leaves a marker that is already clear where it was', () => {
    const screen = camera(10, 3, -20)
    const base = localMarkerLift(10, 3, FOV)
    expect(clearOfCentre(base, R, screen)).toEqual({ lift: base, opacity: 1 })
  })
  it('does nothing when the clear circle is turned off', () => {
    expect(clearOfCentre(4, 0, () => [0, 0])).toEqual({ lift: 4, opacity: 1 })
  })
})
