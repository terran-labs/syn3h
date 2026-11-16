import { describe, expect, it } from 'vitest'
import { defineParam, params, sanitize, type ParamDef } from '../../shared/params'
import { formatScaledValue, positionToValue, scaleCaption, sliderStops, snapPosition, stepValue, valueToPosition } from '../../shared/paramScale'
import { exportWorld, parseWorld } from '../../src/ui/inspector/model'

const day: ParamDef<number> = { id: 'test.log-day', label: 'Day length (s)', group: 'Sun', scope: 'world', default: 0, min: 0, max: 3600, step: 1, scale: 'log', logMin: 10, unit: 'seconds', zeroLabel: 'Off', stops: [10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600] }
describe('logarithmic controls preserve stored units', () => {
  it('uses equal distances for equal ratios above the floor', () => {
    const p = (n: number) => valueToPosition(day, n)
    expect(p(100) - p(10)).toBeCloseTo(p(1000) - p(100), 12)
    expect(p(3600)).toBe(1)
    expect(p(0)).toBe(0)
    expect(p(10)).toBe(0.05)
  })
  it('round-trips exact values, including values typed below the slider floor', () => {
    for (const value of [0, 1, 5, 10, 15, 351, 1234.5, 3600]) expect(positionToValue(day, valueToPosition(day, value))).toBeCloseTo(value, 9)
    expect(positionToValue(day, -1)).toBe(0)
    expect(positionToValue(day, 2)).toBeCloseTo(3600)
  })
  it('snaps pointer positions to tidy stops and arrows to the next stop', () => {
    expect(sliderStops(day)).toEqual([0, ...day.stops!])
    expect(snapPosition(day, 0.01)).toBe(0)
    expect(snapPosition(day, 0.04)).toBe(10)
    for (const value of day.stops!) expect(snapPosition(day, valueToPosition(day, value))).toBe(value)
    expect(stepValue(day, 0, 1)).toBe(10)
    expect(stepValue(day, 10, -1)).toBe(0)
    expect(stepValue(day, 351, -1)).toBe(300)
    expect(stepValue(day, 351, 1)).toBe(600)
    expect(stepValue(day, 3600, 1)).toBe(3600)
  })
  it('keeps the default mapping linear and supports strictly positive log ranges', () => {
    expect(valueToPosition({ min: 0, max: 100 }, 25)).toBe(0.25)
    expect(positionToValue({ min: 0, max: 100 }, 0.25)).toBe(25)
    expect(positionToValue({ min: 1, max: 100, scale: 'log' }, 0.5)).toBeCloseTo(10)
  })
  it('formats durations without changing exact numeric storage or world exports', () => {
    expect(formatScaledValue(day, 0)).toBe('Off')
    expect(formatScaledValue(day, 351)).toBe('5 min 51 s')
    expect(formatScaledValue(day, 3600)).toBe('60 min')
    expect(scaleCaption(day)).toBe('Off, then 10 s to 60 min, log scale')
    expect(sanitize(day, 351)).toBe(351)
    const param = defineParam(day)
    try {
      params.set(day.id, 351, 'remote')
      const world = exportWorld([day], id => params.get(id)?.value)
      expect(world.values[day.id]).toBe(351)
      const result = parseWorld(JSON.stringify(world), [day])
      expect(result.ok && result.entries).toEqual([{ id: day.id, value: 351, adjusted: false }])
      expect(param.def.scope).toBe('world')
    } finally { params.set(day.id, 0) }
  })
})
