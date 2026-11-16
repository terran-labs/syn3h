/** The floating thumb stick's maths: deflection, dead zone, fixed base and drag threshold. */
import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD, STICK_DEAD_ZONE, isDrag, stickRadius, stickResponse, stickVector } from '../../src/ui/TouchControls'

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

  it('keeps the anchor fixed past the rim and returns through the same centre', () => {
    const origin = Object.freeze({ x: 50, y: 80 }), out = { x: 0, y: 0 }
    for (const distance of [40, 120, 1000]) {
      stickVector(origin, 50 + distance, 80, 40, out)
      expect(out).toEqual({ x: 1, y: 0 })
      expect(origin).toEqual({ x: 50, y: 80 })
    }
    stickVector(origin, 50, 80, 40, out)
    expect(out).toEqual({ x: 0, y: 0 })
    stickVector(origin, 10, 80, 40, out)
    expect(out).toEqual({ x: -1, y: 0 })
  })

  it('needs about 8 px of travel before a touch is a drag', () => {
    expect(DRAG_THRESHOLD).toBe(8)
    expect(isDrag(10, 10, 10, 10)).toBe(false)
    expect(isDrag(10, 10, 15, 15)).toBe(false)
    expect(isDrag(10, 10, 18, 10)).toBe(true)
    expect(isDrag(10, 10, 4, 4)).toBe(true)
  })
})
