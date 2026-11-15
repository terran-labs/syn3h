import { describe, expect, it } from 'vitest'
import { REST, restStep } from '../../src/ui/galaxy/Galaxy'

/** Leave a tilt alone for `seconds` at `fps`, counting idle time from `idle`. */
function leave(pitch: number, seconds: number, fps: number, idle = 0): number {
  for (let t = 0; t < seconds - 1e-9; t += 1 / fps) { idle += 1 / fps; pitch = restStep(pitch, idle, 1 / fps) }
  return pitch
}

describe('galaxy resting view', () => {
  it('rests about twenty degrees above the orbital plane', () => {
    expect(REST.pitch * 180 / Math.PI).toBeCloseTo(20, 6)
  })
  it('does nothing until the view has been left alone for a few seconds', () => {
    expect(restStep(1.1, 0, 1 / 30)).toBe(1.1)
    expect(restStep(1.1, REST.after - 0.01, 1 / 30)).toBe(1.1)
    expect(restStep(1.1, REST.after, 1 / 30)).toBeLessThan(1.1)
    expect(leave(1.1, REST.after - 0.1, 30)).toBe(1.1)
  })
  it('then settles slowly, from above or below, without passing the resting tilt', () => {
    for (const start of [1.25, -0.2]) {
      let pitch = start, last = start
      for (let i = 0; i < 30 * 60; i++) {
        pitch = restStep(pitch, REST.after + i / 30, 1 / 30)
        expect((pitch - REST.pitch) * (start - REST.pitch)).toBeGreaterThanOrEqual(0)
        expect(Math.abs(pitch - REST.pitch)).toBeLessThanOrEqual(Math.abs(last - REST.pitch))
        last = pitch
      }
      expect(pitch).toBe(REST.pitch)
    }
    // Slow: a second in, most of the way is still to go; it reads as drifting.
    const second = leave(1.25, 1, 30, REST.after)
    expect((second - REST.pitch) / (1.25 - REST.pitch)).toBeGreaterThan(0.75)
    // A third of a minute in it is within a degree.
    expect(Math.abs(leave(1.25, 20, 30, REST.after) - REST.pitch)).toBeLessThan(Math.PI / 180)
  })
  it('lands exactly on the resting tilt and stays, so the lobby can go idle', () => {
    const landed = leave(0.9, 90, 30, REST.after)
    expect(landed).toBe(REST.pitch)
    expect(restStep(landed, 1000, 1 / 30)).toBe(REST.pitch)
  })
  it('is the same at 30, 60 and 120 frames a second, and survives a long frame', () => {
    const ends = [30, 60, 120].map(fps => leave(1.0, 3, fps, REST.after))
    for (const end of ends) expect(end).toBeCloseTo(ends[0], 9)
    const long = restStep(1.0, REST.after + 1, 0.25)
    expect(long).toBeGreaterThan(REST.pitch); expect(long).toBeLessThan(1.0)
    expect(restStep(1.0, REST.after + 1, 0)).toBe(1.0)
  })
  it('is cancelled at once by any input: the idle clock starts again and the tilt is left where it is', () => {
    const part = leave(1.1, 3, 30, REST.after)
    expect(part).toBeLessThan(1.1); expect(part).toBeGreaterThan(REST.pitch)
    // Input resets the idle time to nothing: no further movement, and no jump back.
    expect(restStep(part, 0, 1 / 30)).toBe(part)
    expect(leave(part, REST.after - 0.1, 30)).toBe(part)
  })
})
