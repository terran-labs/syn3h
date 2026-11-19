import { describe, expect, it } from 'vitest'
import { SWISH_CELL, SWISH_N, SwishField, type Footprint } from '../../src/world/terrain/swish'

// A buggy-sized footprint heading +x (east).
const buggy = (x: number, z: number, px = x, pz = z): Footprint => ({ x, z, px, pz, fx: 1, fz: 0, halfLength: 1.5, halfWidth: 1.05, w: 1 })
const RISE = 3, HOLD = 0.5, DT = 1 / 60

/** Drive a buggy east from x0 to x1 at 10 m/s along z = 0, the camera following. */
function drive(field: SwishField, x0: number, x1: number): void {
  for (let x = x0; x < x1; x += 10 * DT) field.update(DT, x, 0, [buggy(x + 10 * DT, 0, x, 0)], 1, RISE)
}

describe('wheel tracks through the grass', () => {
  it('leaves the grass lying in the track, then lets it rise without bouncing back', () => {
    const field = new SwishField()
    drive(field, 0, 6)
    expect(field.bendAt(3, 0)).toBe(1)
    // Watch the cell after the buggy has gone on: it never rises then falls again.
    let last = field.bendAt(3, 0), frames = 0
    while (field.bendAt(3, 0) > 0 && frames < 60 * 20) {
      field.update(DT, 6, 0, [], 0, RISE); frames++
      const now = field.bendAt(3, 0)
      expect(now).toBeLessThanOrEqual(last)
      last = now
    }
    // Up within the hold and the rise time it was given, give or take a frame.
    expect(frames / 60).toBeLessThanOrEqual(HOLD + RISE + 2 * DT)
    expect(frames / 60).toBeGreaterThan(RISE)
  })
  it('leaves an unbroken track behind a fast vehicle', () => {
    const field = new SwishField()
    // 30 m/s: 0.5 m a frame, a cell a frame.
    for (let x = 0; x < 15; x += 0.5) field.update(DT, x, 0, [buggy(x + 0.5, 0, x, 0)], 1, RISE)
    for (let x = 1; x < 14; x += SWISH_CELL) expect(field.bendAt(x, 0)).toBeGreaterThan(0.9)
  })
  it('pushes plants along the way it drives under it and out to the sides at its edges', () => {
    const field = new SwishField()
    drive(field, 0, 6)
    const middle = field.pushAt(3.1, 0.1), left = field.pushAt(3.1, -0.8), right = field.pushAt(3.1, 0.8)
    expect(middle.x).toBeGreaterThan(0.5); expect(Math.abs(middle.z)).toBeLessThan(0.3)
    expect(left.z).toBeLessThan(-0.3); expect(right.z).toBeGreaterThan(0.3)
  })
  it('does not bend grass beside the track', () => {
    const field = new SwishField()
    drive(field, 0, 6)
    expect(field.bendAt(3, 2)).toBe(0); expect(field.bendAt(3, -2)).toBe(0)
  })
  it('forgets tracks the camera has left behind, so the map never shows them repeated', () => {
    const field = new SwishField()
    drive(field, 0, 6)
    // Out of the window and back, in no time at all: the old track was cleared on the way.
    field.update(0, 6 + SWISH_N * SWISH_CELL, 0, [], 0, RISE)
    field.update(0, 6, 0, [], 0, RISE)
    expect(field.bendAt(3, 0)).toBe(0)
  })
  it('keeps the track unbroken on a slow frame', () => {
    const field = new SwishField()
    // Five frames a second at 25 m/s: 5 m a frame.
    for (let x = 0; x < 15; x += 5) field.update(0.2, x, 0, [buggy(x + 5, 0, x, 0)], 1, RISE)
    for (let x = 1; x < 14; x += SWISH_CELL) expect(field.bendAt(x, 0)).toBeGreaterThan(0.5)
  })
  it('stamps nothing for a teleport, only where it lands', () => {
    const field = new SwishField()
    field.update(DT, 10, 0, [buggy(10, 0, -10, 0)], 1, RISE)
    expect(field.bendAt(10, 0)).toBe(1); expect(field.bendAt(0, 0)).toBe(0)
  })
})
