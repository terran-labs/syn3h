import { describe, expect, it } from 'vitest'
import { IdlePulse, swell } from '../../src/ui/galaxy/idlePulse'

describe('the lobby at rest', () => {
  it('is reproducible from its seed', () => {
    const a = new IdlePulse(42, 9), b = new IdlePulse(42, 9)
    for (let t = 0; t < 60; t += 0.7) expect(a.at(t)).toEqual(b.at(t))
  })
  // Bug it catches: a field of blinking lights, or planets breathing in lockstep.
  it('stays calm: two or three planets noticeably lit at once on average, never all, never in step', () => {
    const pulse = new IdlePulse(7, 9)
    let lit = 0, frames = 0, most = 0
    const series: number[][] = []
    for (let t = 0; t < 1200; t += 0.25) {
      const v = pulse.at(t), on = v.filter(x => x > 0.3).length
      lit += on; frames++; most = Math.max(most, on); series.push(v)
    }
    const average = lit / frames
    console.log(`average noticeably lit: ${average.toFixed(2)} of 9, most at once ${most}`)
    expect(average).toBeGreaterThan(1)
    expect(average).toBeLessThanOrEqual(3)
    expect(most).toBeLessThan(9)
    // No two planets track each other: their correlation over 20 minutes stays low.
    const corr = (i: number, j: number) => {
      const a = series.map(v => v[i]), b = series.map(v => v[j]), ma = a.reduce((s, x) => s + x) / a.length, mb = b.reduce((s, x) => s + x) / b.length
      let n = 0, da = 0, db = 0
      for (let k = 0; k < a.length; k++) { n += (a[k] - ma) * (b[k] - mb); da += (a[k] - ma) ** 2; db += (b[k] - mb) ** 2 }
      return n / Math.sqrt(da * db)
    }
    for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) expect(Math.abs(corr(i, j))).toBeLessThan(0.5)
  })
  it('swells smoothly and rests between', () => {
    expect(swell(0)).toBe(0); expect(swell(0.18)).toBeCloseTo(1, 5); expect(swell(0.5)).toBe(0)
  })
})
