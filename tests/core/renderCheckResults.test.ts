import { describe, expect, it } from 'vitest'
import { formatTier, type TierResult } from '../../src/dev/renderCheckResults'

const result: TierResult = { name: 'High', intervals: [], cpu: [], checks: [], passes: [] }

describe('phone rendering report', () => {
  it('leaves refresh and pass cost unmeasured when there are no samples', () => {
    expect(formatTier(result, 16.67)).toContain('refresh unmeasured · largest pass unmeasured')
  })

  it('reports a missed refresh and ranks only passes with measured costs', () => {
    const text = formatTier({ ...result, intervals: Array(20).fill(33.3), cpu: [4],
      passes: [{ name: 'Sky', ms: null, method: 'combined' }, { name: 'Scene', ms: 9, method: 'K-slope', fit: .95 }] }, 16.67)
    expect(text).toContain('misses 60 Hz · largest measured pass: Scene 9.0 ms')
    expect(text).toContain('Sky: unresolved')
    expect(text).toContain('R² 0.95')
  })
})
