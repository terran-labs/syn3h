import { afterEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { copyCurveState, curveOffset, curveOffsetAt, curveParam, updateCurve } from '../../src/world/curve'

const size = 2048
const sample = new Vector3(250, 60, -190)
const offset = (state: Vector3, point = sample) => {
  const result = new Vector3()
  curveOffsetAt(state, point.x, point.y, point.z, result)
  return result
}
afterEach(() => { curveParam.value = curveParam.def.default; updateCurve(new Vector3(), size) })

describe('historical planet bend', () => {
  it('retains the old projection when the camera anchor moves', () => {
    curveParam.value = .71
    updateCurve(new Vector3(10, 50, -20), size)
    const previous = copyCurveState(new Vector3()), before = offset(previous)
    expect(before).toEqual(curveOffset(sample.x, sample.y, sample.z, new Vector3()))
    updateCurve(new Vector3(110, 50, 80), size)
    const current = copyCurveState(new Vector3())
    expect(offset(previous)).toEqual(before)
    expect(offset(current).distanceTo(before)).toBeGreaterThan(1)
  })

  it('preserves equivalent views across positive and negative world seams', () => {
    curveParam.value = .71
    const camera = new Vector3(10, 50, -20)
    updateCurve(camera, size)
    const before = offset(copyCurveState(new Vector3()))
    for (const shift of [new Vector3(size, 0, 0), new Vector3(0, 0, -size)]) {
      updateCurve(camera.clone().add(shift), size)
      const after = offset(copyCurveState(new Vector3()), sample.clone().add(shift))
      expect(after.distanceTo(before)).toBeLessThan(1e-9)
    }
  })

  it('keeps a flat history flat after curvature is enabled', () => {
    curveParam.value = 0
    updateCurve(new Vector3(10, 50, -20), size)
    const flat = copyCurveState(new Vector3())
    curveParam.value = 1
    updateCurve(new Vector3(10, 50, -20), size)
    expect(offset(flat).length()).toBe(0)
    expect(offset(copyCurveState(new Vector3())).length()).toBeGreaterThan(1)
  })
})
