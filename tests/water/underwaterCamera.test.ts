import { describe, expect, it } from 'vitest'
import { lensDefaults, lensWash, newLensState, stepLens } from '../../src/world/water/underwaterCamera'

const dt = 1 / 60
const wave = (t: number) => .3 * Math.sin(t * 2 * Math.PI / 2.5) + .1 * Math.sin(t * 7.3)

describe('underwater lens rule', () => {
  it('never flips side when the desired lens sits at a wavy surface', () => {
    const s = newLensState()
    stepLens(s, .3, 0, dt)
    let flips = 0, side = s.side, minClear = Infinity, maxStep = 0, prev = s.y
    for (let i = 1; i < 60 * 30; i++) {
      const t = i * dt, surface = wave(t), y = stepLens(s, surface + .05 * Math.sin(t * 3), surface, dt)
      if (s.side !== side) flips++
      side = s.side; minClear = Math.min(minClear, y - surface); if (i > 60) maxStep = Math.max(maxStep, Math.abs(y - prev)); prev = y
    }
    expect(flips).toBe(0)
    expect(s.t).toBe(-1)
    expect(minClear).toBeGreaterThan(.1)
    // Rides the swell, not each wave: smaller vertical speed than the surface itself.
    expect(maxStep / dt).toBeLessThan(.3 * 2 * Math.PI / 2.5 + .73 + .01)
  })
  it('descends monotonically through the surface at bounded speed and arrives exactly', () => {
    const s = newLensState()
    stepLens(s, 2, 0, dt)
    const ys: number[] = []
    for (let i = 0; i < 60 * 4; i++) { const t = i * dt; ys.push(stepLens(s, -2, wave(t), dt)) }
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-9)
      expect(ys[i - 1] - ys[i]).toBeLessThanOrEqual(lensDefaults.maxSpeed * dt + 1e-9)
    }
    // The crossing takes about the configured duration, not one frame.
    const crossed = ys.findIndex((y, i) => y < wave(i * dt))
    const firstMove = ys.findIndex(y => y < ys[0] - 1e-6)
    expect(ys.findIndex(y => y <= -2 + 1e-9) - firstMove).toBeGreaterThan(40)
    expect(crossed).toBeGreaterThan(0)
    expect(ys.at(-1)).toBe(-2)
    expect(s.side).toBe(-1)
  })
  it('surfaces as the mirror image and returns exactly to the chase camera', () => {
    const s = newLensState()
    stepLens(s, -2, 0, dt)
    expect(s.side).toBe(-1)
    // Desired inside the band from below: held under the surface, no crossing.
    for (let i = 0; i < 60; i++) expect(stepLens(s, .2, 0, dt)).toBeLessThan(0)
    const ys: number[] = []
    for (let i = 0; i < 60 * 3; i++) ys.push(stepLens(s, 1.5, 0, dt))
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9)
    expect(ys.at(-1)).toBe(1.5)
    expect(s.side).toBe(1)
    expect(stepLens(s, 3, 0, dt)).toBe(3)
  })
  it('washes only during a crossing and peaks mid way', () => {
    const s = newLensState()
    stepLens(s, 2, 0, dt)
    expect(lensWash(s)).toBe(0)
    let peak = 0
    for (let i = 0; i < 120; i++) { stepLens(s, -2, 0, dt); peak = Math.max(peak, lensWash(s)) }
    expect(peak).toBeGreaterThan(.95)
    expect(lensWash(s)).toBe(0)
  })
  it('resets instantly on a teleport and when there is no water', () => {
    const s = newLensState()
    stepLens(s, 2, 0, dt)
    expect(stepLens(s, -20, 0, dt)).toBe(-20)
    expect(s.side).toBe(-1); expect(s.t).toBe(-1)
    expect(stepLens(s, 40, 0, dt)).toBe(40)
    expect(s.side).toBe(1)
    stepLens(s, 1, 0, dt); stepLens(s, -1, 0, dt)
    expect(s.t).toBeGreaterThanOrEqual(0)
    expect(stepLens(s, -1, -Infinity, dt)).toBe(-1)
    expect(s.t).toBe(-1)
  })
  it('reverses a crossing smoothly when the target comes back', () => {
    const s = newLensState()
    stepLens(s, 2, 0, dt)
    let prev = s.y, maxStep = 0
    for (let i = 0; i < 20; i++) { const y = stepLens(s, -2, 0, dt); maxStep = Math.max(maxStep, Math.abs(y - prev)); prev = y }
    for (let i = 0; i < 180; i++) { const y = stepLens(s, 2, 0, dt); maxStep = Math.max(maxStep, Math.abs(y - prev)); prev = y }
    expect(maxStep).toBeLessThanOrEqual(lensDefaults.maxSpeed * dt + 1e-9)
    expect(prev).toBe(2)
  })
})
