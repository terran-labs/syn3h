import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { curveDrop, curveFactor, curveParam, curveRadius, updateCurve } from '../../src/world/curve'

const SIZE = 2048
const BALL = SIZE / (2 * Math.PI)

describe('curveRadius', () => {
  it('is flat at 0 and below', () => {
    expect(curveRadius(SIZE, 0)).toBe(Infinity)
    expect(curveRadius(SIZE, -0.5)).toBe(Infinity)
    expect(curveRadius(SIZE, NaN)).toBe(Infinity)
  })
  it('is the tile circumference ball at 1', () => {
    expect(curveRadius(SIZE, 1)).toBeCloseTo(BALL, 6)
    expect(BALL).toBeGreaterThan(320)
    expect(BALL).toBeLessThan(330)
  })
  it('is a gentle planet about ten balls wide at 0.3', () => {
    const r = curveRadius(SIZE, 0.3) / BALL
    expect(r).toBeGreaterThan(8)
    expect(r).toBeLessThan(13)
  })
  it('shrinks monotonically as the slider rises', () => {
    let prev = Infinity
    for (let c = 0.01; c <= 1.0001; c += 0.01) {
      const r = curveRadius(SIZE, c)
      expect(r).toBeLessThan(prev)
      prev = r
    }
  })
  it('scales with the world size', () => {
    expect(curveRadius(4096, 0.5)).toBeCloseTo(2 * curveRadius(SIZE, 0.5), 6)
  })
})

describe('updateCurve', () => {
  it('drops points by d² / 2R from the camera and not at all when flat', () => {
    curveParam.value = 0
    updateCurve(new Vector3(10, 50, -20), SIZE)
    expect(curveFactor()).toBe(0)
    expect(curveDrop(500, 500)).toBe(0)
    curveParam.value = 1
    updateCurve(new Vector3(10, 50, -20), SIZE)
    expect(curveFactor()).toBeCloseTo(1 / (2 * BALL), 9)
    expect(curveDrop(10, -20)).toBe(0)
    expect(curveDrop(110, -20)).toBeCloseTo(100 * 100 / (2 * BALL), 6)
    curveParam.value = 0
  })
})
