/** The floating thumb stick's maths: deflection, dead zone, base follow and drag threshold. */
import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD, STICK_DEAD_ZONE, followBase, isDrag, stickRadius, stickResponse, stickVector } from '../../src/ui/TouchControls'

describe('touch stick maths', () => {
  it('keeps the permanent stick radius: 0.34 of the base width', () => {
    expect(stickRadius(140)).toBeCloseTo(47.6)
    expect(stickRadius(124)).toBeCloseTo(42.16)
    expect(stickRadius(0)).toBe(0)
  })

  it('maps the finger offset to a deflection inside the unit circle', () => {
    const out = { x: 9, y: 9 }
    expect(stickVector({ x: 100, y: 100 }, 100, 100, 50, out)).toEqual({ x: 0, y: 0 })
    expect(stickVector({ x: 100, y: 100 }, 125, 100, 50, out)).toEqual({ x: 0.5, y: 0 })
    expect(stickVector({ x: 100, y: 100 }, 100, 50, 50, out)).toEqual({ x: 0, y: -1 })
    // Past the radius it is clamped to unit length, keeping the direction.
    stickVector({ x: 0, y: 0 }, 300, 400, 50, out)
    expect(out.x).toBeCloseTo(0.6); expect(out.y).toBeCloseTo(0.8); expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)
  })

  it('writes into the object it is given and survives a zero radius', () => {
    const out = { x: 1, y: 1 }
    expect(stickVector({ x: 0, y: 0 }, 10, 10, 0, out)).toBe(out)
    expect(out).toEqual({ x: 0, y: 0 })
    expect(stickVector({ x: 0, y: 0 }, 10, 10, Number.NaN, out)).toEqual({ x: 0, y: 0 })
  })

  it('zeroes each axis inside the dead zone without rescaling outside it', () => {
    expect(stickResponse(0)).toBe(0)
    expect(stickResponse(STICK_DEAD_ZONE - 0.001)).toBe(0)
    expect(stickResponse(-(STICK_DEAD_ZONE - 0.001))).toBe(0)
    expect(stickResponse(STICK_DEAD_ZONE)).toBe(STICK_DEAD_ZONE)
    expect(stickResponse(-0.5)).toBe(-0.5)
    expect(stickResponse(1)).toBe(1)
  })

  it('leaves the base alone inside the radius', () => {
    const origin = { x: 50, y: 50 }
    expect(followBase(origin, 80, 50, 40)).toBe(origin)
    expect(origin).toEqual({ x: 50, y: 50 })
    followBase(origin, 90, 50, 40) // exactly on the rim
    expect(origin).toEqual({ x: 50, y: 50 })
    followBase(origin, 50, 50, 40) // on the centre: no direction, no movement
    expect(origin).toEqual({ x: 50, y: 50 })
  })

  it('drags the base so the finger sits on the rim when it pulls past the radius', () => {
    const origin = { x: 0, y: 0 }
    followBase(origin, 100, 0, 40)
    expect(origin.x).toBeCloseTo(60); expect(origin.y).toBeCloseTo(0)
    followBase(origin, 60, -90, 40)
    expect(Math.hypot(60 - origin.x, -90 - origin.y)).toBeCloseTo(40)
    // After following, the deflection is full in the direction of the pull.
    const out = stickVector(origin, 60, -90, 40, { x: 0, y: 0 })
    expect(out.y).toBeCloseTo(-1); expect(out.x).toBeCloseTo(0)
  })

  it('needs about 8 px of travel before a touch is a drag', () => {
    expect(DRAG_THRESHOLD).toBe(8)
    expect(isDrag(10, 10, 10, 10)).toBe(false)
    expect(isDrag(10, 10, 15, 15)).toBe(false)
    expect(isDrag(10, 10, 18, 10)).toBe(true)
    expect(isDrag(10, 10, 4, 4)).toBe(true)
  })
})
