import { describe, expect, it } from 'vitest'
import { CONVOY_LIMIT, RELIEF_SAMPLES, senseConvoy, senseRelief, type ConvoyVoice, type Point } from '../../src/audio/scoreSenses'

const at = (x: number, y: number, z: number): Point => ({ x, y, z })
const here = at(0, 0, 0), north = at(0, 0, -1), sky = at(0, 1, 0)   // facing -Z: right is +X

describe('what the score hears of other vehicles', () => {
  it('gives distance and left to right placement, nearest first', () => {
    const others = [at(30, 0, 0), at(-10, 0, 0), at(0, 0, -50)]
    const voices = senseConvoy([], here, north, sky, others, p => p, new WeakMap(), 0.2)
    expect(voices.map(v => v.distance)).toEqual([10, 30, 50])
    expect(voices.map(v => Math.round(v.pan * 100) / 100)).toEqual([-1, 1, 0])
  })
  it('measures how fast each one closes, and nothing on first sight', () => {
    const car = at(0, 0, -40), memory = new WeakMap<Point, number>(), out: ConvoyVoice[] = []
    expect(senseConvoy(out, here, north, sky, [car], p => p, memory, 0.2)[0].closing).toBe(0)
    car.z = -36
    expect(senseConvoy(out, here, north, sky, [car], p => p, memory, 0.2)[0].closing).toBeCloseTo(20)
    car.z = -40
    expect(senseConvoy(out, here, north, sky, [car], p => p, memory, 0.2)[0].closing).toBeCloseTo(-20)
  })
  it('reuses its array and its entries, and keeps only the nearest', () => {
    const out: ConvoyVoice[] = [], crowd = Array.from({ length: 30 }, (_, i) => at(i + 1, 0, 0))
    const first = senseConvoy(out, here, north, sky, crowd, p => p, new WeakMap(), 0.2), entry = first[0]
    expect(first).toBe(out); expect(first).toHaveLength(CONVOY_LIMIT); expect(first[0].distance).toBe(1)
    expect(senseConvoy(out, here, north, sky, crowd.slice(0, 2), p => p, new WeakMap(), 0.2)).toHaveLength(2)
    expect(out[0]).toBe(entry)
  })
})

describe('what the score hears of the ground ahead', () => {
  it('is silent for a vehicle that is all but still', () => {
    expect(senseRelief([], here, at(0.5, 3, 0.5), () => 0)).toBeUndefined()
  })
  it('samples sixteen heights, ten metres apart, along the way it is going', () => {
    const asked: [number, number][] = []
    const relief = senseRelief([], at(100, 5, 200), at(0, 0, -20), (x, z) => { asked.push([x, z]); return 200 - z })!
    expect(relief).toHaveLength(RELIEF_SAMPLES)
    expect(asked[0]).toEqual([100, 190]); expect(asked[15]).toEqual([100, 40])
    expect(relief[0]).toBe(10); expect(relief[15]).toBe(160)
  })
  it('bridges a hole in the terrain data', () => {
    const relief = senseRelief([], at(0, 7, 0), at(10, 0, 0), x => (x === 10 || x === 30 ? Number.NaN : x))!
    expect(relief.slice(0, 3)).toEqual([7, 20, 20])
  })
})
