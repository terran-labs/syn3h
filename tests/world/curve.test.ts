import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { curveDrop, curveFactor, curveOffset, curveParam, curveRadius, planetRadius, updateCurve } from '../../src/world/curve'

const SIZE = 2048
const R = SIZE / (2 * Math.PI)

describe('planet radius', () => {
  it('is the radius of the sphere whose circumference is the world tile', () => {
    expect(planetRadius(SIZE)).toBeCloseTo(R, 9)
    expect(2 * Math.PI * planetRadius(4096)).toBeCloseTo(4096, 6)
    expect(curveRadius(SIZE, 1)).toBeCloseTo(R, 9)
  })
  it('is flat at 0 and flatter than true below 1', () => {
    expect(curveRadius(SIZE, 0)).toBe(Infinity)
    expect(curveRadius(SIZE, NaN)).toBe(Infinity)
    expect(curveRadius(SIZE, 0.5)).toBeCloseTo(2 * R, 9)
    // Drawn larger than true by default, so the centre's mountain shows from the spawn pads.
    expect(curveParam.def.default).toBe(0.4)
  })
})

describe('sphere mapping', () => {
  const o = { x: 0, y: 0, z: 0 }
  it('leaves everything alone when flat', () => {
    curveParam.value = 0
    updateCurve(new Vector3(10, 50, -20), SIZE)
    expect(curveFactor()).toBe(0)
    expect(curveOffset(500, 30, 500, o)).toEqual({ x: 0, y: 0, z: 0 })
  })
  it('puts points on the sphere: same distance from the centre, right angle round it', () => {
    curveParam.value = 1
    updateCurve(new Vector3(0, 80, 0), SIZE)
    expect(curveFactor()).toBeCloseTo(1 / R, 12)
    for (const [x, y, z] of [[100, 0, 0], [0, 25, 300], [-400, 120, 250], [700, 0, -100]]) {
      curveOffset(x, y, z, o)
      const px = x + o.x, py = y + o.y, pz = z + o.z
      // Distance from the planet's centre (0, -R, 0) is R plus the height.
      expect(Math.hypot(px, py + R, pz)).toBeCloseTo(R + y, 6)
      // The angle from the up axis is the ground distance over the radius.
      const d = Math.hypot(x, z)
      expect(Math.acos((py + R) / (R + y))).toBeCloseTo(d / R, 6)
      // The compass bearing does not change.
      expect(Math.atan2(pz, px)).toBeCloseTo(Math.atan2(z, x), 9)
    }
    // Under the camera nothing moves; a quarter of the way round the ground is one radius down.
    expect(curveDrop(0, 0)).toBeCloseTo(0, 9)
    expect(curveDrop(SIZE / 4, 0)).toBeCloseTo(R, 6)
    // Half way round, and anything beyond, is the far pole.
    expect(curveDrop(SIZE / 2, 0)).toBeCloseTo(2 * R, 6)
    expect(curveDrop(SIZE * 0.7, 0)).toBeCloseTo(2 * R, 6)
    curveParam.value = curveParam.def.default
  })
})
