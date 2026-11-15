/** The owner's rule: height above ground is measured from the contact surfaces, so a resting vehicle reads 0 m. */
import { describe, expect, it } from 'vitest'
import { HeightAboveGround, type GroundedVehicle } from '../../src/ui/heightAboveGround'

const vehicle = (kind: string, wheelsGrounded = 0, extra: Partial<GroundedVehicle> = {}) => ({ kind, wheelsGrounded, ...extra })

describe('height above ground', () => {
  it('a buggy resting on its tyres reads 0, though its body sits about a metre up', () => {
    const height = new HeightAboveGround()
    expect(height.read(vehicle('buggy-syn3h', 4), 10.93, 10)).toBe(0)
    expect(height.read(vehicle('tank', 2), 51.4, 50)).toBe(0)
  })
  it('rises from 0 without a jump when the wheels leave the ground, then reads the real gap', () => {
    const height = new HeightAboveGround(), buggy = vehicle('buggy-syn3h', 4)
    height.read(buggy, 10.93, 10)
    buggy.wheelsGrounded = 0
    expect(height.read(buggy, 10.93, 10)).toBeCloseTo(0, 6)
    expect(height.read(buggy, 15.93, 10)).toBeCloseTo(5, 6)
    buggy.wheelsGrounded = 3
    expect(height.read(buggy, 11.1, 10.2)).toBe(0)
  })
  it('is never negative, and one wheel touching is touching', () => {
    const height = new HeightAboveGround(), buggy = vehicle('buggy', 4)
    height.read(buggy, 1, 0)
    buggy.wheelsGrounded = 0
    expect(height.read(buggy, 0.4, 0)).toBe(0)
    buggy.wheelsGrounded = 1
    expect(height.read(buggy, 2.5, 0)).toBe(0)
  })
  it('keeps a resting height per vehicle and ignores an absurd sample', () => {
    const height = new HeightAboveGround(), a = vehicle('buggy', 4), b = vehicle('tank', 2)
    height.read(a, 0.9, 0); height.read(b, 40, 0)
    a.wheelsGrounded = 0; b.wheelsGrounded = 0
    expect(height.read(a, 10.9, 0)).toBeCloseTo(10, 6)
    expect(height.read(b, 43, 0)).toBeCloseTo(40, 6) // capped at 3 m of rest height, not 40
  })
  it('a vehicle that has never touched the ground reads its body height, as before', () => {
    expect(new HeightAboveGround().read(vehicle('buggy', 0), 8, 2)).toBe(6)
  })
  it('does not trust the hovercraft or the jet contact count: neither is real contact yet', () => {
    const height = new HeightAboveGround()
    // The hovercraft reports four "wheels grounded" anywhere within 30 m of the surface.
    expect(height.read(vehicle('hovercraft', 4), 25, 0)).toBe(25)
    // The jet reports none even on its gear, where its hull sits about 1.3 m up.
    expect(height.read(vehicle('jet', 0), 1.3, 0)).toBeCloseTo(1.3, 6)
  })
  it('prefers the vehicle own measurement from its contact surfaces when it has one', () => {
    const height = new HeightAboveGround()
    expect(height.read(vehicle('jet', 0, { heightAboveSurface: () => 0 }), 1.3, 0)).toBe(0)
    expect(height.read(vehicle('hovercraft', 4, { heightAboveSurface: () => 12.5 }), 25, 0)).toBe(12.5)
    expect(height.read(vehicle('jet', 0, { heightAboveSurface: () => -0.2 }), 1.3, 0)).toBe(0)
    expect(height.read(vehicle('jet', 0, { heightAboveSurface: () => NaN }), 1.3, 0)).toBeCloseTo(1.3, 6)
  })
  it('reads 0 rather than nonsense when the position is not a number', () => {
    expect(new HeightAboveGround().read(vehicle('buggy', 0), NaN, 0)).toBe(0)
  })
})
