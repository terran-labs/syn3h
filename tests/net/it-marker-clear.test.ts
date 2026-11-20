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
import { CLEAR_MARGIN, clearOfCentre, localMarkerLift, markerGap, type OwnMarker, stepOwnMarker } from '../../src/net/itMarkerRules'

const R = 0.12, FOV = 60
function camera(back: number, up: number, pitchDeg: number, side = 0) {
  const pitch = pitchDeg * Math.PI / 180, t = Math.tan(FOV * Math.PI / 360)
  // A point `height` metres over the car, in the camera's frame, then on screen.
  return (height: number): [number, number] | null => {
    const y = height - up, z = back
    const forward = z * Math.cos(pitch) + y * Math.sin(pitch), vertical = y * Math.cos(pitch) - z * Math.sin(pitch)
    if (forward < 0.05) return null
    return [side / forward / (2 * t), vertical / forward / (2 * t)]
  }
}

describe('your own it marker and the middle of the view', () => {
  for (const side of [0, 1.5, 3, 4]) {
    it(`never shows over the centre at any pitch or zoom (${side} m to the side)`, () => {
      for (const back of [4, 8, 14, 25, 45]) for (const up of [1, 3, 6]) for (let pitch = -60; pitch <= 60; pitch += 0.5) {
        const screen = camera(back, up, pitch, side)
        const base = localMarkerLift(back, up, FOV)
        const { lift, opacity } = clearOfCentre(base, R, screen)
        const gap = markerGap(lift, R, screen)
        if (opacity > 0) expect(gap, `back ${back} up ${up} pitch ${pitch}`).toBeGreaterThan(0)
        if (opacity === 1 && Number.isFinite(gap)) expect(gap).toBeGreaterThanOrEqual(R * CLEAR_MARGIN - 1e-3)
        expect(lift).toBeGreaterThanOrEqual(base)
      }
    })
    // Frame by frame, as the game draws it, with the camera pitching at up to 45 degrees a
    // second: never seen over the centre, and no visible jump or blink. A jump is how far the
    // change of lift moves the marker on screen, seen through this frame's camera: holding its
    // place while the camera pitches takes about a frame's worth of the camera's own turn (some
    // 1.3% of the screen's height at 45 degrees a second); the 22 m jump this guards against is
    // many times that.
    it(`moves without popping as the camera pitches (${side} m to the side)`, () => {
      const DT = 1 / 60
      for (const back of [6, 10, 14, 20, 30]) for (const speed of [20, 45]) for (const dir of [1, -1]) {
        let last: OwnMarker | null = null
        for (let i = 0; i <= 140 / speed / DT; i++) {
          const pitch = dir * (-70 + i * speed * DT)
          const screen = camera(back, 3, pitch, side)
          const now = stepOwnMarker(last, localMarkerLift(back, 3, FOV), R, screen, DT)
          const at = `back ${back} speed ${speed} pitch ${pitch.toFixed(2)}`
          const p = screen(now.lift)
          if (now.opacity > 0) expect(markerGap(now.lift, R, screen), at).toBeGreaterThan(0)
          // Its beam never crosses the middle: none while the gem is under the circle and within its width.
          if (p && p[1] < 0 && Math.abs(p[0]) < R && now.opacity > 0) expect(now.beam, at).toBe(0)
          const before = last && screen(last.lift)
          if (last && p && before) {
            expect(Math.hypot(p[0] - before[0], p[1] - before[1]) * Math.min(now.opacity, last.opacity), at).toBeLessThan(0.06)
            // A fade, not a blink: close in at 45 degrees a second the circle can sweep over a held
            // marker in three frames or so (measured up to 0.38 a frame); a blink is all of it at once.
            expect(Math.abs(now.opacity - last.opacity), at).toBeLessThan(0.4)
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
